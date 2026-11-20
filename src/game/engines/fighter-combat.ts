import type {
  FighterId,
  HealId,
  SkillId,
  StatusEffect,
  StatusId,
} from '../game.types';
import {
  COMPANION_SKILLS,
  companionSkillDescription,
  type CompanionSkillId,
} from '../progression/companion-skills';

export const STATUS_TICK_HP = {
  poisoned: -70,
  burning: -45,
  blessed: 60,
} as const;
export const CURSE_MULTIPLIER = 0.75;
export const RAGE_MULTIPLIER = 1.2;
export const WARDEN_HEAL_BONUS = 90;

export const SKILLS = {
  oathbreaker_aegis: { name: 'Oathbreaker Aegis', description: 'Drive your shield into the enemy and gain Guarded. If you were already Guarded, deal 80 extra base damage.', damage: [180, 220], effect: 'guarded', target: 'self' },
  dawnglass_verdict: { name: 'Dawnglass Verdict', description: 'Strike and gain Blessed. If you were already Blessed, deal 85 extra base damage.', damage: [185, 220], effect: 'blessed', target: 'self' },
  gravebell_collapse: { name: 'Gravebell Collapse', description: 'Crush and Curse the enemy. Deal 115 extra base damage if they are Broken.', damage: [195, 235], effect: 'cursed', target: 'enemy' },
  phantom_thread: { name: 'Phantom Thread', description: 'Strike and gain Evading. A successful dodge empowers your next Phantom Thread with 110 extra base damage.', damage: [175, 215], effect: 'evading', target: 'self' },
  thunder_meridian: { name: 'Thunder Meridian', description: 'Strike and Curse the target. If you have 40 Focus, spend it to add 130 base damage.', damage: [180, 220], effect: 'cursed', target: 'enemy' },
  astral_convergence: { name: 'Astral Convergence', description: 'Mark the target with Curse. Add 45 base damage per different affliction already on the target.', damage: [185, 225], effect: 'cursed', target: 'enemy' },
  pyre_afterimage: { name: 'Pyre Afterimage', description: 'Cut through the enemy and ignite them. Deal 85 extra base damage if they are already Burning.', damage: [190, 225], effect: 'burning', target: 'enemy' },
  black_sun_cascade: { name: 'Black Sun Cascade', description: 'Collapse a black sun onto the target and leave them Burning. Deal 105 extra base damage at or below half health.', damage: [185, 225], effect: 'burning', target: 'enemy' },
  astral_severance: { name: 'Astral Severance', description: 'Leave a damaging fracture (Poison). Evade a hit first to empower the next slash.', damage: [185, 220], effect: 'poisoned', target: 'enemy' },
  crimson_waltz: { name: 'Crimson Waltz', description: 'Cut and gain Evading. Spend 40 Focus, when available, on a stronger finishing strike.', damage: [190, 230], effect: 'evading', target: 'self' },
  moonveil_reflection: { name: 'Moonveil Reflection', description: 'Strike and raise a guard. The strike deals more damage if you are already Guarded.', damage: [180, 215], effect: 'guarded', target: 'self' },
  unwritten_end: { name: 'The Unwritten End', description: 'Curse the target. Deal additional damage against enemies at 15% HP or less.', damage: [185, 225], effect: 'cursed', target: 'enemy' },
  chronos_elegy: { name: 'Chronos Elegy', description: 'Weaken the target with Cursed. Deal additional damage if the target is already Broken.', damage: [185, 230], effect: 'cursed', target: 'enemy' },
  funeral_of_stars: { name: 'Funeral of Stars', description: 'Burn the target. Deal more damage against a target that is already Burning.', damage: [195, 240], effect: 'burning', target: 'enemy' },
  iron_cleave: {
    name: 'Iron Cleave',
    description: 'Strike and guard against incoming hits for 3 turns.',
    damage: [190, 250],
    effect: 'guarded',
    target: 'self',
  },
  dawnstrike: {
    name: 'Dawnstrike',
    description: 'Strike and gain Blessed, restoring HP over time.',
    damage: [185, 235],
    effect: 'blessed',
    target: 'self',
  },
  shadow_strike: {
    name: 'Shadow Strike',
    description: 'Poison the target for 70 damage per turn.',
    damage: [180, 240],
    effect: 'poisoned',
    target: 'enemy',
  },
  blood_rage: {
    name: 'Blood Rage',
    description: 'Strike and gain Enraged, increasing outgoing damage by 20%.',
    damage: [200, 265],
    effect: 'enraged',
    target: 'self',
  },
  fire_burst: {
    name: 'Fire Burst',
    description: 'Burn the target for 45 damage per turn.',
    damage: [200, 260],
    effect: 'burning',
    target: 'enemy',
  },
  void_blast: {
    name: 'Void Blast',
    description: 'Curse the target, reducing its outgoing damage by 25%.',
    damage: [200, 270],
    effect: 'cursed',
    target: 'enemy',
  },
  spirit_palm: {
    name: 'Spirit Palm',
    description: 'Strike and gain a chance to evade incoming hits for 3 turns.',
    damage: [185, 250],
    effect: 'evading',
    target: 'self',
  },
  astral_bind: {
    name: 'Astral Bind',
    description: 'Poison the target for 70 damage per turn.',
    damage: [175, 235],
    effect: 'poisoned',
    target: 'enemy',
  },
  blacksteel_rebuke: {
    name: 'Blacksteel Rebuke',
    description: 'Crush the target and gain Enraged.',
    damage: [205, 260],
    effect: 'enraged',
    target: 'self',
  },
  sunbrand: {
    name: 'Sunbrand',
    description: 'Sear the target and inflict Cursed.',
    damage: [195, 250],
    effect: 'cursed',
    target: 'enemy',
  },
  bellstroke: {
    name: 'Bellstroke',
    description:
      'Strike with a cursed bell and weaken the target’s outgoing damage.',
    damage: [205, 245],
    effect: 'cursed',
    target: 'enemy',
  },
  riposte: {
    name: 'Riposte',
    description: 'Counter with a sharp thrust and gain Guarded.',
    damage: [200, 250],
    effect: 'guarded',
    target: 'self',
  },
  thunder_kata: {
    name: 'Thunder Kata',
    description: 'Hit with a thunderous palm and gain Blessed.',
    damage: [195, 250],
    effect: 'blessed',
    target: 'self',
  },
  hex_lance: {
    name: 'Hex Lance',
    description: 'Pierce the target with a poisoned arcane lance.',
    damage: [215, 270],
    effect: 'poisoned',
    target: 'enemy',
  },
  cinderstep: {
    name: 'Cinderstep',
    description: 'Strike through smoke and gain Evading.',
    damage: [200, 260],
    effect: 'evading',
    target: 'self',
  },
  eclipse_sigil: {
    name: 'Eclipse Sigil',
    description: 'Engrave a sigil on the target that inflicts Burning.',
    damage: [210, 270],
    effect: 'burning',
    target: 'enemy',
  },
} as const satisfies Record<
  SkillId,
  {
    name: string;
    description: string;
    damage: readonly [number, number];
    effect: StatusId;
    target: 'self' | 'enemy';
  }
>;

type Heal = {
  name: string;
  amount: number;
  target: 'self' | 'ally';
  effect?: 'guarded' | 'blessed' | 'evading' | 'cleanse';
};
type Kit = {
  skills: readonly [SkillId, SkillId, SkillId] | readonly [SkillId, SkillId, SkillId, SkillId];
  heal: Heal;
  recovery: Heal;
  wardKit?: boolean;
};

const KITS = {
  'lady-ley': {
    skills: ['astral_severance', 'crimson_waltz', 'moonveil_reflection'],
    heal: { name: 'Lunar Mending', amount: 295, target: 'self', effect: 'evading' },
    recovery: { name: 'Dawn Thread', amount: 235, target: 'ally', effect: 'cleanse' },
  },
  'grave-chorister': {
    skills: ['unwritten_end', 'chronos_elegy', 'funeral_of_stars'],
    heal: { name: 'Grave Hymn', amount: 325, target: 'ally', effect: 'blessed' },
    recovery: { name: 'Quietus', amount: 245, target: 'self', effect: 'guarded' },
    wardKit: true,
  },
  knight: {
    skills: ['iron_cleave', 'blood_rage', 'blacksteel_rebuke', 'oathbreaker_aegis'],
    recovery: {
      name: 'Shieldmate',
      amount: 230,
      target: 'ally',
      effect: 'guarded',
    },
    wardKit: true,
    heal: {
      name: 'Second Wind',
      amount: 300,
      target: 'self',
      effect: 'guarded',
    },
  },
  maiden: {
    skills: ['dawnstrike', 'fire_burst', 'sunbrand', 'dawnglass_verdict'],
    recovery: {
      name: 'Purifying Hymn',
      amount: 235,
      target: 'ally',
      effect: 'cleanse',
    },
    heal: { name: 'Dawnlight', amount: 380, target: 'ally', effect: 'blessed' },
  },
  warden: {
    skills: ['iron_cleave', 'dawnstrike', 'bellstroke', 'gravebell_collapse'],
    recovery: {
      name: 'Bastion Rite',
      amount: 275,
      target: 'self',
      effect: 'cleanse',
    },
    wardKit: true,
    heal: { name: 'Sanctuary', amount: 350, target: 'ally', effect: 'guarded' },
  },
  duelist: {
    skills: ['shadow_strike', 'spirit_palm', 'riposte', 'phantom_thread'],
    recovery: {
      name: 'Poison Salve',
      amount: 205,
      target: 'ally',
      effect: 'cleanse',
    },
    heal: {
      name: 'Quick Recovery',
      amount: 290,
      target: 'self',
      effect: 'evading',
    },
  },
  monk: {
    skills: ['spirit_palm', 'blood_rage', 'thunder_kata', 'thunder_meridian'],
    recovery: {
      name: 'Shared Stillness',
      amount: 240,
      target: 'ally',
      effect: 'blessed',
    },
    wardKit: true,
    heal: {
      name: 'Centering Breath',
      amount: 360,
      target: 'self',
      effect: 'cleanse',
    },
  },
  arcanist: {
    skills: ['fire_burst', 'void_blast', 'hex_lance', 'astral_convergence'],
    recovery: {
      name: 'Aether Veil',
      amount: 265,
      target: 'self',
      effect: 'evading',
    },
    heal: {
      name: 'Aether Mend',
      amount: 330,
      target: 'ally',
      effect: 'cleanse',
    },
  },
  'ember-duelist': {
    skills: ['fire_burst', 'shadow_strike', 'cinderstep', 'pyre_afterimage'],
    recovery: {
      name: 'Cauterize',
      amount: 255,
      target: 'ally',
      effect: 'cleanse',
    },
    heal: { name: 'Kindle', amount: 280, target: 'self', effect: 'blessed' },
  },
  'eclipse-arcanist': {
    skills: ['void_blast', 'astral_bind', 'eclipse_sigil', 'black_sun_cascade'],
    recovery: {
      name: 'Umbral Shelter',
      amount: 260,
      target: 'self',
      effect: 'guarded',
    },
    wardKit: true,
    heal: { name: 'Moonwell', amount: 365, target: 'ally', effect: 'cleanse' },
  },
} as const satisfies Record<FighterId, Kit>;

export type CombatKit = {
  skills: {
    id: SkillId | CompanionSkillId;
    name: string;
    description: string;
    summon?: boolean;
  }[];
  heals: (Heal & { id: HealId })[];
  heal: {
    name: string;
    amount: number;
    target: Heal['target'];
    effect?: Heal['effect'];
  };
};

export function fighterKit(fighterId?: FighterId): Kit {
  return fighterId && Object.hasOwn(KITS, fighterId)
    ? KITS[fighterId]
    : KITS.knight;
}

export function fighterCompanionSkills(
  fighterId?: FighterId,
  unlocked: readonly CompanionSkillId[] = [],
) {
  return unlocked.filter(
    (id) => COMPANION_SKILLS[id]?.fighter === (fighterId ?? 'knight'),
  );
}

export function starterBattleItems(fighterId?: FighterId) {
  const wardKit = fighterKit(fighterId).wardKit;
  return { bloodleaf_tonic: wardKit ? 1 : 2, ward_stone: wardKit ? 2 : 1 };
}

export function presentCombatKit(
  fighterId?: FighterId,
  unlocked?: readonly CompanionSkillId[],
): CombatKit {
  const kit = fighterKit(fighterId);
  return {
    skills: [
      ...kit.skills.map((id) => ({
        id,
        name: SKILLS[id].name,
        description: SKILLS[id].description,
      })),
      ...fighterCompanionSkills(fighterId, unlocked).map((id) => ({
        id,
        name: COMPANION_SKILLS[id].name,
        description: companionSkillDescription(id),
        summon: true,
      })),
    ],
    heal: kit.heal,
    heals: [
      { id: 'signature_recovery', ...kit.heal },
      { id: 'field_recovery', ...kit.recovery },
    ],
  };
}

export function outgoingMultiplier(effects: readonly StatusEffect[] = []) {
  const cursed = effects.some(({ id }) => id === 'cursed');
  const enraged = effects.some(({ id }) => id === 'enraged');
  return (cursed ? CURSE_MULTIPLIER : 1) * (enraged ? RAGE_MULTIPLIER : 1);
}

export function isAffliction(id: StatusId) {
  return id === 'poisoned' || id === 'cursed' || id === 'burning';
}
