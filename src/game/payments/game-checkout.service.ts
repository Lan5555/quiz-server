import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { hash, VotingConfig } from '../../voting/common/voting';
import {
  FlutterwaveProviderError,
  FlutterwaveService,
} from '../../voting/payments/flutterwave.service';
import type { ProviderTransaction } from '../../voting/payments/flutterwave.service';
import {
  CINDER_BUNDLES,
  GEAR,
  ITEMS,
  PREMIUM_FIGHTERS,
  isCinderBundle,
  isItem,
  isPremiumFighter,
} from '../progression/catalog';

import { CASH_SKILLS, DUAL_SUMMON_PRODUCT, isCompanionSkill } from '../progression/companion-skills';

const PRODUCTS = {
  [DUAL_SUMMON_PRODUCT]: { name: 'Dual Summoning', amountMinor: 400_000 },
  ashblade: { name: GEAR.ashblade.name, amountMinor: 200_000 },
  bellwarden_mail: { name: GEAR.bellwarden_mail.name, amountMinor: 200_000 },
  bloodleaf_tonic: { name: ITEMS.bloodleaf_tonic.name, amountMinor: 50_000 },
  ward_stone: { name: ITEMS.ward_stone.name, amountMinor: 50_000 },
  hollowfang: { name: GEAR.hollowfang.name, amountMinor: 350_000 },
  oathkeeper_plate: { name: GEAR.oathkeeper_plate.name, amountMinor: 350_000 },
  crownforged_blade: { name: GEAR.crownforged_blade.name, amountMinor: 350_000 },
  sovereign_plate: { name: GEAR.sovereign_plate.name, amountMinor: 350_000 },
  royal_bloodleaf: { name: ITEMS.royal_bloodleaf.name, amountMinor: 50_000 },
  sovereign_ward: { name: ITEMS.sovereign_ward.name, amountMinor: 50_000 },
  ...CINDER_BUNDLES,
  ...PREMIUM_FIGHTERS,
  ...CASH_SKILLS,
} as const;
const LEGACY_OFFERS = new Set(['ashblade','bellwarden_mail','hollowfang','oathkeeper_plate','bloodleaf_tonic','ward_stone']);

type PaidProductId = keyof typeof PRODUCTS;
type AccountInventory = { gear: string[]; fighter_ids: string[] };

function owns(account: AccountInventory, product: PaidProductId) {
  if (isItem(product) || isCinderBundle(product)) return false;
  return (
    isPremiumFighter(product) ? account.fighter_ids : account.gear
  ).includes(product);
}

async function ownsCinderSkill(tx: DataSource['manager'], id: string, product: PaidProductId) {
  if (!isCompanionSkill(product)) return false;
  const [purchase] = await tx.query<{ product: string }[]>(
    'SELECT product FROM game_purchases WHERE account_id=$1 AND product=$2 LIMIT 1', [id, product],
  );
  return Boolean(purchase);
}
export type CheckoutOrder = {
  id: string;
  gearId: PaidProductId;
  amountMinor: number;
  currency: 'NGN';
  status: 'PENDING' | 'FULFILLED' | 'REVIEW' | 'EXPIRED';
  checkoutUrl: string | null;
  expiresAt: Date;
};
type OrderRow = {
  id: string;
  account_id: string;
  gear_id: PaidProductId;
  amount_minor: number;
  currency: 'NGN';
  status: CheckoutOrder['status'];
  checkout_url: string | null;
  expires_at: Date;
  provider_reference: string;
  provider_mode: string;
  payer_email_hash: string;
};

@Injectable()
export class GameCheckoutService {
  constructor(
    private readonly db: DataSource,
    private readonly provider: FlutterwaveService,
    private readonly settings: VotingConfig,
  ) {}

  offers() {
    return {
      enabled: this.settings.get('GAME_CASH_CHECKOUT_ENABLED') === 'true',
      currency: 'NGN',
      offers: (Object.keys(PRODUCTS) as PaidProductId[])
        .filter((id) => !LEGACY_OFFERS.has(id))
        .map((gearId) => ({
        gearId,
        kind: isCompanionSkill(gearId) ? 'skill' : gearId === DUAL_SUMMON_PRODUCT ? 'summon' : isPremiumFighter(gearId)
          ? 'fighter'
          : isCinderBundle(gearId)
            ? 'cinders'
          : isItem(gearId)
            ? 'item'
            : 'gear',
        ...PRODUCTS[gearId],
      })),
    };
  }

  async orders(accountId: string) {
    const rows = await this.db.query<OrderRow[]>(
      'SELECT * FROM game_checkout_orders WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20',
      [accountId],
    );
    return rows.map((row) => this.present(row));
  }

  async start(
    accountId: string,
    requestId: string,
    product: string,
    payerEmail: string,
  ) {
    if (!Object.hasOwn(PRODUCTS, product))
      throw new BadRequestException('This product has no cash offer.');
    const gearId = product as PaidProductId;
    const email = payerEmail.trim().toLowerCase();
    const payerEmailHash = hash(email);
    const { order, initialize } = await this.db.transaction(async (tx) => {
      const [account] = await tx.query<AccountInventory[]>(
        'SELECT gear,fighter_ids FROM game_accounts WHERE id=$1 FOR UPDATE',
        [accountId],
      );
      if (!account) throw new NotFoundException('Game account not found.');
      const [previous] = await tx.query<OrderRow[]>(
        'SELECT * FROM game_checkout_orders WHERE account_id=$1 AND request_id=$2',
        [accountId, requestId],
      );
      if (previous) {
        if (
          previous.gear_id !== gearId ||
          (previous.payer_email_hash &&
            previous.payer_email_hash !== payerEmailHash)
        ) {
          throw new ConflictException(
            'This request belongs to a different checkout.',
          );
        }
        return { order: previous, initialize: false };
      }
      if (owns(account, gearId) || await ownsCinderSkill(tx, accountId, gearId))
        throw new ConflictException('You already own this product.');
      const [open] = await tx.query<OrderRow[]>(
        "SELECT * FROM game_checkout_orders WHERE account_id=$1 AND gear_id=$2 AND status IN ('PENDING','REVIEW') ORDER BY (status='PENDING') DESC, created_at DESC LIMIT 1",
        [accountId, gearId],
      );
      if (open) return { order: open, initialize: false };

      if (LEGACY_OFFERS.has(gearId))
        throw new BadRequestException('This cash offer has been retired.');
      if (!this.offers().enabled)
        throw new ServiceUnavailableException('Game checkout is unavailable.');
      const mode = this.provider.mode();
      this.settings.frontend();
      const id = randomUUID();
      const [created] = await tx.query<OrderRow[]>(
        `INSERT INTO game_checkout_orders
          (id,account_id,request_id,gear_id,amount_minor,currency,provider_mode,provider_reference,payer_email_hash,expires_at)
          VALUES ($1,$2,$3,$4,$5,'NGN',$6,$7,$8,now()+interval '30 minutes') RETURNING *`,
        [
          id,
          accountId,
          requestId,
          gearId,
          PRODUCTS[gearId].amountMinor,
          mode,
          `game-${id}`,
          payerEmailHash,
        ],
      );
      return { order: created, initialize: true };
    });
    if (!initialize) return this.present(order);

    // The insert reserves the reference before the provider call. An uncertain
    // response is recovered by verification/webhook using the same reference.
    const destination = isPremiumFighter(gearId) ? '&forge=summon' : '';
    const checkoutUrl = await this.provider.initializeHosted({
      reference: order.provider_reference,
      amount: order.amount_minor,
      email,
      redirectUrl: `${this.settings.frontend()}/pages/embrace-game?gameOrder=${order.id}${destination}`,
      title: `Embrace Your Horror · ${PRODUCTS[gearId].name}`,
      expiresAt: order.expires_at,
    });
    await this.db.query(
      'UPDATE game_checkout_orders SET checkout_url=$2 WHERE id=$1',
      [order.id, checkoutUrl],
    );
    return this.present(await this.requireOrder(accountId, order.id));
  }

  async verify(accountId: string, id: string) {
    const order = await this.requireOrder(accountId, id);
    if (order.status !== 'PENDING' && order.status !== 'EXPIRED')
      return this.present(order);
    this.assertMode(order);
    try {
      const evidence = await this.provider.verify(order.provider_reference);
      await this.settle(order, evidence);
    } catch (error) {
      if (
        !(error instanceof FlutterwaveProviderError) ||
        error.diagnostic !== 'HTTP_404'
      )
        throw error;
      // Leave time for asynchronous payment rails before releasing a checkout
      // that Flutterwave cannot find. A late verified charge can still settle.
      if (
        Date.now() >=
        new Date(order.expires_at).getTime() + 24 * 60 * 60 * 1000
      ) {
        await this.db.query(
          "UPDATE game_checkout_orders SET status='EXPIRED' WHERE id=$1 AND status='PENDING'",
          [order.id],
        );
      }
    }
    return this.present(await this.requireOrder(accountId, id));
  }

  async routeWebhook(raw?: Buffer, signature?: string) {
    if (!raw) return false;
    let message: { event?: unknown; data?: { tx_ref?: unknown; id?: unknown } };
    try {
      message = JSON.parse(
        raw.toString('utf8').replace(/("id"\s*:\s*)(\d{16,})/g, '$1"$2"'),
      ) as typeof message;
    } catch {
      return false;
    }

    const ref = message?.data?.tx_ref;
    if (typeof ref !== 'string' || !/^game-[a-f0-9-]{36}$/.test(ref))
      return false;
    this.provider.signature(raw, signature);
    if (message.event !== 'charge.completed') return true;
    const [order] = await this.db.query<OrderRow[]>(
      'SELECT * FROM game_checkout_orders WHERE provider_reference=$1',
      [ref],
    );
    if (order && (order.status === 'PENDING' || order.status === 'EXPIRED')) {
      this.assertMode(order);
      const id = message.data?.id;
      if (
        (typeof id !== 'string' && typeof id !== 'number') ||
        !/^[1-9][0-9]*$/.test(String(id))
      ) {
        throw new BadRequestException('Invalid payment transaction ID.');
      }
      const evidence = await this.provider.verifyId(String(id));
      // A webhook hint may point at another order. Keep this one pending.
      if (evidence.reference !== order.provider_reference)
        throw new BadRequestException('Payment reference does not match.');
      await this.settle(order, evidence);
    }
    return true;
  }

  private async settle(order: OrderRow, evidence: ProviderTransaction) {
    if (
      evidence.reference !== order.provider_reference ||
      evidence.domain !== order.provider_mode
    ) {
      throw new ServiceUnavailableException(
        'Flutterwave verification did not match this order.',
      );
    }
    if (evidence.status !== 'success') {
      if (
        ['failed', 'cancelled'].includes(evidence.status) &&
        new Date(order.expires_at).getTime() < Date.now()
      ) {
        await this.db.query(
          "UPDATE game_checkout_orders SET status='EXPIRED' WHERE id=$1 AND status='PENDING'",
          [order.id],
        );
      }
      return;
    }
    const providerId = String(evidence.id);
    if (!/^[1-9][0-9]*$/.test(providerId)) {
      throw new ServiceUnavailableException(
        'Flutterwave transaction ID is unavailable.',
      );
    }

    await this.db.transaction(async (tx) => {
      // Same lock order as checkout creation. Credit purchases also lock this account
      // before changing inventory so a simultaneous gear award cannot overwrite it.
      const [account] = await tx.query<AccountInventory[]>(
        'SELECT gear,fighter_ids FROM game_accounts WHERE id=$1 FOR UPDATE',
        [order.account_id],
      );
      const [current] = await tx.query<OrderRow[]>(
        'SELECT * FROM game_checkout_orders WHERE id=$1 FOR UPDATE',
        [order.id],
      );
      if (current.status !== 'PENDING' && current.status !== 'EXPIRED') return;
      const [other] = await tx.query<{ id: string }[]>(
        'SELECT id FROM game_checkout_orders WHERE provider_mode=$1 AND provider_transaction_id=$2 AND id<>$3',
        [order.provider_mode, providerId, order.id],
      );
      const reason = other
        ? 'TRANSACTION_ALREADY_USED'
        : evidence.amount !== order.amount_minor ||
            evidence.currency !== order.currency
          ? 'AMOUNT_OR_CURRENCY_MISMATCH'
          : owns(account, order.gear_id) || await ownsCinderSkill(tx, order.account_id, order.gear_id)
            ? 'ALREADY_OWNED'
            : null;
      if (reason) {
        await tx.query(
          "UPDATE game_checkout_orders SET status='REVIEW',review_reason=$2,provider_transaction_id=$3 WHERE id=$1",
          [order.id, reason, other ? null : providerId],
        );
        return;
      }
      const product = current.gear_id;
      if (isCinderBundle(product)) {
        await tx.query('UPDATE game_accounts SET credits=credits+$2 WHERE id=$1',
          [current.account_id, CINDER_BUNDLES[product].cinders]);
      } else if (isItem(product)) {
        await tx.query(
          `UPDATE game_accounts
           SET items=jsonb_set(items, ARRAY[$2::text],
             to_jsonb(COALESCE((items->>($2::text))::integer, 0) + 1))
           WHERE id=$1`,
          [current.account_id, product],
        );
      } else {
        await tx.query(
          isPremiumFighter(product)
            ? 'UPDATE game_accounts SET fighter_ids=fighter_ids || to_jsonb($2::text) WHERE id=$1'
            : 'UPDATE game_accounts SET gear=gear || to_jsonb($2::text) WHERE id=$1',
          [current.account_id, product],
        );
      }
      await tx.query(
        "UPDATE game_checkout_orders SET status='FULFILLED',provider_transaction_id=$2,fulfilled_at=now(),payer_email_hash='' WHERE id=$1",
        [order.id, providerId],
      );
    });
  }

  private assertMode(order: OrderRow) {
    if (this.provider.mode() !== order.provider_mode) {
      throw new ServiceUnavailableException(
        'This checkout belongs to another Flutterwave mode.',
      );
    }
  }

  private async requireOrder(accountId: string, id: string) {
    const [order] = await this.db.query<OrderRow[]>(
      'SELECT * FROM game_checkout_orders WHERE id=$1 AND account_id=$2',
      [id, accountId],
    );
    if (!order) throw new NotFoundException('Game checkout not found.');
    return order;
  }

  private present(order: OrderRow): CheckoutOrder {
    return {
      id: order.id,
      gearId: order.gear_id,
      amountMinor: order.amount_minor,
      currency: order.currency,
      status: order.status,
      expiresAt: order.expires_at,
      checkoutUrl:
        order.status === 'PENDING' &&
        order.provider_mode === this.settings.get('VOTING_PROVIDER_MODE') &&
        order.checkout_url &&
        new Date(order.expires_at).getTime() > Date.now()
          ? this.provider.checkoutUrl(order.checkout_url)
          : null,
    };
  }
}
