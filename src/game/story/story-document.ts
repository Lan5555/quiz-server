import { BadRequestException } from '@nestjs/common';
import type {
  Cutscene,
  CutsceneLine,
  StoryChoice,
  StoryNode,
} from '../game.types';

export interface StoryDocument {
  initialNodeId: string;
  nodes: Record<string, StoryNode>;
}

export const MAX_STORY_BYTES = 1024 * 1024;
const teams = ['ravens', 'wolves', 'dragons', 'serpents'] as const;
const results = ['safe', 'battle', 'random', 'elimination', 'credits'] as const;
const abilities = ['rend', 'howl', 'sweep', 'crush', 'mend', 'drain'] as const;
const idPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

function invalid(path: string, message: string): never {
  throw new BadRequestException(`${path} ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(path, 'must be a JSON object.');
  return value as Record<string, unknown>;
}

function shape(value: unknown, path: string, keys: string) {
  const record = object(value, path);
  const allowed = keys.split(' ');
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key))
      invalid(`${path}.${key}`, 'is not a supported field.');
  }
  return record;
}

function text(value: unknown, path: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    invalid(path, `must contain 1–${max} characters.`);
  return value;
}

function identifier(value: unknown, path: string) {
  const id = text(value, path, 80);
  if (!idPattern.test(id) || Object.hasOwn(Object.prototype, id))
    invalid(path, 'must use letters, numbers, hyphens or underscores.');
  return id;
}

function asset(value: unknown, path: string) {
  if (value === undefined) return;
  const url = text(value, path, 1000);
  if (/[\s"'()\\<>]/u.test(url)) invalid(path, 'has an invalid asset URL.');
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password)
      return url;
  } catch {
    // Fall through to the same asset validation message.
  }
  invalid(path, 'must be a local asset path or an HTTPS URL.');
}

function named<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (!(allowed as readonly unknown[]).includes(value))
    invalid(path, `must be one of ${allowed.join(', ')}.`);
  return value as T;
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    invalid(path, `must be an array with at most ${max} entries.`);
  return value;
}

function numeric(
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = true,
) {
  if (value === undefined) return;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min ||
    value > max
  )
    invalid(
      path,
      `must be a ${integer ? 'whole ' : ''}number from ${min} to ${max}.`,
    );
  return value;
}

function cutscene(value: unknown, path: string): Cutscene | undefined {
  if (value === undefined) return;
  const scene = shape(value, path, 'id lines once');
  if (scene.once !== undefined && typeof scene.once !== 'boolean')
    invalid(`${path}.once`, 'must be true or false.');
  const lines = list(scene.lines, `${path}.lines`, 100).map(
    (value, index): CutsceneLine => {
      const at = `${path}.lines[${index}]`;
      const line = shape(
        value,
        at,
        'id text speaker voice duration background tone',
      );
      return {
        id: identifier(line.id, `${at}.id`),
        text: text(line.text, `${at}.text`, 5000),
        speaker:
          line.speaker === undefined
            ? undefined
            : text(line.speaker, `${at}.speaker`, 120),
        voice: asset(line.voice, `${at}.voice`),
        background: asset(line.background, `${at}.background`),
        duration: numeric(line.duration, `${at}.duration`, 100, 120000),
        tone:
          line.tone === undefined
            ? undefined
            : (identifier(line.tone, `${at}.tone`) as CutsceneLine['tone']),
      };
    },
  );
  if (
    !lines.length ||
    new Set(lines.map((line) => line.id)).size !== lines.length
  )
    invalid(`${path}.lines`, 'must contain lines with unique IDs.');
  return { id: identifier(scene.id, `${path}.id`), lines, once: scene.once };
}

function parseChoice(value: unknown, path: string): StoryChoice {
  const row = shape(
    value,
    path,
    'id text result next nextNodeId versus enemyTeamId enemyName enemyHp enemyMaxHp enemyAttack enemyAbilities enemyPhases cutscene onBattle battle encounter',
  );
  const result = named(row.result, `${path}.result`, results);
  const next = row.nextNodeId ?? row.next;
  const choice: StoryChoice = {
    id: identifier(row.id, `${path}.id`),
    text: text(row.text, `${path}.text`, 2000),
    result,
    nextNodeId:
      next === undefined ? undefined : identifier(next, `${path}.nextNodeId`),
    cutscene: cutscene(row.cutscene, `${path}.cutscene`),
    onBattle: cutscene(row.onBattle, `${path}.onBattle`),
  };
  if (
    row.next !== undefined &&
    row.nextNodeId !== undefined &&
    row.next !== row.nextNodeId
  )
    invalid(path, 'has conflicting next and nextNodeId values.');

  if (row.battle !== undefined || row.encounter !== undefined) {
    const legacy =
      result === 'battle'
        ? row.battle
        : result === 'random'
          ? row.encounter
          : undefined;
    if (
      legacy === undefined ||
      (row.battle !== undefined && row.encounter !== undefined)
    )
      invalid(path, 'uses a battle or encounter label with the wrong result.');
    choice.enemyName = identifier(legacy, `${path}.enemy`)
      .replace(/[_-]+/g, ' ')
      .toUpperCase();
  }
  if (row.enemyName !== undefined)
    choice.enemyName = text(row.enemyName, `${path}.enemyName`, 120);
  if (row.versus !== undefined) {
    const side = list(row.versus, `${path}.versus`, 2);
    if (
      side.length !== 2 ||
      side[0] === side[1] ||
      choice.enemyName ||
      row.enemyTeamId !== undefined
    )
      invalid(
        `${path}.versus`,
        'must contain two distinct teams with no competing enemy.',
      );
    choice.versus = [
      named(side[0], `${path}.versus[0]`, teams),
      named(side[1], `${path}.versus[1]`, teams),
    ];
  }
  if (row.enemyTeamId !== undefined)
    choice.enemyTeamId = named(row.enemyTeamId, `${path}.enemyTeamId`, teams);
  choice.enemyHp = numeric(row.enemyHp, `${path}.enemyHp`, 1, 100000);
  choice.enemyMaxHp =
    numeric(
      row.enemyMaxHp,
      `${path}.enemyMaxHp`,
      choice.enemyHp ?? 1,
      100000,
    ) ?? choice.enemyHp;
  if (choice.enemyHp === undefined && choice.enemyMaxHp !== undefined)
    choice.enemyHp = choice.enemyMaxHp;
  choice.enemyAttack = numeric(
    row.enemyAttack,
    `${path}.enemyAttack`,
    1,
    10000,
  );
  if (row.enemyAbilities !== undefined)
    choice.enemyAbilities = list(
      row.enemyAbilities,
      `${path}.enemyAbilities`,
      6,
    ).map((ability) => named(ability, `${path}.enemyAbilities`, abilities));
  if (row.enemyPhases !== undefined) {
    choice.enemyPhases = list(row.enemyPhases, `${path}.enemyPhases`, 12).map(
      (phase, index) => {
        const at = `${path}.enemyPhases[${index}]`;
        const p = shape(
          phase,
          at,
          'hpThreshold attackMultiplier announcement healOnEnter signatureName',
        );
        const hpThreshold = numeric(
          p.hpThreshold,
          `${at}.hpThreshold`,
          0.01,
          1,
          false,
        );
        const attackMultiplier = numeric(
          p.attackMultiplier,
          `${at}.attackMultiplier`,
          0.1,
          10,
          false,
        );
        if (hpThreshold === undefined || attackMultiplier === undefined)
          invalid(
            at,
            'requires both a health threshold and an attack multiplier.',
          );
        return {
          hpThreshold,
          attackMultiplier,
          announcement: text(p.announcement, `${at}.announcement`, 500),
          healOnEnter: numeric(p.healOnEnter, `${at}.healOnEnter`, 0, 100000),
          signatureName:
            p.signatureName === undefined
              ? undefined
              : text(p.signatureName, `${at}.signatureName`, 100),
        };
      },
    );
    if (
      choice.enemyPhases.some(
        (phase, index, phases) =>
          index > 0 && phase.hpThreshold >= phases[index - 1].hpThreshold,
      )
    )
      invalid(
        `${path}.enemyPhases`,
        'must be ordered from highest to lowest health threshold.',
      );
  }
  return choice;
}

export function validateStory(value: unknown): StoryDocument {
  const root = object(value, 'Story');
  const envelope = Object.hasOwn(root, 'nodes');
  if (envelope) shape(root, 'Story', 'initialNodeId nodes');
  const source = envelope ? object(root.nodes, 'nodes') : root;
  const initialNodeId = identifier(
    envelope ? root.initialNodeId : 'start',
    'initialNodeId',
  );
  const entries = Object.entries(source);
  if (entries.length < 1 || entries.length > 500)
    invalid('nodes', 'must contain 1–500 scenes.');
  const nodes: Record<string, StoryNode> = Object.create(null) as Record<
    string,
    StoryNode
  >;
  for (const [key, value] of entries) {
    const at = `nodes.${key}`;
    const id = identifier(key, at);
    const row = shape(
      value,
      at,
      'id title text choices background image onEnter onChoice',
    );
    if (row.id !== id) invalid(`${at}.id`, 'must match the scene key.');
    const choices = list(row.choices, `${at}.choices`, 40).map(
      (choice, index) => parseChoice(choice, `${at}.choices[${index}]`),
    );
    const ids = new Set(choices.map((choice) => choice.id));
    if (ids.size !== choices.length)
      invalid(`${at}.choices`, 'must have unique choice IDs.');
    const node: StoryNode = {
      id,
      title: text(row.title, `${at}.title`, 180),
      text: text(row.text, `${at}.text`, 12000),
      background: asset(row.background ?? row.image, `${at}.background`),
      choices,
      onEnter: cutscene(row.onEnter, `${at}.onEnter`),
    };
    if (row.onChoice !== undefined) {
      node.onChoice = {};
      for (const [choiceId, scene] of Object.entries(
        object(row.onChoice, `${at}.onChoice`),
      )) {
        if (!ids.has(choiceId))
          invalid(
            `${at}.onChoice.${choiceId}`,
            'does not match a choice on this scene.',
          );
        node.onChoice[choiceId] = cutscene(
          scene,
          `${at}.onChoice.${choiceId}`,
        )!;
      }
    }
    nodes[id] = node;
  }
  if (!Object.hasOwn(nodes, initialNodeId))
    invalid('initialNodeId', 'does not match an existing scene.');
  for (const node of Object.values(nodes)) {
    for (const choice of node.choices) {
      if (choice.nextNodeId && !Object.hasOwn(nodes, choice.nextNodeId))
        invalid(
          `nodes.${node.id}.${choice.id}`,
          `points to missing scene "${choice.nextNodeId}".`,
        );
    }
  }
  return { initialNodeId, nodes };
}

export function parseStoryFile(file: Buffer | undefined): StoryDocument {
  if (!file?.length || file.length > MAX_STORY_BYTES)
    invalid('Story file', 'must be a JSON file up to 1 MB.');
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(file),
    ) as unknown;
  } catch {
    invalid('Story file', 'is not valid UTF-8 JSON.');
  }
  return validateStory(decoded);
}
