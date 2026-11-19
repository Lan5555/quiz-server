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
  skills: readonly [SkillId, SkillId, SkillId];
  heal: Heal;
  recovery: Heal;
  wardKit?: boolean;
};

const KITS = {
  knight: {
    skills: ['iron_cleave', 'blood_rage', 'blacksteel_rebuke'],
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
    skills: ['dawnstrike', 'fire_burst', 'sunbrand'],
    recovery: {
      name: 'Purifying Hymn',
      amount: 235,
      target: 'ally',
      effect: 'cleanse',
    },
    heal: { name: 'Dawnlight', amount: 380, target: 'ally', effect: 'blessed' },
  },
  warden: {
    skills: ['iron_cleave', 'dawnstrike', 'bellstroke'],
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
    skills: ['shadow_strike', 'spirit_palm', 'riposte'],
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
    skills: ['spirit_palm', 'blood_rage', 'thunder_kata'],
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
    skills: ['fire_burst', 'void_blast', 'hex_lance'],
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
    skills: ['fire_burst', 'shadow_strike', 'cinderstep'],
    recovery: {
      name: 'Cauterize',
      amount: 255,
      target: 'ally',
      effect: 'cleanse',
    },
    heal: { name: 'Kindle', amount: 280, target: 'self', effect: 'blessed' },
  },
  'eclipse-arcanist': {
    skills: ['void_blast', 'astral_bind', 'eclipse_sigil'],
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
