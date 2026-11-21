import type { EncounterLevel } from './encounter-path';
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Battle,
  CombatAction,
  CombatVariant,
  CpuBattle,
  CpuPersonality,
  CpuPhase,
  GameState,
  Player,
  StatusEffect,
  TeamBattle,
  TeamId,
} from '../game.types';
import {
  GEAR,
  ITEMS,
  ITEM_EFFECTS,
  isItem,
  type ItemId,
} from '../progression/catalog';
import {
  COMPANION_SKILLS,
  isCompanionSkill,
  type CompanionSkillId,
} from '../progression/companion-skills';
import {
  fighterKit,
  fighterCompanionSkills,
  isAffliction,
  outgoingMultiplier,
  presentCombatKit,
  SKILLS,
  starterBattleItems,
  STATUS_TICK_HP,
  WARDEN_HEAL_BONUS,
} from './fighter-combat';

/* ------------------------------------------------------------------ */
/* Tuning constants                                                    */
/* ------------------------------------------------------------------ */

const BREAK_THRESHOLD = 200;
const BREAK_PER_DAMAGE = 1.2;
const BREAK_GAIN_CAP = 40;
const BREAK_DECAY_PER_ACTION = 20;
const BREAK_MIN_DAMAGE = 50;
const BREAK_DURATION_TURNS = 2;

const MAX_SKILL_USES = 6;
const MAX_HEAL_USES = 6;

const ENEMY_ROUND_RAMP = 0.03;
const ENEMY_ROUND_RAMP_CAP = 1.5;

const ENEMY_PRESSURE_PER_PLAYER = 0.2;
const ENEMY_PRESSURE_CAP = 1.6;

const ENRAGE_THRESHOLD = 0.5;
const ENRAGE_MULT = 1.5;

const HOWL_GAIN_NORMAL = 20;
const HOWL_GAIN_ENRAGED = 35;

const MEND_RATIO = 0.08;
const MEND_RATIO_ENRAGED = 0.12;
const DRAIN_RATIO = 0.5;

const PLAYER_ATTACK = [140, 200] as const;

/** Guard reduces incoming damage by this fraction. */
const GUARD_DAMAGE_REDUCTION = 0.5;

/** Dodge has this chance to fully avoid an incoming hit. */
const DODGE_EVADE_CHANCE = 0.5;

export type CpuAbilityId =
  | 'rend'
  | 'howl'
  | 'sweep'
  | 'crush'
  | 'mend'
  | 'drain';

function roll(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class CombatEngine {
  private readonly recentEvade = new WeakSet<Player>();
  private readonly enemySummons = new WeakSet<CpuBattle>();
  private readonly teamBreaks = new WeakSet<TeamBattle>();
  private readonly enemyBreaks = new WeakMap<
    CpuBattle,
    { enemy: CpuBattle; playerId: string }
  >();

  /* ------------------------------------------------------------------ */
  /* Creation                                                            */
  /* ------------------------------------------------------------------ */

  createTeamBattle(
    game: GameState,
    attackerTeamId: TeamId,
    defenderTeamId: TeamId,
    sourceNodeId?: string,
  ): TeamBattle {
    this.resetBattleCharges(game);

    const battle: TeamBattle = {
      id: crypto.randomUUID(),
      mode: 'team',
      attackerTeamId,
      defenderTeamId,
      turnTeamId: attackerTeamId,
      status: 'active',
      sourceNodeId,
      log: [`${attackerTeamId} and ${defenderTeamId} collide!`],
      queuedActions: [],
      readyPlayerIds: [],
    };

    this.assignFirstAlivePlayer(game, battle, attackerTeamId);
    return battle;
  }

  createCpuBattle(
    game: GameState,
    teamId: TeamId,
    enemyName: string,
    enemyHp: number,
    enemyMaxHp: number,
    config?: {
      attack?: number;
      personality?: CpuPersonality;
      abilityChance?: number;
      signatureEveryNRounds?: number;
      signatureMultiplier?: number;
      telegraphs?: boolean;
      phases?: CpuPhase[];
      abilities?: CpuAbilityId[];
    },
  ): CpuBattle {
    this.resetBattleCharges(game);
    const battle = this.makeCpuBattle(
      teamId,
      enemyName,
      enemyHp,
      enemyMaxHp,
      config,
    );
    this.assignFirstAlivePlayer(game, battle, teamId);
    return battle;
  }

  private makeCpuBattle(
    teamId: TeamId,
    enemyName: string,
    enemyHp: number,
    enemyMaxHp: number,
    config: Parameters<CombatEngine['createCpuBattle']>[5],
  ): CpuBattle {
    return {
      id: crypto.randomUUID(),
      mode: 'cpu',
      attackerTeamId: teamId,
      defenderTeamId: teamId,
      enemyName,
      enemyHp,
      enemyMaxHp,
      enemyAttack: config?.attack ?? roll(180, 260),
      turnTeamId: teamId,
      status: 'active',
      round: 1,
      log: [`${enemyName} emerges from the shadows.`],
      personality: config?.personality ?? 'aggressive',
      abilityChance: config?.abilityChance ?? 0.25,
      signatureEveryNRounds: config?.signatureEveryNRounds ?? 0,
      signatureMultiplier: config?.signatureMultiplier ?? 1.6,
      telegraphs: config?.telegraphs ?? false,
      phases: config?.phases,
      phaseIndex: undefined,
      abilities: config?.abilities,
      queuedActions: [],
      readyPlayerIds: [],
    };
  }

  createEncounterBattle(
    game: GameState,
    teamId: TeamId,
    opponents: readonly EncounterLevel[],
  ) {
    const [lead] = opponents;
    const options = { abilityChance: 0.68, telegraphs: true };
    const battle = this.createCpuBattle(
      game,
      teamId,
      lead.name,
      lead.hp,
      lead.hp,
      { ...lead, ...options },
    );
    battle.encounterId = lead.id;
    battle.enemyItems = { tonic: 1, ward: 1 };
    battle.enemyFocus = 0;
    if (opponents.length > 1) {
      battle.enemyUnits = opponents.map((enemy) => {
        const unit = this.makeCpuBattle(
          teamId,
          enemy.name,
          enemy.hp,
          enemy.hp,
          { ...enemy, ...options },
        );
        unit.encounterId = enemy.id;
        unit.enemyItems = { tonic: 1, ward: 1 };
        unit.enemyFocus = 0;
        unit.log = [];
        return unit;
      });
      battle.log = [
        opponents.map(({ name }) => name).join(', ') +
          ' emerge from the shadows.',
      ];
      battle.enemyMaxHp = battle.enemyUnits.reduce(
        (hp, unit) => hp + unit.enemyMaxHp,
        0,
      );
      this.syncEnemyHealth(battle);
    }
    return battle;
  }

  private syncEnemyHealth(battle: CpuBattle) {
    if (battle.enemyUnits)
      battle.enemyHp = battle.enemyUnits.reduce(
        (hp, unit) => hp + unit.enemyHp,
        0,
      );
    if (battle.enemyHp === 0) battle.status = 'victory';
  }

  private cpuTarget(battle: CpuBattle, targetId?: string) {
    const living = battle.enemyUnits?.filter(({ enemyHp }) => enemyHp > 0);
    return living?.find(({ id }) => id === targetId) ?? living?.[0] ?? battle;
  }

  createBossBattle(
    game: GameState,
    teamId: TeamId,
    config: {
      name: string;
      hp: number;
      attack: number;
      personality?: CpuPersonality;
      abilityChance?: number;
      signatureEveryNRounds?: number;
      signatureMultiplier?: number;
      telegraphs?: boolean;
      phases?: CpuPhase[];
      abilities?: CpuAbilityId[];
    },
  ): CpuBattle {
    this.resetBattleCharges(game);

    const battle: CpuBattle = {
      id: crypto.randomUUID(),
      mode: 'cpu',
      attackerTeamId: teamId,
      defenderTeamId: teamId,
      enemyName: config.name,
      enemyHp: config.hp,
      enemyMaxHp: config.hp,
      enemyAttack: config.attack,
      turnTeamId: teamId,
      status: 'active',
      round: 1,
      log: [`${config.name} rises.`],
      personality: config.personality ?? 'boss',
      abilityChance: config.abilityChance ?? 0.45,
      signatureEveryNRounds: config.signatureEveryNRounds ?? 3,
      signatureMultiplier: config.signatureMultiplier ?? 1.8,
      telegraphs: config.telegraphs ?? true,
      phases: config.phases,
      phaseIndex: undefined,
      abilities: config.abilities,
      queuedActions: [],
      readyPlayerIds: [],
    };

    this.assignFirstAlivePlayer(game, battle, teamId);
    return battle;
  }

  private resetBattleCharges(game: GameState) {
    for (const team of Object.values(game.teams)) {
      for (const p of team.players) {
        this.recentEvade.delete(p);
        p.combatKit = presentCombatKit(p.fighterId, p.loadout?.unlockedSkills);
        p.battleItems = starterBattleItems(p.fighterId);
        p.companion = undefined;
        p.secondaryCompanion = undefined;
        p.skillCharges = MAX_SKILL_USES;
        p.healCharges = MAX_HEAL_USES;
        p.focus = 0;
        p.breakMeter = 0;
        p.statusEffects = [];
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Incoming damage resolver — reads guard and dodge                    */
  /* ------------------------------------------------------------------ */

  /**
   * Applies incoming damage to a target, factoring in `guarded` and
   * `evading` status effects while they are active.
   *
   * Returns the actual damage dealt and whether the hit was dodged or
   * guarded so callers can log appropriately.
   */
  private applyIncomingDamage(
    target: Player,
    rawDamage: number,
  ): { dealt: number; dodged: boolean; guarded: boolean } {
    if (target.status !== 'alive') {
      return { dealt: 0, dodged: false, guarded: false };
    }

    const effects = target.statusEffects ?? [];

    // ---- Dodge -------------------------------------------------------
    const hasEvade = effects.some((s) => s.id === 'evading');
    if (hasEvade) {
      const dodged = Math.random() < DODGE_EVADE_CHANCE;
      if (dodged) {
        this.recentEvade.add(target);
        return { dealt: 0, dodged: true, guarded: false };
      }
    }

    // ---- Guard -------------------------------------------------------
    const hasGuard = effects.some((s) => s.id === 'guarded');

    const armor = target.loadout ? GEAR[target.loadout.armor].armor : 0;
    const defense =
      armor +
      (target.loadout?.strength?.defense ?? 0) +
      (target.loadout?.job === 'vanguard' ? 12 : 0);
    let damage = Math.max(1, rawDamage - defense);
    if (hasGuard) {
      damage = Math.round(damage * (1 - GUARD_DAMAGE_REDUCTION));
    }

    const dealt = Math.min(target.hp, damage);
    target.hp -= dealt;

    if (target.hp === 0) {
      target.status = 'eliminated';
      target.companion = undefined;
      target.secondaryCompanion = undefined;
    } else {
      target.focus = Math.min(100, (target.focus ?? 0) + 10);
    }

    return { dealt, dodged: false, guarded: hasGuard };
  }

  /* ------------------------------------------------------------------ */
  /* Player actions                                                      */
  /* ------------------------------------------------------------------ */

  performAction(
    game: GameState,
    player: Player,
    action: CombatAction,
    variant?: CombatVariant,
    targetId?: string,
  ): string {
    const battle = game.battle;
    if (!battle) throw new Error('No active battle.');
    if (battle.status !== 'active')
      throw new Error('Battle has already ended.');
    if (player.status !== 'alive') {
      throw new Error('Eliminated players cannot fight.');
    }
    if (this.isImmobilized(player)) {
      throw new Error(`${player.name} is immobilized and cannot act.`);
    }
    this.validateAction(player, action, variant);

    if (battle.mode === 'team') {
      if (player.teamId !== battle.turnTeamId) {
        throw new Error("It is not your team's turn.");
      }
    } else {
      if (player.teamId !== battle.attackerTeamId) {
        throw new Error('Only the active team can act.');
      }
    }

    if ((player.breakMeter ?? 0) > 0) {
      player.breakMeter = Math.max(
        0,
        (player.breakMeter ?? 0) - BREAK_DECAY_PER_ACTION,
      );
    }

    const conjuration =
      action === 'skill' && isCompanionSkill(variant) ? variant : undefined;
    const enemy =
      battle.mode === 'cpu' ? this.cpuTarget(battle, targetId) : undefined;
    const enemyHpBefore = enemy?.enemyHp ?? 0;
    const message =
      action === 'item'
        ? this.useItem(game, player, variant, targetId)
        : conjuration
          ? this.summonCompanion(player, conjuration)
          : battle.mode === 'team'
            ? this.resolveTeamAction(
                game,
                battle,
                player,
                action,
                variant,
                targetId,
              )
            : this.resolveCpuPlayerAction(
                game,
                enemy!,
                player,
                action,
                variant,
                targetId,
              );

    if (action === 'limit') player.focus = 0;
    else if (action !== 'item')
      player.focus = Math.min(100, (player.focus ?? 0) + 20);

    if (action === 'skill') {
      player.skillCharges = (player.skillCharges ?? 0) - 1;
    }
    if (action === 'heal') {
      player.healCharges = (player.healCharges ?? 0) - 1;
    }

    battle.log.push(message);

    if (battle.mode === 'team') {
      this.checkTeamBattleEnd(game, battle);
    } else if (enemy) {
      if (enemy.enemyHp === 0)
        battle.log.push(enemy.enemyName + ' has been destroyed.');
      else
        this.applyEnemyBreak(
          battle,
          enemy,
          player.id,
          enemyHpBefore - enemy.enemyHp,
        );
      this.syncEnemyHealth(battle);
    }

    return message;
  }

  resolvePlayerBreak(game: GameState, player: Player): boolean {
    const battle = game.battle;
    if (battle?.mode !== 'cpu' || battle.status !== 'active') return false;
    const pending = this.enemyBreaks.get(battle);
    if (pending?.playerId !== player.id) return false;

    this.enemyBreaks.delete(battle);
    const { enemy } = pending;
    if (player.status === 'alive' && enemy.enemyHp > 0) {
      battle.log.push(player.name + ' attacks again after the break!');
      battle.log.push(
        this.resolveCpuPlayerAction(game, enemy, player, 'attack'),
      );
      if (enemy.enemyHp === 0)
        battle.log.push(enemy.enemyName + ' has been destroyed.');
    }
    enemy.enemyStatusEffects = enemy.enemyStatusEffects?.filter(
      ({ id }) => id !== 'immobilized',
    );
    this.syncEnemyHealth(battle);
    return true;
  }

  validateAction(
    player: Player,
    action: CombatAction,
    variant?: CombatVariant,
  ) {
    switch (action) {
      case 'skill':
        if (isCompanionSkill(variant)) {
          if (
            !fighterCompanionSkills(
              player.fighterId,
              player.loadout?.unlockedSkills,
            ).includes(variant)
          )
            throw new Error('This fighter has not unlocked that summon.');
          if (
            player.companion?.skillId === variant ||
            player.secondaryCompanion?.skillId === variant
          )
            throw new Error('This companion is already summoned.');
          if (
            player.companion &&
            (player.loadout?.summonCapacity !== 2 || player.secondaryCompanion)
          )
            throw new Error('All companion slots are in use.');
        } else if (
          variant !== undefined &&
          !fighterKit(player.fighterId).skills.some((id) => id === variant)
        )
          throw new Error('This fighter cannot use that skill.');
        if (!player.skillCharges) throw new Error('No skill uses remaining.');
        break;
      case 'heal':
        if (
          variant !== undefined &&
          variant !== 'signature_recovery' &&
          variant !== 'field_recovery' &&
          variant !== 'minor_heal' &&
          variant !== 'major_heal'
        )
          throw new Error('Choose a valid healing spell.');
        if (!player.healCharges) throw new Error('No healing uses remaining.');
        break;
      case 'limit':
        if ((player.focus ?? 0) < 100)
          throw new Error('Your Limit Break requires 100 Focus.');
        break;
      case 'item':
        this.battleItemFor(player, variant);
        break;
      case 'attack':
      case 'block':
      case 'dodge':
        break;
      default:
        throw new Error('Unknown combat action.');
    }
  }

  private damage(player: Player, base: number, skill = false) {
    const bonus = player.loadout ? GEAR[player.loadout.weapon].attack : 0;
    const total =
      base +
      bonus +
      (player.loadout?.strength?.attack ?? 0) +
      (skill && player.loadout?.job === 'spellblade' ? 25 : 0);
    return Math.round(total * outgoingMultiplier(player.statusEffects));
  }

  battleItemFor(player: Player, variant?: CombatVariant) {
    const item = variant ?? player.loadout?.item;
    if (
      (!isItem(item) &&
        !(
          typeof item === 'string' &&
          item.startsWith('custom_') &&
          item === player.loadout?.item &&
          player.loadout.equippedItem
        )) ||
      (item !== player.loadout?.item && !player.battleItems?.[item])
    ) {
      throw new Error('Choose an equipped item or an available starter item.');
    }
    return item as ItemId;
  }

  private useItem(
    game: GameState,
    player: Player,
    variant?: CombatVariant,
    targetId?: string,
  ) {
    const item = this.battleItemFor(player, variant);
    if (player.battleItems?.[item]) player.battleItems[item]--;
    const effect = isItem(item)
      ? { ...ITEMS[item], ...ITEM_EFFECTS[item] }
      : player.loadout?.equippedItem;
    if (!effect) throw new Error('The equipped item is unavailable.');
    if (effect.effect === 'guard') {
      this.applyStatus(player, { id: 'guarded', turns: 3 });
      player.focus = Math.min(100, (player.focus ?? 0) + effect.power);
      return `${player.name} used ${effect.name} and raised their guard.`;
    }
    return this.restore(game, player, effect.power, effect.name, targetId);
  }

  private resolveTeamAction(
    game: GameState,
    battle: TeamBattle,
    player: Player,
    action: CombatAction,
    variant?: CombatVariant,
    targetId?: string,
  ): string {
    const opponentTeamId =
      player.teamId === battle.attackerTeamId
        ? battle.defenderTeamId
        : battle.attackerTeamId;
    const opponentTeam = game.teams[opponentTeamId];

    const opponents = opponentTeam.players.filter((p) => p.status === 'alive');
    if (opponents.length === 0) {
      return `${player.name} has no one left to strike.`;
    }

    switch (action) {
      case 'attack':
        return this.pvpAttack(game, battle, player, opponents, targetId);
      case 'limit':
        return this.pvpAttack(game, battle, player, opponents, targetId, true);
      case 'skill':
        return this.pvpSkill(
          game,
          battle,
          player,
          opponents,
          variant,
          targetId,
        );
      case 'heal':
        return this.heal(game, player, variant, targetId);
      case 'block':
        this.applyStatus(player, { id: 'guarded', turns: 2 });
        return `${player.name} raised their guard.`;
      case 'dodge':
        this.applyStatus(player, { id: 'evading', turns: 2 });
        return `${player.name} prepared to dodge.`;
      default:
        throw new Error('Unknown combat action.');
    }
  }

  private damageEnemy(enemy: CpuBattle, rawDamage: number) {
    const guarded = enemy.enemyStatusEffects?.some(
      ({ id }) => id === 'guarded',
    );
    const damage = Math.min(
      enemy.enemyHp,
      guarded
        ? Math.round(rawDamage * (1 - GUARD_DAMAGE_REDUCTION))
        : rawDamage,
    );
    enemy.enemyHp -= damage;
    return damage;
  }

  private resolveCpuPlayerAction(
    game: GameState,
    battle: CpuBattle,
    player: Player,
    action: CombatAction,
    variant?: CombatVariant,
    targetId?: string,
  ): string {
    switch (action) {
      case 'attack': {
        const damage = this.damageEnemy(
          battle,
          this.damage(player, roll(...PLAYER_ATTACK)),
        );
        return `${player.name} attacked ${battle.enemyName} for ${damage} damage.`;
      }
      case 'skill': {
        const skill = this.skillFor(player, variant);
        const damage = this.damageEnemy(
          battle,
          this.skillDamage(
            player,
            skill,
            battle.enemyHp / battle.enemyMaxHp,
            battle.enemyStatusEffects,
          ),
        );
        if (skill.target === 'self')
          this.applyStatus(player, { id: skill.effect, turns: 2 });
        else if (battle.enemyHp > 0)
          battle.enemyStatusEffects = this.withStatus(
            battle.enemyStatusEffects,
            { id: skill.effect, turns: 2 },
          );
        const label = skill.name;
        return `${player.name} used ${label} on ${battle.enemyName} for ${damage} damage.`;
      }
      case 'limit': {
        const damage = this.damageEnemy(
          battle,
          this.damage(player, roll(380, 450)),
        );
        return `${player.name} unleashed a Limit Break on ${battle.enemyName} for ${damage} damage.`;
      }
      case 'heal':
        return this.heal(game, player, variant, targetId);
      case 'block':
        this.applyStatus(player, { id: 'guarded', turns: 1 });
        return `${player.name} raised their guard.`;
      case 'dodge':
        this.applyStatus(player, { id: 'evading', turns: 1 });
        return `${player.name} prepared to dodge.`;
      default:
        throw new Error('Unknown combat action.');
    }
  }

  /* ------------------------------------------------------------------ */
  /* PvP attacks (targeted)                                              */
  /* ------------------------------------------------------------------ */

  private pvpAttack(
    game: GameState,
    battle: TeamBattle,
    player: Player,
    opponents: Player[],
    targetId?: string,
    limit = false,
  ): string {
    const requested = targetId
      ? opponents.find((p) => p.id === targetId)
      : undefined;
    const target = requested ?? opponents[roll(0, opponents.length - 1)];
    const rawDamage = this.damage(
      player,
      limit ? roll(380, 450) : roll(...PLAYER_ATTACK),
    );
    const move = limit ? 'unleashed a Limit Break on' : 'struck';

    const { dealt, dodged, guarded } = this.applyIncomingDamage(
      target,
      rawDamage,
    );

    if (dodged) {
      return `${target.name} dodged ${player.name}'s ${limit ? 'Limit Break' : 'strike'}.`;
    }

    const broke = this.applyBreakMeter(target, dealt);
    if (broke) this.teamBreaks.add(battle);

    if (target.hp === 0) {
      return guarded
        ? `${player.name} ${move} ${target.name}, but their guard held — ${dealt} damage. ${target.name} still falls.`
        : `${player.name} ${move} ${target.name} for ${dealt} damage — ${target.name} is down!`;
    }

    if (broke) {
      battle.log.push(`${target.name} is BROKEN!`);
      battle.log.push(`${target.name} loses their next turn.`);
    }

    return guarded
      ? `${player.name} ${move} ${target.name}, but their guard absorbed part of it — ${dealt} damage.`
      : `${player.name} ${move} ${target.name} for ${dealt} damage.`;
  }

  private pvpSkill(
    game: GameState,
    battle: TeamBattle,
    player: Player,
    opponents: Player[],
    variant?: CombatVariant,
    targetId?: string,
  ): string {
    const skill = this.skillFor(player, variant);
    const requested = targetId
      ? opponents.find((p) => p.id === targetId)
      : undefined;
    const target = requested ?? opponents[roll(0, opponents.length - 1)];
    const rawDamage = this.skillDamage(
      player,
      skill,
      target.hp / target.maxHp,
      target.statusEffects,
    );

    const { dealt, dodged, guarded } = this.applyIncomingDamage(
      target,
      rawDamage,
    );

    const label = skill.name;

    if (dodged) {
      return `${target.name} dodged ${player.name}'s ${label}.`;
    }

    if (skill.target === 'self' || target.hp > 0) {
      this.applyStatus(skill.target === 'self' ? player : target, {
        id: skill.effect,
        turns: 2,
      });
    }
    const broke = this.applyBreakMeter(target, dealt);
    if (broke) this.teamBreaks.add(battle);
    if (target.hp === 0) {
      return guarded
        ? `${player.name} used ${label} on ${target.name}, but their guard held — ${dealt} damage. ${target.name} still falls.`
        : `${player.name} used ${label} on ${target.name} for ${dealt} damage — ${target.name} is down!`;
    }

    if (broke) {
      battle.log.push(`${target.name} is BROKEN!`);
      battle.log.push(`${target.name} loses their next turn.`);
    }

    return guarded
      ? `${player.name} used ${label} on ${target.name}, but their guard absorbed part of it — ${dealt} damage.`
      : `${player.name} used ${label} on ${target.name} for ${dealt} damage.`;
  }

  /* ------------------------------------------------------------------ */
  /* Heal                                                                */
  /* ------------------------------------------------------------------ */

  private summonCompanion(player: Player, id: CompanionSkillId) {
    const { entity, sprite, role } = COMPANION_SKILLS[id];
    const summoned: NonNullable<Player['companion']> = {
      skillId: id,
      name: entity,
      sprite,
      remaining: 1,
      strikes: 0,
      role,
    };
    if (player.companion) player.secondaryCompanion = summoned;
    else player.companion = summoned;
    return `${player.name} summoned ${entity}.`;
  }

  resolveCompanions(game: GameState) {
    const battle = game.battle;
    if (!battle || battle.status !== 'active') return;
    const allies = game.teams[battle.turnTeamId].players.filter(
      ({ status }) => status === 'alive',
    );
    for (const player of allies) {
      for (const summoned of [player.companion, player.secondaryCompanion]) {
        if (!summoned?.remaining) continue;
        this.resolveCompanion(game, battle, player, allies, summoned);
        if (battle.status !== 'active') return;
      }
    }
  }

  private resolveCompanion(
    game: GameState,
    battle: Battle,
    owner: Player,
    allies: Player[],
    summoned: NonNullable<Player['companion']>,
  ) {
    const { damage, role } = COMPANION_SKILLS[summoned.skillId];
    if (role === 'healer') {
      const target = allies.reduce(
        (mostInjured, ally) =>
          ally.hp / ally.maxHp < mostInjured.hp / mostInjured.maxHp
            ? ally
            : mostInjured,
        owner,
      );
      const healed = Math.min(90, target.maxHp - target.hp);
      if (!healed) return;
      target.hp += healed;
      summoned.strikes++;
      battle.log.push(
        summoned.name + ' restored ' + healed + ' HP to ' + target.name + '.',
      );
      return;
    }
    if (role === 'buffer') {
      if (owner.statusEffects?.some(({ id }) => id === 'enraged')) return;
      this.applyStatus(owner, { id: 'enraged', turns: 3 });
      summoned.strikes++;
      battle.log.push(summoned.name + ' granted Rage to ' + owner.name + '.');
      return;
    }
    if (battle.mode === 'cpu') {
      const enemy = this.cpuTarget(battle);
      const dealt = this.damageEnemy(enemy, damage);
      battle.log.push(
        summoned.name +
          ' struck ' +
          enemy.enemyName +
          ' for ' +
          dealt +
          ' damage.',
      );
      if (enemy.enemyHp === 0)
        battle.log.push(enemy.enemyName + ' has been destroyed.');
      this.syncEnemyHealth(battle);
    } else {
      const enemyTeam =
        owner.teamId === battle.attackerTeamId
          ? battle.defenderTeamId
          : battle.attackerTeamId;
      const targets = game.teams[enemyTeam].players.filter(
        ({ status }) => status === 'alive',
      );
      const target = targets.sort((a, b) => a.hp - b.hp)[0];
      if (!target) return;
      const hit = this.applyIncomingDamage(target, damage);
      battle.log.push(
        hit.dodged
          ? target.name + ' dodged ' + summoned.name + '.'
          : summoned.name +
              ' struck ' +
              target.name +
              ' for ' +
              hit.dealt +
              ' damage.',
      );
      this.checkTeamBattleEnd(game, battle);
    }
    summoned.strikes += 1;
  }

  private heal(
    game: GameState,
    player: Player,
    variant?: CombatVariant,
    targetId?: string,
  ): string {
    const kit = fighterKit(player.fighterId);
    const heal = variant === 'field_recovery' ? kit.recovery : kit.heal;
    const target = this.healTarget(
      game,
      player,
      heal.target === 'self' ? undefined : targetId,
    );
    const amount =
      heal.amount + (player.loadout?.job === 'warden' ? WARDEN_HEAL_BONUS : 0);
    if (heal.effect === 'cleanse') {
      target.statusEffects = target.statusEffects?.filter(
        ({ id }) => !isAffliction(id),
      );
    } else if (heal.effect) {
      this.applyStatus(target, { id: heal.effect, turns: 2 });
    }
    return this.restore(game, player, amount, heal.name, target.id);
  }

  private skillFor(player: Player, variant?: CombatVariant) {
    const skills = fighterKit(player.fighterId).skills;
    const id = skills.find((skill) => skill === variant) ?? skills[0];
    return SKILLS[id];
  }

  private skillDamage(
    player: Player,
    skill: ReturnType<CombatEngine['skillFor']>,
    healthRatio: number,
    effects: StatusEffect[] = [],
  ) {
    let base = roll(skill.damage[0], skill.damage[1]);
    if (
      (skill === SKILLS.astral_severance || skill === SKILLS.phantom_thread) &&
      this.recentEvade.delete(player)
    )
      base += 110;
    if (
      (skill === SKILLS.crimson_waltz || skill === SKILLS.thunder_meridian) &&
      (player.focus ?? 0) >= 40
    ) {
      player.focus = (player.focus ?? 0) - 40;
      base += skill === SKILLS.crimson_waltz ? 135 : 130;
    }
    if (
      skill === SKILLS.oathbreaker_aegis &&
      player.statusEffects?.some(({ id }) => id === 'guarded')
    )
      base += 80;
    if (
      skill === SKILLS.dawnglass_verdict &&
      player.statusEffects?.some(({ id }) => id === 'blessed')
    )
      base += 85;
    if (
      skill === SKILLS.gravebell_collapse &&
      effects.some(({ id }) => id === 'immobilized')
    )
      base += 115;
    if (skill === SKILLS.astral_convergence)
      base +=
        45 * new Set(effects.map(({ id }) => id).filter(isAffliction)).size;
    if (
      skill === SKILLS.pyre_afterimage &&
      effects.some(({ id }) => id === 'burning')
    )
      base += 85;
    if (skill === SKILLS.black_sun_cascade && healthRatio <= 0.5) base += 105;
    if (
      skill === SKILLS.moonveil_reflection &&
      player.statusEffects?.some(({ id }) => id === 'guarded')
    )
      base += 70;
    if (skill === SKILLS.unwritten_end && healthRatio <= 0.15) base += 140;
    if (
      skill === SKILLS.chronos_elegy &&
      effects.some(({ id }) => id === 'immobilized')
    )
      base += 115;
    if (
      skill === SKILLS.funeral_of_stars &&
      effects.some(({ id }) => id === 'burning')
    )
      base += 75;
    return this.damage(player, base, true);
  }

  private restore(
    game: GameState,
    player: Player,
    amount: number,
    label: string,
    targetId?: string,
  ) {
    const target = this.healTarget(game, player, targetId);

    const oldHp = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const healed = target.hp - oldHp;

    if ((player.breakMeter ?? 0) > 0) {
      player.breakMeter = Math.max(
        0,
        (player.breakMeter ?? 0) - Math.round(healed * 0.5),
      );
    }

    if (healed === 0) {
      if (target.id === player.id) {
        return `${player.name} was already at full health.`;
      }
      return `${player.name} tried to heal ${target.name}, but they were already at full health.`;
    }

    if (target.id === player.id) {
      return `${player.name} used ${label} and recovered ${healed} HP.`;
    }

    return `${player.name} used ${label} on ${target.name} and restored ${healed} HP.`;
  }

  /* ------------------------------------------------------------------ */
  /* Break meter + status                                                */
  /* ------------------------------------------------------------------ */

  private healTarget(game: GameState, player: Player, targetId?: string) {
    return (
      game.teams[player.teamId].players.find(
        ({ id, status }) => id === targetId && status === 'alive',
      ) ?? player
    );
  }

  private isImmobilized(player: Player): boolean {
    return (player.statusEffects ?? []).some((s) => s.id === 'immobilized');
  }

  private applyBreakMeter(target: Player, damage: number): boolean {
    if (target.status !== 'alive' || damage < BREAK_MIN_DAMAGE) return false;

    target.breakMeter = this.breakPressure(target.breakMeter ?? 0, damage);
    if (target.breakMeter >= BREAK_THRESHOLD) {
      target.statusEffects = [
        ...(target.statusEffects ?? []).filter((s) => s.id !== 'immobilized'),
        { id: 'immobilized', turns: BREAK_DURATION_TURNS },
      ];
      target.breakMeter = 0;
      return true;
    }
    return false;
  }

  private breakPressure(current: number, damage: number): number {
    const gain = Math.min(
      BREAK_GAIN_CAP,
      Math.round(damage * BREAK_PER_DAMAGE),
    );
    return Math.min(BREAK_THRESHOLD, current + gain);
  }

  private applyEnemyBreak(
    battle: CpuBattle,
    enemy: CpuBattle,
    playerId: string,
    damage: number,
  ) {
    if (
      damage < BREAK_MIN_DAMAGE ||
      enemy.enemyStatusEffects?.some(({ id }) => id === 'immobilized')
    )
      return;
    enemy.enemyBreakMeter = this.breakPressure(
      enemy.enemyBreakMeter ?? 0,
      damage,
    );
    if (enemy.enemyBreakMeter < BREAK_THRESHOLD) return;

    enemy.enemyBreakMeter = 0;
    enemy.enemyStatusEffects = this.withStatus(enemy.enemyStatusEffects, {
      id: 'immobilized',
      turns: 1,
    });
    this.enemyBreaks.set(battle, { enemy, playerId });
    battle.log.push(enemy.enemyName + ' is BROKEN!');
  }

  private withStatus(effects: StatusEffect[] = [], effect: StatusEffect) {
    const buff = ['guarded', 'evading', 'enraged', 'blessed'].includes(
      effect.id,
    );
    return [
      ...effects.filter(({ id }) => id !== effect.id),
      buff ? { ...effect, turns: 3 } : effect,
    ];
  }

  private applyStatus(target: Player, effect: StatusEffect) {
    target.statusEffects = this.withStatus(target.statusEffects, effect);
  }

  private teamCanAct(game: GameState, teamId: TeamId): boolean {
    return game.teams[teamId].players.some(
      (p) => p.status === 'alive' && !this.isImmobilized(p),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Turn rotation                                                       */
  /* ------------------------------------------------------------------ */

  nextTurn(game: GameState) {
    const battle = game.battle;
    if (!battle || battle.mode !== 'team') return;
    if (battle.status !== 'active') return;

    if (this.teamBreaks.delete(battle)) {
      this.assignFirstAlivePlayer(game, battle, battle.turnTeamId);
      return;
    }

    battle.turnTeamId =
      battle.turnTeamId === battle.attackerTeamId
        ? battle.defenderTeamId
        : battle.attackerTeamId;

    if (!this.teamCanAct(game, battle.turnTeamId)) {
      battle.turnTeamId =
        battle.turnTeamId === battle.attackerTeamId
          ? battle.defenderTeamId
          : battle.attackerTeamId;
    }

    if (!this.teamCanAct(game, battle.turnTeamId)) {
      this.checkTeamBattleEnd(game, battle);
      return;
    }

    this.assignFirstAlivePlayer(game, battle, battle.turnTeamId);
  }

  /* ------------------------------------------------------------------ */
  /* End-of-battle                                                       */
  /* ------------------------------------------------------------------ */

  reconcileRoster(game: GameState) {
    const battle = game.battle;
    if (!battle || battle.status !== 'active') return;
    if (battle.mode === 'team') this.checkTeamBattleEnd(game, battle);
    else if (!this.sideHasAlive(game, battle.attackerTeamId))
      battle.status = 'defeat';
  }

  private sideHasAlive(game: GameState, teamId: TeamId) {
    return game.teams[teamId].players.some((p) => p.status === 'alive');
  }

  private markTeamDefeated(game: GameState, teamId: TeamId) {
    const team = game.teams[teamId];
    for (const p of team.players) {
      p.companion = undefined;
      p.secondaryCompanion = undefined;
      if (p.status === 'alive') {
        p.status = 'defeated';
        p.hp = 0;
      }
    }
  }

  private checkTeamBattleEnd(game: GameState, battle: TeamBattle) {
    if (battle.status !== 'active') return;

    const attackerAlive = this.sideHasAlive(game, battle.attackerTeamId);
    const defenderAlive = this.sideHasAlive(game, battle.defenderTeamId);

    if (!attackerAlive && !defenderAlive) {
      battle.status = 'defeat';
      battle.log.push('Both sides have fallen.');
      this.markTeamDefeated(game, battle.attackerTeamId);
      this.markTeamDefeated(game, battle.defenderTeamId);
      return;
    }
    if (!attackerAlive) {
      battle.status = 'defeat';
      battle.log.push(`${battle.defenderTeamId} stands victorious.`);
      this.markTeamDefeated(game, battle.attackerTeamId);
      return;
    }
    if (!defenderAlive) {
      battle.status = 'victory';
      battle.log.push(`${battle.attackerTeamId} stands victorious.`);
      this.markTeamDefeated(game, battle.defenderTeamId);
    }
  }

  private assignFirstAlivePlayer(
    game: GameState,
    battle: Battle,
    teamId: TeamId,
  ) {
    const team = game.teams[teamId];
    const firstAlive = team?.players.find(
      (p) => p.status === 'alive' && !this.isImmobilized(p),
    );
    battle.activePlayerId = firstAlive?.id;
  }

  /* ------------------------------------------------------------------ */
  /* Status ticking                                                      */
  /* ------------------------------------------------------------------ */

  tickStatuses(game: GameState) {
    const battle = game.battle;
    if (!battle || battle.status !== 'active') return;
    const sides = new Set([battle.attackerTeamId, battle.defenderTeamId]);
    for (const teamId of sides) {
      for (const player of game.teams[teamId].players) {
        if (player.status !== 'alive' || !player.statusEffects?.length)
          continue;
        player.hp = this.tickHealth(
          battle,
          player.name,
          player.hp,
          player.maxHp,
          player.statusEffects,
        );
        player.statusEffects = this.expireStatuses(player.statusEffects);
        if (player.hp === 0) {
          player.status = 'eliminated';
          player.statusEffects = [];
          player.companion = undefined;
          player.secondaryCompanion = undefined;
        }
      }
    }
    if (battle.mode === 'cpu') {
      for (const enemy of battle.enemyUnits ?? [battle]) {
        if (!enemy.enemyStatusEffects?.length || enemy.enemyHp <= 0) continue;
        enemy.enemyHp = this.tickHealth(
          battle,
          enemy.enemyName,
          enemy.enemyHp,
          enemy.enemyMaxHp,
          enemy.enemyStatusEffects,
        );
        enemy.enemyStatusEffects =
          enemy.enemyHp > 0
            ? this.expireStatuses(enemy.enemyStatusEffects)
            : [];
        if (enemy.enemyHp === 0)
          battle.log.push(enemy.enemyName + ' has been destroyed.');
      }
      this.syncEnemyHealth(battle);
    }
    this.reconcileRoster(game);
    if (
      battle.status === 'active' &&
      !game.teams[battle.turnTeamId].players.some(
        ({ id, status }) => id === battle.activePlayerId && status === 'alive',
      )
    ) {
      this.assignFirstAlivePlayer(game, battle, battle.turnTeamId);
    }
  }

  private expireStatuses(effects: StatusEffect[]) {
    return effects
      .map((effect) => ({ ...effect, turns: effect.turns - 1 }))
      .filter(({ turns }) => turns > 0);
  }

  private tickHealth(
    battle: Battle,
    name: string,
    hp: number,
    maxHp: number,
    effects: StatusEffect[],
  ) {
    for (const { id } of effects) {
      if (hp === 0) break;
      if (id !== 'poisoned' && id !== 'burning' && id !== 'blessed') continue;
      const next = Math.min(maxHp, Math.max(0, hp + STATUS_TICK_HP[id]));
      if (next < hp)
        battle.log.push(
          name +
            ' took ' +
            (hp - next) +
            ' damage from ' +
            (id === 'poisoned' ? 'poison.' : 'burn.'),
        );
      if (next > hp)
        battle.log.push(
          name + ' recovered ' + (next - hp) + ' HP from Blessed.',
        );
      hp = next;
    }
    return hp;
  }

  /* ------------------------------------------------------------------ */
  /* CPU retaliation                                                     */
  /* ------------------------------------------------------------------ */

  public *cpuRetaliate(
    game: GameState,
    battle: CpuBattle,
    root = true,
  ): Generator<number> {
    if (root && this.tryEnemySummon(battle)) {
      battle.round += 1;
      yield 650;
      return;
    }
    if (battle.enemyUnits) {
      const living = battle.enemyUnits.filter(({ enemyHp }) => enemyHp > 0);
      const first = (battle.round - 1) % Math.max(1, living.length);
      const attackers = [...living.slice(first), ...living.slice(0, first)];
      for (const [index, unit] of attackers.entries()) {
        unit.round = battle.round;
        for (const step of this.cpuRetaliate(game, unit, false)) {
          battle.log.push(...unit.log.splice(0));
          this.syncEnemyHealth(battle);
          yield step;
        }
        battle.log.push(...unit.log.splice(0));
        if (unit.status === 'defeat') {
          battle.status = 'defeat';
          break;
        }
        this.syncEnemyHealth(battle);
        if (index < attackers.length - 1)
          yield unit.lastTactic === 'crush' ? 900 : 650 + index * 125;
      }
      if (battle.status === 'active') battle.round += 1;
      this.syncEnemyHealth(battle);
      return;
    }
    const team = game.teams[battle.attackerTeamId];
    const alive = team.players.filter((p) => p.status === 'alive');
    if (alive.length === 0) {
      battle.status = 'defeat';
      battle.log.push('Your team has been wiped out.');
      return;
    }

    this.checkBossPhase(battle);

    if (battle.telegraphs && battle.round % 2 === 0) {
      battle.log.push(`${battle.enemyName} sizes up the party...`);
    }

    const personality = battle.personality ?? 'aggressive';
    const abilityChance = battle.abilityChance ?? 0.3;
    const signatureEvery = battle.signatureEveryNRounds ?? 0;
    const usesSignature =
      signatureEvery > 0 && battle.round % signatureEvery === 0;

    const availableTargets = battle.encounterId
      ? alive
      : alive.filter((p) => !this.isImmobilized(p));
    const target = this.pickCpuTarget(
      battle,
      availableTargets.length ? availableTargets : alive,
      personality,
    );
    const phaseMultiplier =
      this.currentPhaseMultiplier(battle) *
      outgoingMultiplier(battle.enemyStatusEffects);

    const alreadyBroken = new Set(
      alive.filter((player) => this.isImmobilized(player)),
    );
    const limit = (battle.enemyFocus ?? 0) >= 100;
    const usedSupport =
      battle.encounterId &&
      this.useEnemySupport(battle, target, usesSignature || limit);
    const usedLimit = limit && !usedSupport;
    let broke = false;
    if (!usedSupport) {
      if (usedLimit || usesSignature) {
        if (usedLimit) battle.enemyFocus = 0;
        broke = this.cpuSignature(
          game,
          battle,
          target,
          phaseMultiplier,
          usedLimit,
        );
      } else if (battle.encounterId || Math.random() < abilityChance) {
        broke = this.cpuAbility(
          game,
          battle,
          target,
          phaseMultiplier,
          personality,
        );
      } else {
        broke = this.cpuBasicAttack(game, battle, target, phaseMultiplier);
      }
    }

    if (battle.enemyFocus !== undefined && !limit)
      battle.enemyFocus = Math.min(100, battle.enemyFocus + 20);
    const broken = alive.filter(
      (player) => !alreadyBroken.has(player) && this.isImmobilized(player),
    );
    let stillAlive = team.players.filter((p) => p.status === 'alive');
    if (usedLimit) yield 2000;
    if (broke && stillAlive.length > 0) {
      if (!usedLimit) yield 650;
      stillAlive = team.players.filter((p) => p.status === 'alive');
      if (stillAlive.length > 0) {
        const followUpTarget =
          broken.find(({ status }) => status === 'alive') ??
          this.pickCpuTarget(battle, stillAlive, personality);
        battle.log.push(`${battle.enemyName} attacks again after the break!`);
        this.cpuBasicAttack(
          game,
          battle,
          followUpTarget,
          phaseMultiplier,
          false,
        );
        stillAlive = stillAlive.filter((p) => p.status === 'alive');
      }
    }
    for (const player of broken) {
      player.statusEffects = player.statusEffects?.filter(
        ({ id }) => id !== 'immobilized',
      );
    }
    if (stillAlive.length === 0) {
      battle.status = 'defeat';
      battle.log.push('Your team has been wiped out.');
      return;
    }

    const currentIndex = stillAlive.findIndex(
      (p) => p.id === battle.activePlayerId,
    );
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + 1) % stillAlive.length;

    battle.activePlayerId = stillAlive[nextIndex].id;
    battle.turnTeamId = battle.attackerTeamId;
    battle.round += 1;
    if (
      battle.encounterId &&
      signatureEvery > 0 &&
      battle.round % signatureEvery === 0
    ) {
      battle.log.push(
        `${battle.enemyName} is preparing a signature attack for the next turn!`,
      );
    }
  }

  private tryEnemySummon(battle: CpuBattle) {
    if (battle.status !== 'active') return false;
    const units = battle.enemyUnits ?? [battle];
    if (
      this.enemySummons.has(battle) ||
      battle.round < 3 ||
      units.filter(({ enemyHp }) => enemyHp > 0).length >= 3
    )
      return false;
    const caster = units.find(
      (unit) =>
        unit.enemyHp > 0 &&
        unit.enemyHp <= unit.enemyMaxHp / 2 &&
        (unit.encounterId === 'glasswing-siren' ||
          unit.encounterId === 'ashen-matriarch') &&
        !unit.enemyStatusEffects?.some(({ id }) => id === 'immobilized'),
    );
    if (!caster) return false;
    const bySiren = caster.encounterId === 'glasswing-siren';
    const hp = Math.max(
      1,
      Math.min(
        Math.round(caster.enemyMaxHp * 0.16),
        Number.MAX_SAFE_INTEGER - battle.enemyMaxHp,
      ),
    );
    if (battle.enemyMaxHp >= Number.MAX_SAFE_INTEGER) return false;
    const echo = this.makeCpuBattle(
      battle.attackerTeamId,
      bySiren ? 'Glasswing Echo' : 'Ash Familiar',
      hp,
      hp,
      {
        attack: Math.max(1, Math.round((caster.enemyAttack ?? 100) * 0.42)),
        personality: 'aggressive',
        abilities: bySiren ? ['drain'] : ['rend'],
        abilityChance: 0.65,
      },
    );
    echo.encounterId = bySiren ? 'glasswing-echo' : 'ash-familiar';
    battle.enemyUnits = [
      ...(battle.enemyUnits ?? [{ ...battle, id: 'cpu', log: [] }]),
      echo,
    ];
    battle.enemyMaxHp += hp;
    this.syncEnemyHealth(battle);
    this.enemySummons.add(battle);
    battle.log.push(`${caster.enemyName} summoned ${echo.enemyName}.`);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Target selection                                                    */
  /* ------------------------------------------------------------------ */

  private useEnemySupport(
    battle: CpuBattle,
    target: Player,
    committedAttack: boolean,
  ) {
    const items = battle.enemyItems;
    const health = battle.enemyHp / battle.enemyMaxHp;
    if (items?.tonic && health <= 0.32) {
      items.tonic--;
      const healing = Math.min(
        battle.enemyMaxHp - battle.enemyHp,
        Math.ceil(battle.enemyMaxHp * 0.2),
      );
      battle.enemyHp += healing;
      battle.log.push(
        battle.enemyName +
          ' used a Bloodleaf Tonic and recovered ' +
          healing +
          ' HP.',
      );
      return true;
    }
    if (committedAttack) return false;
    if (
      items?.ward &&
      (target.focus ?? 0) >= 80 &&
      !battle.enemyStatusEffects?.some(({ id }) => id === 'guarded')
    ) {
      items.ward--;
      battle.enemyStatusEffects = this.withStatus(battle.enemyStatusEffects, {
        id: 'guarded',
        turns: 2,
      });
      battle.log.push(
        battle.enemyName + ' used a Ward Stone and raised its guard.',
      );
      return true;
    }
    if (
      battle.personality === 'defensive' &&
      battle.round % 3 === 2 &&
      health <= 0.65 &&
      !battle.enemyStatusEffects?.some(({ id }) => id === 'blessed')
    ) {
      battle.enemyStatusEffects = this.withStatus(battle.enemyStatusEffects, {
        id: 'blessed',
        turns: 3,
      });
      battle.log.push(battle.enemyName + ' cast Renewal and became Blessed.');
      return true;
    }
    const guardedTarget = target.statusEffects?.some(
      ({ id }) => id === 'guarded',
    );
    const wantsRage =
      battle.personality === 'boss' ? health <= 0.45 : guardedTarget;
    if (
      wantsRage &&
      battle.round % 3 === 2 &&
      !battle.enemyStatusEffects?.some(({ id }) => id === 'enraged')
    ) {
      battle.enemyStatusEffects = this.withStatus(battle.enemyStatusEffects, {
        id: 'enraged',
        turns: 3,
      });
      battle.log.push(battle.enemyName + ' cast Battle Fury and gained Rage.');
      return true;
    }
    return false;
  }

  private pickCpuTarget(
    battle: CpuBattle,
    alive: Player[],
    personality: CpuPersonality,
  ): Player {
    if (battle.encounterId) {
      const score = (player: Player) => {
        const guarded = player.statusEffects?.some(
          ({ id }) => id === 'guarded',
        );
        const evading = player.statusEffects?.some(
          ({ id }) => id === 'evading',
        );
        const vulnerable = 1 - player.hp / Math.max(1, player.maxHp);
        const damage = battle.enemyAttack * (guarded ? 0.5 : 1);
        return (
          vulnerable * 40 +
          (player.focus ?? 0) * 0.21 +
          (player.breakMeter ?? 0) * 0.09 +
          (player.companion?.remaining ? 20 : 0) +
          (this.isImmobilized(player) ? 12 : 0) +
          (player.hp <= damage ? 35 : 0) -
          (guarded ? 20 : 0) -
          (evading ? 26 : 0)
        );
      };
      return alive.reduce((best, player) =>
        score(player) > score(best) ? player : best,
      );
    }
    switch (personality) {
      case 'aggressive': {
        return alive.reduce((a, b) => (a.hp <= b.hp ? a : b));
      }

      case 'strategic': {
        return alive.reduce((a, b) => (a.hp >= b.hp ? a : b));
      }

      case 'defensive': {
        return alive.reduce((a, b) => (a.hp >= b.hp ? a : b));
      }

      case 'chaotic': {
        const weights = alive.map((p) => 1 + (1 - p.hp / p.maxHp) * 3);
        const total = weights.reduce((a, b) => a + b, 0);
        let pick = Math.random() * total;
        for (let i = 0; i < alive.length; i++) {
          pick -= weights[i];
          if (pick <= 0) return alive[i];
        }
        return alive[alive.length - 1];
      }

      case 'boss': {
        const broken = alive.find((p) => this.isImmobilized(p));
        if (broken) return broken;
        return alive.reduce((a, b) => (a.hp <= b.hp ? a : b));
      }

      default:
        return alive[roll(0, alive.length - 1)];
    }
  }

  /* ------------------------------------------------------------------ */
  /* Basic attack                                                        */
  /* ------------------------------------------------------------------ */

  private cpuBasicAttack(
    game: GameState,
    battle: CpuBattle,
    target: Player,
    phaseMultiplier: number,
    canBreak = true,
  ) {
    const roundMult = Math.min(
      ENEMY_ROUND_RAMP_CAP,
      1 + ((battle.round ?? 1) - 1) * ENEMY_ROUND_RAMP,
    );

    const base = roll(
      Math.max(1, battle.enemyAttack - 40),
      battle.enemyAttack + 40,
    );
    const rawDamage = Math.round(base * phaseMultiplier * roundMult);

    const { dealt, dodged, guarded } = this.applyIncomingDamage(
      target,
      rawDamage,
    );

    if (dodged) {
      battle.log.push(`${target.name} dodged ${battle.enemyName}'s attack.`);
      return false;
    }

    // A bonus attack consumes the break and cannot chain into another one.
    const broke = canBreak && this.applyBreakMeter(target, dealt);

    if (guarded) {
      battle.log.push(
        `${target.name} guarded against ${battle.enemyName}, taking only ${dealt} damage.`,
      );
    } else {
      battle.log.push(
        `${battle.enemyName} hits ${target.name} for ${dealt} damage.`,
      );
    }

    if (broke) {
      battle.log.push(`${target.name} is BROKEN!`);
    }

    if (target.hp === 0) {
      battle.log.push(`${target.name} has fallen.`);
    }
    return broke;
  }

  /* ------------------------------------------------------------------ */
  /* Ability pool                                                        */
  /* ------------------------------------------------------------------ */

  private cpuAbility(
    game: GameState,
    battle: CpuBattle,
    target: Player,
    phaseMultiplier: number,
    personality: CpuPersonality,
  ) {
    const aliveTeam = game.teams[battle.attackerTeamId].players.filter(
      (p) => p.status === 'alive',
    );
    const aliveCount = aliveTeam.length;

    const hpRatio =
      battle.enemyMaxHp > 0 ? battle.enemyHp / battle.enemyMaxHp : 1;
    const enraged = personality === 'boss' && hpRatio < ENRAGE_THRESHOLD;

    const pressure = Math.min(
      ENEMY_PRESSURE_CAP,
      1 + (aliveCount - 1) * ENEMY_PRESSURE_PER_PLAYER,
    );

    const enrageMult = enraged ? ENRAGE_MULT : 1;
    const levelScale = battle.encounterId ? battle.enemyAttack / 145 : 1;
    const mult = phaseMultiplier * pressure * enrageMult * levelScale;

    const dmgRoll = (min: number, max: number): number =>
      Math.max(1, Math.round(roll(min, max) * mult));

    const brokenPlayers: Player[] = [];

    /**
     * Applies a hit to a target through the guard/dodge resolver.
     * Returns the resolved damage and crit flag.
     */
    const hit = (
      p: Player,
      rawDmg: number,
    ): { dealt: number; crit: boolean; dodged: boolean; guarded: boolean } => {
      if (p.status !== 'alive') {
        return { dealt: 0, crit: false, dodged: false, guarded: false };
      }

      const crit = Math.random() < 0.12;
      const preGuard = Math.round(rawDmg * (crit ? 1.75 : 1));

      const { dealt, dodged, guarded } = this.applyIncomingDamage(p, preGuard);

      if (this.applyBreakMeter(p, dealt)) {
        brokenPlayers.push(p);
      }

      return { dealt, crit, dodged, guarded };
    };

    const allAbilities: Array<{
      id: CpuAbilityId;
      name: string;
      minRound?: number;
      run: () => void;
    }> = [
      {
        id: 'rend',
        name: 'Rend',
        run: () => {
          const raw = dmgRoll(88, 130);
          const { dealt, crit, dodged, guarded } = hit(target, raw);

          if (dodged) {
            battle.log.push(
              `${target.name} dodged ${battle.enemyName}'s Rend.`,
            );
            return;
          }

          battle.log.push(
            guarded
              ? `${battle.enemyName} Rends ${target.name}, but their guard holds — ${dealt} damage.`
              : crit
                ? `${battle.enemyName} Rends ${target.name} — CRITICAL for ${dealt} damage.`
                : `${battle.enemyName} uses Rend on ${target.name} for ${dealt} damage.`,
          );

          if (target.hp === 0) {
            battle.log.push(`${target.name} has fallen.`);
          }
        },
      },
      {
        id: 'howl',
        name: 'Howl',
        run: () => {
          const gain = enraged ? HOWL_GAIN_ENRAGED : HOWL_GAIN_NORMAL;
          battle.enemyAttack += gain;
          battle.log.push(
            enraged
              ? `${battle.enemyName} howls in fury. Its attacks swell with rage.`
              : `${battle.enemyName} lets out a Howl. Its attacks grow fiercer.`,
          );
        },
      },
      {
        id: 'sweep',
        name: 'Sweep',
        run: () => {
          if (aliveCount === 0) return;

          let anyCrit = false;
          let totalDealt = 0;
          let anyDodged = false;
          let anyGuarded = false;

          for (const p of aliveTeam) {
            const raw = dmgRoll(32, 56);
            const { dealt, crit, dodged, guarded } = hit(p, raw);
            if (crit) anyCrit = true;
            if (dodged) anyDodged = true;
            if (guarded) anyGuarded = true;
            totalDealt += dealt;
          }

          battle.log.push(
            anyDodged
              ? `${battle.enemyName} Sweeps the team — some strikes are dodged.`
              : anyGuarded
                ? `${battle.enemyName} Sweeps the team — guards absorb the brunt for ${totalDealt} total damage.`
                : anyCrit
                  ? `${battle.enemyName} Sweeps the team. A critical cut lands.`
                  : `${battle.enemyName} sweeps across the whole team for ${totalDealt} total damage.`,
          );
        },
      },
      {
        id: 'crush',
        name: 'Crush',
        minRound: 4,
        run: () => {
          const raw = dmgRoll(64, 96);
          let totalDealt = 0;
          let anyDodged = false;

          for (const p of aliveTeam) {
            const { dealt, dodged } = hit(p, raw);
            if (dodged) anyDodged = true;
            totalDealt += dealt;
          }

          battle.log.push(
            anyDodged
              ? `${battle.enemyName} brings down Ruin — some slip the blow. ${totalDealt} total damage.`
              : `${battle.enemyName} brings down Ruin. The team is crushed for ${totalDealt} total damage.`,
          );
        },
      },
      {
        id: 'mend',
        name: 'Mend',
        run: () => {
          const ratio = enraged ? MEND_RATIO_ENRAGED : MEND_RATIO;
          const healAmount = Math.round(battle.enemyMaxHp * ratio);
          const before = battle.enemyHp;
          battle.enemyHp = Math.min(
            battle.enemyMaxHp,
            battle.enemyHp + healAmount,
          );
          const healed = battle.enemyHp - before;
          battle.log.push(
            healed > 0
              ? enraged
                ? `${battle.enemyName} mends its wounds in fury, recovering ${healed} HP.`
                : `${battle.enemyName} mends its wounds for ${healed} HP.`
              : `${battle.enemyName} tries to mend, but it is already whole.`,
          );
        },
      },
      {
        id: 'drain',
        name: 'Drain',
        run: () => {
          const raw = dmgRoll(60, 100);
          const { dealt, crit, dodged } = hit(target, raw);

          if (dodged) {
            battle.log.push(
              `${target.name} dodged ${battle.enemyName}'s Drain.`,
            );
            return;
          }

          const drainAmount = Math.round(dealt * DRAIN_RATIO);
          const before = battle.enemyHp;
          battle.enemyHp = Math.min(
            battle.enemyMaxHp,
            battle.enemyHp + drainAmount,
          );
          const healed = battle.enemyHp - before;

          battle.log.push(
            crit
              ? `${battle.enemyName} Drains ${target.name} — CRITICAL for ${dealt} damage, recovering ${healed} HP.`
              : `${battle.enemyName} Drains ${target.name} for ${dealt} damage and recovers ${healed} HP.`,
          );

          if (target.hp === 0) {
            battle.log.push(`${target.name} has fallen.`);
          }
        },
      },
    ];

    const allowed = battle.abilities ?? null;

    const round = battle.round ?? 1;
    const pool = allAbilities.filter(
      (a) =>
        (a.minRound ?? 1) <= round &&
        (allowed === null || allowed.includes(a.id)),
    );

    if (pool.length === 0) {
      return this.cpuBasicAttack(game, battle, target, phaseMultiplier);
    }

    if (battle.encounterId) {
      const guarded = target.statusEffects?.some(({ id }) => id === 'guarded');
      const evading = target.statusEffects?.some(({ id }) => id === 'evading');
      const recover =
        hpRatio < 0.42 && round - (battle.lastMendRound ?? -10) >= 4;
      const exposed = !guarded && !evading;
      const vulnerable =
        (target.breakMeter ?? 0) >= BREAK_THRESHOLD - BREAK_GAIN_CAP;
      const clustered = aliveTeam.filter(
        (player) => !player.statusEffects?.some(({ id }) => id === 'evading'),
      ).length;
      const scores: Record<CpuAbilityId, number> = {
        mend: recover ? 80 : -100,
        howl: round <= 4 ? (exposed ? 20 : 42) : 0,
        drain: (hpRatio < 0.68 ? 30 : 10) + (exposed ? 8 : 0),
        rend:
          18 +
          (exposed ? 12 : -5) +
          (vulnerable || target.hp < battle.enemyAttack ? 16 : 0),
        sweep: clustered > 1 ? 18 + clustered * 7 : 0,
        crush: clustered > 1 ? 21 + clustered * 8 : 0,
      };
      const score = (id: CpuAbilityId) =>
        scores[id] - (id === battle.lastTactic ? 16 : 0);
      const pick = pool.reduce((best, entry) =>
        score(entry.id) > score(best.id) ? entry : best,
      );
      if (score(pick.id) < 16) {
        battle.lastTactic = undefined;
        return this.cpuBasicAttack(game, battle, target, phaseMultiplier);
      }
      battle.lastTactic = pick.id;
      if (pick.id === 'mend') battle.lastMendRound = round;
      pick.run();
    } else {
      this.pickAbility(pool, enraged, personality).run();
    }

    for (const player of brokenPlayers) {
      battle.log.push(`${player.name} is BROKEN!`);
    }
    return brokenPlayers.length > 0;
  }

  private pickAbility<T extends { id: CpuAbilityId; name: string }>(
    pool: T[],
    enraged: boolean,
    personality: CpuPersonality,
  ): T {
    const weights: Record<CpuAbilityId, number> = {
      rend: 0,
      howl: 0,
      sweep: 0,
      crush: 0,
      mend: 0,
      drain: 0,
    };

    if (enraged) {
      weights.crush = 30;
      weights.rend = 30;
      weights.drain = 25;
      weights.howl = 15;
    } else if (personality === 'boss') {
      weights.rend = 30;
      weights.sweep = 20;
      weights.crush = 10;
      weights.howl = 15;
      weights.mend = 15;
      weights.drain = 10;
    } else if (personality === 'aggressive') {
      weights.rend = 40;
      weights.sweep = 20;
      weights.howl = 10;
      weights.mend = 10;
      weights.drain = 20;
    } else if (personality === 'strategic') {
      weights.rend = 35;
      weights.sweep = 20;
      weights.howl = 15;
      weights.mend = 20;
      weights.drain = 10;
    } else {
      weights.rend = 45;
      weights.sweep = 25;
      weights.howl = 15;
      weights.mend = 5;
      weights.drain = 10;
    }

    const filtered = pool.filter((a) => weights[a.id] > 0);
    if (filtered.length === 0) return pool[0];

    const total = filtered.reduce((sum, a) => sum + weights[a.id], 0);
    let r = Math.random() * total;
    for (const a of filtered) {
      r -= weights[a.id];
      if (r <= 0) return a;
    }
    return filtered[filtered.length - 1];
  }

  /* ------------------------------------------------------------------ */
  /* Signature move                                                      */
  /* ------------------------------------------------------------------ */

  private cpuSignature(
    game: GameState,
    battle: CpuBattle,
    target: Player,
    phaseMultiplier: number,
    limit = false,
  ) {
    const multiplier = battle.signatureMultiplier ?? 1.6;
    const levelScale = battle.encounterId ? battle.enemyAttack / 145 : 1;
    const rawDamage = Math.round(
      roll(112, 160) *
        phaseMultiplier *
        (limit ? 2.2 : multiplier) *
        levelScale,
    );
    const move = limit ? 'Limit Break' : 'signature move';

    const { dealt, dodged, guarded } = this.applyIncomingDamage(
      target,
      rawDamage,
    );

    if (dodged) {
      battle.log.push(`${target.name} dodged ${battle.enemyName}'s ${move}.`);
      return false;
    }

    const broke = this.applyBreakMeter(target, dealt);

    if (limit) {
      battle.log.push(
        battle.enemyName +
          ' unleashed a Limit Break on ' +
          target.name +
          ' for ' +
          dealt +
          ' damage' +
          (guarded ? ' through their guard.' : '.'),
      );
    } else
      battle.log.push(
        guarded
          ? `${battle.enemyName} unleashes a devastating signature move on ${target.name}, but their guard absorbs it — only ${dealt} damage gets through.`
          : `${battle.enemyName} unleashes a devastating signature move on ${target.name} for ${dealt} damage!`,
      );

    if (broke) battle.log.push(`${target.name} is BROKEN!`);

    if (target.hp === 0) {
      battle.log.push(`${target.name} has fallen.`);
    }
    return broke;
  }

  /* ------------------------------------------------------------------ */
  /* Boss phases                                                         */
  /* ------------------------------------------------------------------ */

  private checkBossPhase(battle: CpuBattle) {
    if (!battle.phases || battle.phases.length === 0) return;

    const pct = battle.enemyHp / battle.enemyMaxHp;
    const currentIndex = battle.phaseIndex ?? -1;

    for (let i = currentIndex + 1; i < battle.phases.length; i++) {
      const phase = battle.phases[i];
      if (pct <= phase.hpThreshold) {
        battle.phaseIndex = i;
        battle.log.push(phase.announcement);

        if (phase.healOnEnter) {
          const before = battle.enemyHp;
          battle.enemyHp = Math.min(
            battle.enemyMaxHp,
            battle.enemyHp + phase.healOnEnter,
          );
          const healed = battle.enemyHp - before;
          battle.log.push(`${battle.enemyName} regenerates ${healed} HP!`);
        }
      }
    }
  }

  private currentPhaseMultiplier(battle: CpuBattle): number {
    if (!battle.phases || battle.phaseIndex === undefined) return 1;
    return battle.phases[battle.phaseIndex]?.attackMultiplier ?? 1;
  }
}
