import type { CpuAbilityId, CpuPhase, CpuPersonality, EncounterPath } from '../game.types';

export interface EncounterLevel {
  id: string;
  name: string;
  hint: string;
  hp: number;
  attack: number;
  personality: CpuPersonality;
  abilities: CpuAbilityId[];
  signatureEveryNRounds: number;
  signatureMultiplier: number;
  phases?: CpuPhase[];
}

export const ENCOUNTER_LEVELS: readonly EncounterLevel[] = [
  { id: 'ironbound-sentry', name: 'Ironbound Sentry', hint: 'Break its rhythm before its fourth-round signature.',
    hp: 1500, attack: 145, personality: 'strategic', abilities: ['rend', 'howl'],
    signatureEveryNRounds: 4, signatureMultiplier: 1.35 },
  { id: 'mourning-wisp', name: 'Mourning Wisp', hint: 'Save burst damage for when it tries to recover.',
    hp: 1750, attack: 157, personality: 'defensive', abilities: ['drain', 'mend', 'rend'],
    signatureEveryNRounds: 4, signatureMultiplier: 1.45 },
  { id: 'rimefang-stalker', name: 'Rimefang Stalker', hint: 'It hunts weakened and exposed fighters.',
    hp: 2050, attack: 174, personality: 'aggressive', abilities: ['rend', 'sweep', 'howl'],
    signatureEveryNRounds: 3, signatureMultiplier: 1.45 },
  { id: 'bellkeeper', name: 'Bellkeeper', hint: 'Its ringing grows into a team-wide assault.',
    hp: 2444, attack: 192, personality: 'strategic', abilities: ['sweep', 'crush', 'howl'],
    signatureEveryNRounds: 3, signatureMultiplier: 1.55 },
  { id: 'ashen-matriarch', name: 'Ashen Matriarch', hint: 'Deny her recovery, then brace for her enraged phase.',
    hp: 2756, attack: 208, personality: 'boss', abilities: ['drain', 'mend', 'rend', 'sweep'],
    signatureEveryNRounds: 3, signatureMultiplier: 1.6,
    phases: [{ hpThreshold: 0.4, attackMultiplier: 1.2, announcement: 'The Ashen Matriarch ignites her crown.' }] },
  { id: 'crownless-king', name: 'Crownless King', hint: 'His crown breaks twice. Watch the signature warnings.',
    hp: 3484, attack: 232, personality: 'boss', abilities: ['rend', 'drain', 'crush', 'sweep', 'mend'],
    signatureEveryNRounds: 3, signatureMultiplier: 1.7,
    phases: [
      { hpThreshold: 0.65, attackMultiplier: 1.15, announcement: 'The Crownless King shatters his first crown.' },
      { hpThreshold: 0.3, attackMultiplier: 1.32, announcement: 'The Crownless King tears off his broken crown.' },
    ] },
];


const NEW_ENCOUNTERS: readonly EncounterLevel[] = [
  { id: 'thorn-revenant', name: 'Thorn Revenant', hint: 'Guard against its spear and use brief openings to break its stance.',
    hp: 2600, attack: 207, personality: 'strategic', abilities: ['rend', 'crush'], signatureEveryNRounds: 4, signatureMultiplier: 1.42 },
  { id: 'saltglass-oracle', name: 'Saltglass Oracle', hint: 'Focus the Oracle before she can recover lost health.',
    hp: 2790, attack: 212, personality: 'defensive', abilities: ['drain', 'mend'], signatureEveryNRounds: 4, signatureMultiplier: 1.47 },
  { id: 'graveshell-colossus', name: 'Graveshell Colossus', hint: 'Keep a guard ready for Ruin.',
    hp: 3100, attack: 218, personality: 'strategic', abilities: ['crush', 'rend'], signatureEveryNRounds: 3, signatureMultiplier: 1.5 },
  { id: 'mothveil-duchess', name: 'Mothveil Duchess', hint: 'Avoid giving her an easy target to drain.',
    hp: 2870, attack: 226, personality: 'defensive', abilities: ['drain', 'rend', 'mend'], signatureEveryNRounds: 4, signatureMultiplier: 1.54 },
  { id: 'cinder-jackal', name: 'Cinder Jackal', hint: 'Its howl makes its next attacks more dangerous.',
    hp: 2920, attack: 233, personality: 'aggressive', abilities: ['howl', 'sweep', 'rend'], signatureEveryNRounds: 3, signatureMultiplier: 1.48 },
  { id: 'tidebound-executioner', name: 'Tidebound Executioner', hint: 'Brace for heavy area attacks and focus on one opponent at a time.',
    hp: 3800, attack: 247, personality: 'boss', abilities: ['crush', 'sweep', 'drain'], signatureEveryNRounds: 3, signatureMultiplier: 1.65,
    phases: [{ hpThreshold: 0.45, attackMultiplier: 1.2, announcement: 'The Tidebound Executioner wrenches its anchor free.' }] },
];

const roster = [...ENCOUNTER_LEVELS, ...NEW_ENCOUNTERS];

export function createEncounterPath(adventure = false, tier = 1, previousFirst?: string): EncounterPath {
  const lineup = adventure ? [...ENCOUNTER_LEVELS] : [...roster];
  if (!adventure && tier > 1) {
    for (let index = lineup.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [lineup[index], lineup[other]] = [lineup[other], lineup[index]];
    }
    if (lineup[0].id === previousFirst) lineup.push(lineup.shift()!);
  }
  return {
    index: 0,
    status: 'active',
    ...(adventure ? {} : { tier }),
    levels: lineup.map(({ id, name, hint }, index) => {
      const count = adventure || index < 2 && tier === 1
        ? 0
        : index % 4 === 3 || (tier >= 3 && index % 3 === 2) ? 2 : 1;
      const allies = Array.from({ length: count }, (_, offset) => {
        const ally = lineup[(index + 3 + offset * 4) % lineup.length];
        return { id: ally.id, name: ally.name };
      });
      return { id, name, hint, ...(allies.length ? { allies } : {}) };
    }),
  };
}

export function encounterOpponents(path: EncounterPath): EncounterLevel[] {
  const level = path.levels[path.index];
  if (!level) return [];
  const ids = [level.id, ...(level.allies ?? []).map(({ id }) => id)];
  const tierOffset = Math.max(0, Math.min(60, (path.tier ?? 1) - 1));
  const hpMultiplier = 2 ** tierOffset;
  const attackMultiplier = Math.sqrt(1 + tierOffset * 0.21);
  const healthShare = ids.length === 1 ? 1 : ids.length === 2 ? 0.57 : 0.43;
  const attackShare = ids.length === 1 ? 1 : ids.length === 2 ? 0.62 : 0.47;
  // Keep each HP value and the party's combined HP within the safe integer range.
  const hpCeiling = Math.floor(Number.MAX_SAFE_INTEGER / ids.length);
  return ids.flatMap((id) => {
    const enemy = roster.find((entry) => entry.id === id);
    if (!enemy) return [];
    const hp = Math.min(hpCeiling, Math.round(enemy.hp * healthShare) * hpMultiplier);
    return [{ ...enemy, hp, attack: Math.round(enemy.attack * attackMultiplier * attackShare) }];
  });
}
