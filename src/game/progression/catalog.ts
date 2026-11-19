import type { CompanionSkillId } from './companion-skills';

export const PREMIUM_FIGHTERS = {
  'ember-duelist': { name: 'Ember Duelist', amountMinor: 350_000 },
  'eclipse-arcanist': { name: 'Eclipse Arcanist', amountMinor: 350_000 },
} as const;

export type PremiumFighterId = keyof typeof PREMIUM_FIGHTERS;

export function isPremiumFighter(id: unknown): id is PremiumFighterId {
  return typeof id === 'string' && Object.hasOwn(PREMIUM_FIGHTERS, id);
}

export const GEAR = {
  crownforged_blade: { name: 'Crownforged Blade', slot: 'weapon', rarity: 'legendary', attack: 65, armor: 0, price: 0 },
  sovereign_plate: { name: 'Sovereign Plate', slot: 'armor', rarity: 'legendary', attack: 0, armor: 45, price: 0 },
  iron_blade: {
    name: 'Iron Blade',
    slot: 'weapon',
    rarity: 'common',
    attack: 0,
    armor: 0,
    price: 0,
  },
  traveler_coat: {
    name: 'Traveler Coat',
    slot: 'armor',
    rarity: 'common',
    attack: 0,
    armor: 0,
    price: 0,
  },
  ashblade: {
    name: 'Ashblade',
    slot: 'weapon',
    rarity: 'rare',
    attack: 25,
    armor: 0,
    price: 500,
  },
  bellwarden_mail: {
    name: 'Bellwarden Mail',
    slot: 'armor',
    rarity: 'rare',
    attack: 0,
    armor: 18,
    price: 500,
  },
  hollowfang: {
    name: 'Hollowfang',
    slot: 'weapon',
    rarity: 'legendary',
    attack: 45,
    armor: 0,
    price: 900,
  },
  oathkeeper_plate: {
    name: 'Oathkeeper Plate',
    slot: 'armor',
    rarity: 'legendary',
    attack: 0,
    armor: 30,
    price: 900,
  },
} as const;

export const ITEMS = {
  royal_bloodleaf: { name: 'Royal Bloodleaf', description: 'Restore 480 HP to yourself or a living ally.', price: 0 },
  sovereign_ward: { name: 'Sovereign Ward', description: 'Guard yourself and add 45 Focus.', price: 0 },
  bloodleaf_tonic: {
    name: 'Bloodleaf Tonic',
    description: 'Restore 320 HP to yourself or a living ally.',
    price: 50,
  },
  ward_stone: {
    name: 'Ward Stone',
    description: 'Guard yourself and add 25 Focus.',
    price: 50,
  },
} as const;

export const JOBS = {
  vanguard: { name: 'Vanguard', description: 'Reduce incoming damage by 12.' },
  spellblade: {
    name: 'Spellblade',
    description: 'Deal 25 extra damage with skills.',
  },
  warden: {
    name: 'Warden',
    description: 'Restore 90 extra HP with healing spells.',
  },
} as const;

export type GearId = keyof typeof GEAR;
export type BuiltInItemId = keyof typeof ITEMS;
export type ItemId = BuiltInItemId | `custom_${string}`;
export type ItemEffect = { name: string; description: string; effect: 'heal' | 'guard'; power: number };
export const ITEM_EFFECTS: Record<BuiltInItemId, { effect: ItemEffect['effect']; power: number }> = {
  bloodleaf_tonic: { effect: 'heal', power: 320 },
  ward_stone: { effect: 'guard', power: 25 },
  royal_bloodleaf: { effect: 'heal', power: 480 },
  sovereign_ward: { effect: 'guard', power: 45 },
};
export const CINDER_BUNDLES = {
  cinders_300: { name: '300 Cinders', amountMinor: 100_000, cinders: 300 },
  cinders_1000: { name: '1,000 Cinders', amountMinor: 300_000, cinders: 1000 },
} as const;
export function isCinderBundle(id: string): id is keyof typeof CINDER_BUNDLES {
  return Object.hasOwn(CINDER_BUNDLES, id);
}
export type JobId = keyof typeof JOBS;
export interface Loadout {
  job: JobId;
  weapon: GearId;
  armor: GearId;
  item: ItemId;
  /** Populated by the server when entering or refreshing a room. */
  unlockedSkills?: CompanionSkillId[];
  equippedItem?: ItemEffect;
  strength?: { attack: number; defense: number; speed?: number };
}

export const STARTER_LOADOUT: Loadout = {
  job: 'vanguard',
  weapon: 'iron_blade',
  armor: 'traveler_coat',
  item: 'bloodleaf_tonic',
};

export const SUMMON_COST = 100;
export const PITY_AT = 10;
export const SUMMON_POOL = [
  { id: 'bloodleaf_tonic', weight: 30 },
  { id: 'ward_stone', weight: 30 },
  { id: 'ashblade', weight: 17 },
  { id: 'bellwarden_mail', weight: 17 },
  { id: 'hollowfang', weight: 3 },
  { id: 'oathkeeper_plate', weight: 3 },
] as const;

export function isGear(id: unknown): id is GearId {
  return typeof id === 'string' && Object.hasOwn(GEAR, id);
}

export function isItem(id: unknown): id is BuiltInItemId {
  return typeof id === 'string' && Object.hasOwn(ITEMS, id);
}
