import type { FighterId } from '../game.types';


const ATTACKER_COMPANIONS = {
  call_iron_sentinel: {
    fighter: 'knight',
    name: 'Call Iron Sentinel',
    entity: 'Iron Sentinel',
    sprite: 'gate-warden',
    damage: 150,
    price: 600,
  },
  call_dawn_moth: {
    fighter: 'maiden',
    name: 'Call Dawn Moth',
    entity: 'Dawn Moth',
    sprite: 'hollow-specter',
    damage: 140,
    price: 600,
  },
  call_bell_guardian: {
    fighter: 'warden',
    name: 'Call Bell Guardian',
    entity: 'Bell Guardian',
    sprite: 'gate-warden',
    damage: 150,
    price: 600,
  },
  call_shade_hound: {
    fighter: 'duelist',
    name: 'Call Shade Hound',
    entity: 'Shade Hound',
    sprite: 'echo-beast',
    damage: 155,
    price: 600,
  },
  call_spirit_tiger: {
    fighter: 'monk',
    name: 'Call Spirit Tiger',
    entity: 'Spirit Tiger',
    sprite: 'echo-beast',
    damage: 150,
    price: 600,
  },
  call_aether_wraith: {
    fighter: 'arcanist',
    name: 'Call Aether Wraith',
    entity: 'Aether Wraith',
    sprite: 'hollow-specter',
    damage: 155,
    price: 600,
  },
  call_ember_drake: {
    fighter: 'ember-duelist',
    name: 'Call Ember Drake',
    entity: 'Ember Drake',
    sprite: 'echo-beast',
    damage: 160,
    price: 600,
  },
  call_eclipse_echo: {
    fighter: 'eclipse-arcanist',
    name: 'Call Eclipse Echo',
    entity: 'Eclipse Echo',
    sprite: 'hollow-specter',
    damage: 160,
    price: 600,
  },
} as const satisfies Record<
  string,
  {
    fighter: FighterId;
    name: string;
    entity: string;
    sprite: 'gate-warden' | 'hollow-specter' | 'echo-beast';
    damage: number;
    price: number;
  }
>;

export const DUAL_SUMMON_PRODUCT = 'dual_summoning';
export type CompanionRole = 'attacker' | 'healer' | 'buffer';
type AttackerId = keyof typeof ATTACKER_COMPANIONS;
export type CompanionSkillId = AttackerId | `${AttackerId}_healer` | `${AttackerId}_buffer`;
type CompanionSkill = {
  fighter: FighterId;
  name: string;
  entity: string;
  sprite: (typeof ATTACKER_COMPANIONS)[AttackerId]['sprite'];
  damage: number;
  price: number;
  role: CompanionRole;
};

export const COMPANION_SKILLS = Object.fromEntries(
  Object.entries(ATTACKER_COMPANIONS).flatMap(([id, skill]) => [
    [id, { ...skill, role: 'attacker' }],
    [id + '_healer', { ...skill, role: 'healer', name: skill.name + ' Healer', entity: skill.entity + ' Healer' }],
    [id + '_buffer', { ...skill, role: 'buffer', name: skill.name + ' Guardian', entity: skill.entity + ' Guardian' }],
  ]),
) as Record<CompanionSkillId, CompanionSkill>;

export function isCompanionSkill(id: unknown): id is CompanionSkillId {
  return typeof id === 'string' && Object.hasOwn(COMPANION_SKILLS, id);
}

export function companionSkillDescription(id: CompanionSkillId) {
  const { entity, damage, role } = COMPANION_SKILLS[id];
  if (role === 'healer') return 'Summon ' + entity + ' to heal the most injured living ally for up to 90 HP per allied turn.';
  if (role === 'buffer') return 'Summon ' + entity + ' to renew Rage on its owner whenever the attack buff expires.';
  return `Summon ${entity} once per battle. It attacks independently once per allied turn for up to ${damage} extra damage each.`;
}
