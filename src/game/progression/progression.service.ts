import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { EncounterPath } from '../game.types';
import {
  GEAR,
  ITEMS,
  ITEM_EFFECTS,
  JOBS,
  PITY_AT,
  SUMMON_COST,
  SUMMON_POOL,
  isGear,
  isItem,
} from './catalog';
import type { GearId, ItemId, Loadout, PremiumFighterId } from './catalog';
import {
  COMPANION_SKILLS,
  companionSkillDescription,
  isCompanionSkill,
  type CompanionSkillId,
} from './companion-skills';

import { customItems } from './shop-items';

export interface Profile {
  id: string;
  username: string;
  moderator: boolean;
  credits: number;
  xp: number;
  progression: ReturnType<typeof experience>;
  pity: number;
  gear: GearId[];
  fighters: PremiumFighterId[];
  items: Partial<Record<ItemId, number>>;
  unlockedSkills: CompanionSkillId[];
  loadout: Loadout;
}

export interface PurchaseResult {
  itemId: GearId | ItemId | CompanionSkillId;
  duplicateCredits: number;
  spent: number;
  guaranteed: boolean;
}

interface EncounterCheckpoint {
  tier: number;
  cleared: 6 | 12;
  levels: EncounterPath['levels'];
}

const ENCOUNTER_COMPLETION_REWARD = { cinders: 180, xp: 100 };

export const BATTLE_CINDERS = 30;
export const BATTLE_XP = 25;
const XP_PER_LEVEL = 100;

export function experience(xp: number) {
  const levelsEarned = Math.floor(xp / XP_PER_LEVEL);
  return {
    level: levelsEarned + 1,
    current: xp % XP_PER_LEVEL,
    required: XP_PER_LEVEL,
    attack: levelsEarned * 2,
    defense: levelsEarned,
    speed: Math.floor(levelsEarned / 2) + 1,
  };
}

@Injectable()
export class ProgressionService {
  constructor(private readonly db: DataSource) {}

  async catalog() {
    const custom = await customItems(this.db.manager);
    return {
      gear: GEAR,
      items: { ...ITEMS, ...Object.fromEntries(custom.map((item) => [item.id, item])) },
      skills: Object.fromEntries(
        Object.entries(COMPANION_SKILLS).map(([id, skill]) => [
          id,
          {
            name: skill.name,
            fighter: skill.fighter,
            price: skill.price,
            description: companionSkillDescription(id as CompanionSkillId),
          },
        ]),
      ),
      jobs: JOBS,
      reward: BATTLE_CINDERS,
      battleXp: BATTLE_XP,
      summon: {
        cost: SUMMON_COST,
        pityAt: PITY_AT,
        pool: SUMMON_POOL,
        duplicateCredits: 35,
      },
    };
  }

  async profile(id: string, tx = this.db.manager, lock = false) {
    const [profile] = await tx.query<Profile[]>(
      `SELECT id,username,moderator,credits,xp,pity,gear,fighter_ids AS fighters,items,loadout FROM game_accounts WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    if (!profile) throw new NotFoundException('Game account not found.');
    profile.progression = experience(profile.xp);
    profile.unlockedSkills = await this.unlockedSkills(id, tx);
    return profile;
  }

  private async unlockedSkills(id: string, tx = this.db.manager) {
    const rows = await tx.query<{ product: CompanionSkillId }[]>(
      'SELECT DISTINCT product FROM game_purchases WHERE account_id=$1 AND product=ANY($2::text[]) ORDER BY product',
      [id, Object.keys(COMPANION_SKILLS)],
    );
    return rows.map(({ product }) => product);
  }

  async roomLoadout(id: string): Promise<Loadout> {
    const [account] = await this.db.query<{ loadout: Loadout; xp: number }[]>(
      'SELECT loadout,xp FROM game_accounts WHERE id=$1',
      [id],
    );
    if (!account) throw new NotFoundException('Game account not found.');
    const unlockedSkills = await this.unlockedSkills(id);
    const item = account.loadout.item;
    const equippedItem = isItem(item)
      ? { ...ITEMS[item], ...ITEM_EFFECTS[item] }
      : (await customItems(this.db.manager, item))[0];
    const { attack, defense, speed } = experience(account.xp);
    return {
      ...account.loadout,
      ...(unlockedSkills.length ? { unlockedSkills } : {}),
      equippedItem,
      strength: { attack, defense, speed },
    };
  }

  async saveLoadout(id: string, loadout: Loadout) {
    return this.db.transaction(async (tx) => {
      const profile = await this.profile(id, tx, true);
      const { job, weapon, armor, item } = loadout;
      const canEquipItem = item === profile.loadout.item || (profile.items[item] ?? 0) > 0;
      if (
        !Object.hasOwn(JOBS, job) ||
        !isGear(weapon) ||
        !isGear(armor) ||
        (!(item === 'bloodleaf_tonic' || item === 'ward_stone') &&
          (!canEquipItem || (!isItem(item) && !(await customItems(tx, item)).length))) ||
        GEAR[weapon].slot !== 'weapon' ||
        GEAR[armor].slot !== 'armor' ||
        !profile.gear.includes(weapon) ||
        !profile.gear.includes(armor)
      ) {
        throw new BadRequestException('Choose a job and equipment you own.');
      }
      profile.loadout = { job, weapon, armor, item };
      await tx.query('UPDATE game_accounts SET loadout=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(profile.loadout),
      ]);
      return profile;
    });
  }

  async purchase(id: string, requestId: string, product: string) {
    return this.db.transaction(async (tx) => {
      const profile = await this.profile(id, tx, true);
      const [previous] = await tx.query<
        { product: string; result: PurchaseResult }[]
      >(
        'SELECT product,result FROM game_purchases WHERE account_id=$1 AND request_id=$2',
        [id, requestId],
      );
      if (previous) {
        if (previous.product !== product)
          throw new ConflictException(
            'This request ID belongs to a different purchase.',
          );
        return { result: previous.result, profile };
      }

      const summon = product === 'summon';
      const guaranteed = summon && profile.pity === PITY_AT - 1;
      const itemId = summon ? this.rollSummon(guaranteed) : product;
      const skill = isCompanionSkill(itemId)
        ? COMPANION_SKILLS[itemId]
        : undefined;
      const gear = isGear(itemId) ? GEAR[itemId] : undefined;
      const item = isItem(itemId) ? ITEMS[itemId]
        : !gear && !skill && itemId.startsWith('custom_')
          ? (await customItems(tx, itemId))[0]
          : undefined;
      const price = skill?.price ?? gear?.price ?? item?.price;
      if (price === undefined || (!summon && price <= 0))
        throw new BadRequestException('This item is not sold for Cinders.');
      if (skill && isCompanionSkill(itemId)) {
        if (profile.unlockedSkills.includes(itemId))
          throw new ConflictException('You already own this skill.');
        if (
          skill.fighter === 'ember-duelist' ||
          skill.fighter === 'eclipse-arcanist'
        ) {
          if (!profile.fighters.includes(skill.fighter))
            throw new ConflictException(
              'Unlock this fighter before buying their skill.',
            );
        }
        profile.unlockedSkills.push(itemId);
      }
      const spent = summon ? SUMMON_COST : price;
      if (profile.credits < spent)
        throw new ConflictException('You do not have enough credits.');
      let duplicateCredits = 0;
      if (isGear(itemId)) {
        if (profile.gear.includes(itemId)) {
          if (!summon)
            throw new ConflictException('You already own this equipment.');
          duplicateCredits = 35;
        } else {
          profile.gear.push(itemId);
        }
      } else if (item) {
        const id = itemId as ItemId;
        profile.items[id] = (profile.items[id] ?? 0) + 1;
      }
      profile.credits += duplicateCredits - spent;
      if (summon)
        profile.pity = gear?.rarity === 'legendary' ? 0 : profile.pity + 1;
      const result: PurchaseResult = { itemId: itemId as PurchaseResult['itemId'], duplicateCredits, spent, guaranteed };
      await tx.query(
        'UPDATE game_accounts SET credits=$2,pity=$3,gear=$4::jsonb,items=$5::jsonb WHERE id=$1',
        [
          id,
          profile.credits,
          profile.pity,
          JSON.stringify(profile.gear),
          JSON.stringify(profile.items),
        ],
      );
      await tx.query(
        'INSERT INTO game_purchases(account_id,request_id,product,result) VALUES ($1,$2,$3,$4::jsonb)',
        [id, requestId, product, JSON.stringify(result)],
      );
      return { result, profile };
    });
  }

  async consumeItem(id: string, item: ItemId) {
    const rows = await this.db.query<unknown[]>(
      `WITH spent AS (
        UPDATE game_accounts
        SET items=jsonb_set(items, ARRAY[$2::text], to_jsonb((items->>$2)::int-1))
        WHERE id=$1 AND (items->>$2)::int>0
        RETURNING id
      ) SELECT id FROM spent`,
      [id, item],
    );
    return rows.length > 0;
  }

  async encounterCheckpoint(id: string, tx = this.db.manager) {
    const [checkpoint] = await tx.query<EncounterCheckpoint[]>(
      'SELECT tier, cleared, levels FROM game_encounter_checkpoints WHERE account_id=$1',
      [id],
    );
    return checkpoint;
  }

  async saveEncounterCheckpoint(id: string, path: EncounterPath, cleared: 6 | 12) {
    const tier = path.tier ?? 1;
    return this.db.transaction(async (tx) => {
      // The account lock also covers a player's first checkpoint, before a row exists.
      const [account] = await tx.query<{ id: string }[]>('SELECT id FROM game_accounts WHERE id=$1 FOR UPDATE', [id]);
      if (!account) throw new NotFoundException('Game account not found.');
      const previous = await this.encounterCheckpoint(id, tx);
      if (previous && previous.tier > tier) return {};
      if (previous?.tier === tier && previous.cleared >= cleared) return { savedWins: previous.cleared };
      if (tier !== (previous?.tier ?? 1) && (previous?.cleared !== 12 || tier !== previous.tier + 1)) {
        throw new ConflictException('Clear the current difficulty before saving a higher tier.');
      }
      await tx.query(`
        INSERT INTO game_encounter_checkpoints (account_id, tier, cleared, levels) VALUES ($1,$2,$3,$4::jsonb)
        ON CONFLICT (account_id) DO UPDATE SET tier=EXCLUDED.tier, cleared=EXCLUDED.cleared, levels=EXCLUDED.levels
      `, [id, tier, cleared, JSON.stringify(path.levels)]);
      if (cleared === 6) return { savedWins: cleared };
      const reward = ENCOUNTER_COMPLETION_REWARD;
      const [updated] = await tx.query<{ xp: number }[]>(
        'UPDATE game_accounts SET credits=credits+$2,xp=xp+$3 WHERE id=$1 RETURNING xp',
        [id, reward.cinders, reward.xp],
      );
      return { savedWins: cleared, reward, progression: experience(updated.xp) };
    });
  }

  async reward(id: string, battleId: string) {
    const [updated] = await this.db.query<{ xp: number }[]>(
      `WITH reward AS (
        INSERT INTO game_battle_rewards(account_id,battle_id) VALUES ($1,$2)
        ON CONFLICT DO NOTHING RETURNING account_id
      ), awarded AS (
        UPDATE game_accounts SET credits=credits+$3,xp=xp+$4
        WHERE id IN (SELECT account_id FROM reward) RETURNING xp
      ) SELECT xp FROM awarded`,
      [id, battleId, BATTLE_CINDERS, BATTLE_XP],
    );
    return updated ? experience(updated.xp) : undefined;
  }

  private rollSummon(guaranteed: boolean) {
    const pool: ReadonlyArray<(typeof SUMMON_POOL)[number]> = guaranteed
      ? SUMMON_POOL.filter(
          ({ id }) => isGear(id) && GEAR[id].rarity === 'legendary',
        )
      : SUMMON_POOL;
    let ticket = randomInt(
      pool.reduce((total, entry) => total + entry.weight, 0),
    );
    for (const entry of pool) {
      ticket -= entry.weight;
      if (ticket < 0) return entry.id;
    }
    throw new Error('Invalid summon pool');
  }
}
