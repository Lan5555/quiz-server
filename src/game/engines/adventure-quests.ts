import type { AdventureInteraction, AdventureQuest } from '../game.types';

const objectives = [
  { kind: 'collect', targets: ['oil', 'flint'] },
  { kind: 'rune', targets: ['moon', 'wave', 'bell'] },
  { kind: 'collect', targets: ['print', 'fur', 'ice'] },
  { kind: 'rune', targets: ['flame', 'bell', 'moon'] },
  { kind: 'collect', targets: ['silver', 'glass'] },
  { kind: 'rune', targets: ['bell', 'moon', 'flame'] },
] as const;

export function createAdventureQuest(): AdventureQuest {
  return { accepted: false, progress: [], ready: false };
}

export function applyAdventureInteraction(
  index: number,
  quest: AdventureQuest,
  action: AdventureInteraction,
  target?: string,
): AdventureQuest | undefined {
  const objective = objectives[index];
  if (!objective) return;
  if (action === 'talk') return quest.accepted ? quest : { ...quest, accepted: true };
  const targets: readonly string[] = objective.targets;
  if (!quest.accepted || quest.ready || action !== objective.kind || !target || !targets.includes(target)) return;
  if (action === 'collect' && quest.progress.includes(target)) return quest;
  if (action === 'rune' && target !== targets[quest.progress.length]) {
    return { ...quest, progress: target === targets[0] ? [target] : [], incorrect: true };
  }
  const progress = [...quest.progress, target];
  return { ...quest, progress, ready: progress.length === targets.length, incorrect: false };
}
