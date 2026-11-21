import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import type { StoryNode } from '../game.types';
import { isGear, isItem } from '../progression/catalog';
import { customItems, type ShopItemInput } from '../progression/shop-items';
import type { StoryDocument } from '../story/story-document';

@Injectable()
export class GameAdminService {
  constructor(private readonly db: DataSource) {}

  async storyHistory() {
    const [current] = await this.db.query<{ revision_id: string | null }[]>(
      'SELECT revision_id FROM game_story_publication WHERE singleton',
    );
    const versions = await this.db.query<unknown[]>(`
      SELECT r.id,r.created_at AS "createdAt",a.username AS publisher,
        r.document->>'initialNodeId' AS "initialNodeId"
      FROM game_story_revisions r LEFT JOIN game_accounts a ON a.id=r.published_by
      ORDER BY r.created_at DESC LIMIT 30
    `);
    return { revision: current.revision_id ?? 'seed', versions };
  }

  async publish(
    actor: string,
    document: StoryDocument,
    expected: string,
    restoredFrom?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.query<
        { initial_node_id: string; revision_id: string | null }[]
      >(
        'SELECT initial_node_id, revision_id FROM game_story_publication WHERE singleton FOR UPDATE',
      );
      if ((current.revision_id ?? 'seed') !== expected)
        throw new ConflictException(
          'The published story changed. Reload before publishing again.',
        );
      if (!current.revision_id) {
        const rows = await tx.query<{ node_id: string; scene: StoryNode }[]>(
          'SELECT node_id, scene FROM game_story_nodes',
        );
        const baseline = {
          initialNodeId: current.initial_node_id,
          nodes: Object.fromEntries(
            rows.map(({ node_id, scene }) => [node_id, scene]),
          ),
        };
        await this.insertRevision(tx, baseline);
      }
      const revision = await this.insertRevision(tx, document, actor);
      await tx.query('DELETE FROM game_story_nodes');
      await tx.query(
        'INSERT INTO game_story_nodes(node_id,scene) SELECT key,value FROM jsonb_each($1::jsonb)',
        [JSON.stringify(document.nodes)],
      );
      await tx.query(
        'UPDATE game_story_publication SET initial_node_id=$1, revision_id=$2 WHERE singleton',
        [document.initialNodeId, revision],
      );
      await this.log(
        actor,
        restoredFrom ? 'restore_story' : 'publish_story',
        revision,
        { restoredFrom },
        tx,
      );
      return {
        revision,
        initialNodeId: document.initialNodeId,
        sceneCount: Object.keys(document.nodes).length,
      };
    });
  }

  async version(id: string) {
    const [row] = await this.db.query<{ document: StoryDocument }[]>(
      'SELECT document FROM game_story_revisions WHERE id=$1',
      [id],
    );
    if (!row) throw new NotFoundException('Story revision not found.');
    return row.document;
  }

  accounts(search: string) {
    return this.db.query<unknown[]>(
      `
      SELECT id,username,moderator,credits,gear,items,loadout FROM game_accounts
      WHERE starts_with(username,$1) ORDER BY username LIMIT 50
    `,
      [search.trim().toLowerCase().slice(0, 24)],
    );
  }

  orders() {
    return this.db.query<unknown[]>(`
      SELECT o.id,a.username,o.gear_id AS "gearId",o.amount_minor AS "amountMinor",o.currency,
        o.status,o.review_reason AS "reviewReason",o.created_at AS "createdAt"
      FROM game_checkout_orders o JOIN game_accounts a ON a.id=o.account_id
      ORDER BY o.created_at DESC LIMIT 50
    `);
  }

  activity() {
    return this.db.query<unknown[]>(`
      SELECT l.id,a.username,l.action,l.target,l.details,l.created_at AS "createdAt"
      FROM game_admin_activity l LEFT JOIN game_accounts a ON a.id=l.actor_id
      ORDER BY l.created_at DESC LIMIT 50
    `);
  }

  async createShopItem(actor: string, input: ShopItemInput) {
    const name = input.name.trim();
    const { requestId, effect, power, price } = input;
    if (
      name.length < 2 ||
      name.length > 60 ||
      (effect !== 'heal' && effect !== 'guard') ||
      !Number.isInteger(power) ||
      power < 1 ||
      power > (effect === 'heal' ? 1000 : 25) ||
      !Number.isInteger(price) ||
      price < 1 ||
      price > 100000
    ) {
      throw new BadRequestException(
        'Enter a valid name, effect, power and Cinder price.',
      );
    }
    const id = 'custom_' + requestId;
    return this.db.transaction(async (tx) => {
      const [created] = await tx.query<{ id: string }[]>(
        'INSERT INTO game_shop_items(id,name,effect,power,price,created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id',
        [id, name, effect, power, price, actor],
      );
      if (!created) {
        const [same] = await tx.query<{ id: string }[]>(
          'SELECT id FROM game_shop_items WHERE id=$1 AND name=$2 AND effect=$3 AND power=$4 AND price=$5 AND created_by=$6',
          [id, name, effect, power, price, actor],
        );
        if (!same)
          throw new ConflictException(
            'This request belongs to a different shop item.',
          );
      } else {
        await tx.query(
          "INSERT INTO game_admin_activity(id,actor_id,action,target,details) VALUES ($1,$2,'create_shop_item',$3,$4::jsonb)",
          [
            requestId,
            actor,
            id,
            JSON.stringify({ name, effect, power, price }),
          ],
        );
      }
      return (await customItems(tx, id))[0];
    });
  }

  async adjust(
    actor: string,
    accountId: string,
    command: {
      requestId: string;
      action: string;
      amount?: number;
      product?: string;
      reason: string;
    },
  ) {
    if (!command.reason.trim())
      throw new BadRequestException('Enter a reason for this adjustment.');
    await this.db.transaction(async (tx) => {
      const { requestId, action, amount, product } = command;
      const event = [
        requestId,
        actor,
        action,
        accountId,
        JSON.stringify({ amount, product, reason: command.reason.trim() }),
      ];
      const [inserted] = await tx.query<{ id: string }[]>(
        `
        INSERT INTO game_admin_activity(id,actor_id,action,target,details)
        VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id
      `,
        event,
      );
      if (!inserted) {
        const [same] = await tx.query<{ id: string }[]>(
          `
          SELECT id FROM game_admin_activity
          WHERE id=$1 AND actor_id=$2 AND action=$3 AND target=$4 AND details=$5::jsonb
        `,
          event,
        );
        if (!same)
          throw new ConflictException(
            'This request ID belongs to another adjustment.',
          );
        return;
      }
      const [account] = await tx.query<
        { credits: number; gear: string[]; items: Record<string, number> }[]
      >('SELECT credits,gear,items FROM game_accounts WHERE id=$1 FOR UPDATE', [
        accountId,
      ]);
      if (!account) throw new NotFoundException('Game account not found.');
      if (
        action === 'credits' &&
        Number.isInteger(amount) &&
        amount !== 0 &&
        Math.abs(amount!) <= 100000
      ) {
        const credits = account.credits + amount!;
        if (credits < 0 || credits > 2147483647)
          throw new BadRequestException(
            'The resulting credit balance is out of range.',
          );
        await tx.query('UPDATE game_accounts SET credits=$2 WHERE id=$1', [
          accountId,
          credits,
        ]);
      } else if (action === 'grant_gear' && isGear(product)) {
        if (account.gear.includes(product))
          throw new ConflictException('This account already owns the gear.');
        await tx.query(
          'UPDATE game_accounts SET gear=gear || to_jsonb($2::text) WHERE id=$1',
          [accountId, product],
        );
      } else if (
        action === 'items' &&
        typeof product === 'string' &&
        (isItem(product) ||
          (product.startsWith('custom_') &&
            (await customItems(tx, product)).length > 0)) &&
        Number.isInteger(amount) &&
        amount !== 0 &&
        Math.abs(amount!) <= 1000
      ) {
        const count = (account.items[product] ?? 0) + amount!;
        if (count < 0 || count > 2147483647)
          throw new BadRequestException(
            'The resulting item count is out of range.',
          );
        await tx.query(
          'UPDATE game_accounts SET items=jsonb_set(items,ARRAY[$2::text],to_jsonb($3::int)) WHERE id=$1',
          [accountId, product, count],
        );
      } else {
        throw new BadRequestException(
          'Choose a valid credit, equipment, or item adjustment.',
        );
      }
    });
  }

  async log(
    actor: string,
    action: string,
    target: string,
    details: object,
    tx = this.db.manager,
  ) {
    await tx.query(
      'INSERT INTO game_admin_activity(id,actor_id,action,target,details) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [randomUUID(), actor, action, target, JSON.stringify(details)],
    );
  }

  private async insertRevision(
    tx: EntityManager,
    document: StoryDocument,
    actor?: string,
  ) {
    const id = randomUUID();
    await tx.query(
      'INSERT INTO game_story_revisions(id,document,published_by) VALUES ($1,$2::jsonb,$3)',
      [id, JSON.stringify(document), actor ?? null],
    );
    return id;
  }
}
