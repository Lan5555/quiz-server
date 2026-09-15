/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Battle,
  CombatAction,
  CombatVariant,
  CpuAbilityId,
  CpuBattle,
  CpuPersonality,
  CpuPhase,
  GameState,
  HealId,
  Player,
  SkillId,
  StatusEffect,
  TeamBattle,
  TeamId,
} from '../game.types';

/* ------------------------------------------------------------------ */
/* Tuning constants                                                    */
/* ------------------------------------------------------------------ */

const SKILL_DAMAGE: Record<SkillId, [number, number]> = {
  shadow_strike: [180, 240],
  blood_rage: [220, 300],
  fire_burst: [200, 260],
  void_blast: [230, 300],
};

const HEAL_AMOUNT: Record<HealId, number> = {
  minor_heal: 240,
  major_heal: 520,
};

/** Break meter — harder to trigger, capped gain per hit. */
const BREAK_THRESHOLD = 200;
const BREAK_PER_DAMAGE = 1.2;
const BREAK_GAIN_CAP = 40;
const BREAK_DECAY_PER_ACTION = 20;
const BREAK_MIN_DAMAGE = 50;
const BREAK_DURATION_TURNS = 2;

/** Per-battle uses of each ability type, per player. */
const MAX_SKILL_USES = 6;
const MAX_HEAL_USES = 6;

/** Enemy attack ramp — +3% per round, capped at +50%. */
const ENEMY_ROUND_RAMP = 0.03;
const ENEMY_ROUND_RAMP_CAP = 1.2;

/** Enemy team-size pressure — +20% per extra player, capped at +60%. */
const ENEMY_PRESSURE_PER_PLAYER = 0.2;
const ENEMY_PRESSURE_CAP = 1.25;

/** Enrage — triggers at 50% HP, hits 50% harder. */
const ENRAGE_THRESHOLD = 0.5;
const ENRAGE_MULT = 1.25;

/** Howl is additive so it can't snowball in long fights. Future */
const HOWL_GAIN_NORMAL = 20;
const HOWL_GAIN_ENRAGED = 35;

/** Enemy self-heal tuning. */
const MEND_RATIO = 0.08; // heals 8% max HP
const MEND_RATIO_ENRAGED = 0.12; // 12% when enraged
const DRAIN_RATIO = 0.5; // drains 50% of damage dealt as HP

/** Player damage — scaled to 1000 HP pool. */
const PLAYER_ATTACK = [90, 120] as const;

function isSkillId(value: CombatVariant | undefined): value is SkillId {
  return (
    value === 'shadow_strike' ||
    value === 'blood_rage' ||
    value === 'fire_burst' ||
    value === 'void_blast'
  );
}

function isHealId(value: CombatVariant | undefined): value is HealId {
  return value === 'minor_heal' || value === 'major_heal';
}

function roll(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class CombatEngine {
  /** Set to true when the current action caused a fresh break. */
  private brokeThisAction = false;

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

    const battle: CpuBattle = {
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

    this.assignFirstAlivePlayer(game, battle, teamId);
    return battle;
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
        p.skillCharges = MAX_SKILL_USES;
        p.healCharges = MAX_HEAL_USES;
      }
    }
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

    if (action === 'skill') {
      if ((player.skillCharges ?? 0) <= 0) {
        throw new Error(
          `${player.name} has no skill uses remaining this battle.`,
        );
      }
    }

    if (action === 'heal') {
      if ((player.healCharges ?? 0) <= 0) {
        throw new Error(
          `${player.name} has no heal uses remaining this battle.`,
        );
      }
    }

    if (battle.mode === 'team') {
      if (player.teamId !== battle.turnTeamId) {
        throw new Error("It is not your team's turn.");
      }
    } else {
      if (player.teamId !== battle.attackerTeamId) {
        throw new Error('Only the active team can act.');
      }
    }

    this.brokeThisAction = false;

    if ((player.breakMeter ?? 0) > 0) {
      player.breakMeter = Math.max(
        0,
        (player.breakMeter ?? 0) - BREAK_DECAY_PER_ACTION,
      );
    }

    const message =
      battle.mode === 'team'
        ? this.resolveTeamAction(
            game,
            battle,
            player,
            action,
            variant,
            targetId,
          )
        : this.resolveCpuPlayerAction(game, battle, player, action, variant);

    if (action === 'skill') {
      player.skillCharges = (player.skillCharges ?? 0) - 1;
    }
    if (action === 'heal') {
      player.healCharges = (player.healCharges ?? 0) - 1;
    }

    battle.log.push(message);

    if (battle.mode === 'team') {
      this.checkTeamBattleEnd(game, battle);
    } else {
      if (battle.enemyHp === 0) {
        battle.status = 'victory';
        battle.log.push(`${battle.enemyName} has been destroyed.`);
      }
    }

    return message;
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
        this.applyStatus(player, { id: 'guarded', turns: 1 });
        return `${player.name} raised their guard.`;
      case 'dodge':
        this.applyStatus(player, { id: 'evading', turns: 1 });
        return `${player.name} prepared to dodge.`;
      default:
        throw new Error('Unknown combat action.');
    }
  }

  private resolveCpuPlayerAction(
    game: GameState,
    battle: CpuBattle,
    player: Player,
    action: CombatAction,
    variant?: CombatVariant,
  ): string {
    switch (action) {
      case 'attack': {
        const damage = roll(PLAYER_ATTACK[0], PLAYER_ATTACK[1]);
        battle.enemyHp = Math.max(0, battle.enemyHp - damage);
        return `${player.name} attacked ${battle.enemyName} for ${damage} damage.`;
      }
      case 'skill': {
        const skillId: SkillId = isSkillId(variant) ? variant : 'shadow_strike';
        const [min, max] = SKILL_DAMAGE[skillId];
        const damage = roll(min, max);
        battle.enemyHp = Math.max(0, battle.enemyHp - damage);
        const label = skillId.replace(/_/g, ' ');
        return `${player.name} used ${label} on ${battle.enemyName} for ${damage} damage.`;
      }
      case 'heal':
        return this.heal(game, player, variant);
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
  /* PvP attacks                                                         */
  /* ------------------------------------------------------------------ */

  private pvpAttack(
    game: GameState,
    battle: TeamBattle,
    player: Player,
    opponents: Player[],
    targetId?: string,
  ): string {
    const requested = targetId
      ? opponents.find((p) => p.id === targetId)
      : undefined;
    const target = requested ?? opponents[roll(0, opponents.length - 1)];
    const damage = roll(PLAYER_ATTACK[0], PLAYER_ATTACK[1]);

    target.hp = Math.max(0, target.hp - damage);

    const broke = this.applyBreakMeter(target, damage);

    if (target.hp === 0) {
      target.status = 'eliminated';
      return `${player.name} struck ${target.name} for ${damage} damage — ${target.name} is down!`;
    }

    if (broke) {
      battle.log.push(`${target.name} is BROKEN!`);
      battle.log.push(`${target.name} loses their next turn.`);
    }

    return `${player.name} struck ${target.name} for ${damage} damage.`;
  }

  private pvpSkill(
    game: GameState,
    battle: TeamBattle,
    player: Player,
    opponents: Player[],
    variant?: CombatVariant,
    targetId?: string,
  ): string {
    const skillId: SkillId = isSkillId(variant) ? variant : 'shadow_strike';
    const [min, max] = SKILL_DAMAGE[skillId];
    const requested = targetId
      ? opponents.find((p) => p.id === targetId)
      : undefined;
    const target = requested ?? opponents[roll(0, opponents.length - 1)];
    const damage = roll(min, max);

    target.hp = Math.max(0, target.hp - damage);

    const broke = this.applyBreakMeter(target, damage);
    const label = skillId.replace(/_/g, ' ');

    if (target.hp === 0) {
      target.status = 'eliminated';
      return `${player.name} used ${label} on ${target.name} for ${damage} damage — ${target.name} is down!`;
    }

    if (broke) {
      battle.log.push(`${target.name} is BROKEN!`);
      battle.log.push(`${target.name} loses their next turn.`);
    }

    return `${player.name} used ${label} on ${target.name} for ${damage} damage.`;
  }

  /* ------------------------------------------------------------------ */
  /* Heal                                                                */
  /* ------------------------------------------------------------------ */

  private heal(
    game: GameState,
    player: Player,
    variant?: CombatVariant,
    targetId?: string,
  ): string {
    const healId: HealId = isHealId(variant) ? variant : 'minor_heal';
    const amount = HEAL_AMOUNT[healId];

    const team = game.teams[player.teamId];
    const requested = targetId
      ? team.players.find((p) => p.id === targetId && p.status === 'alive')
      : undefined;
    const target = requested ?? player;

    const oldHp = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const healed = target.hp - oldHp;

    if ((player.breakMeter ?? 0) > 0) {
      player.breakMeter = Math.max(
        0,
        (player.breakMeter ?? 0) - Math.round(healed * 0.5),
      );
    }

    if (healId === 'major_heal') {
      this.applyStatus(player, { id: 'blessed', turns: 2 });
    }

    const label = healId.replace(/_/g, ' ');

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

  private isImmobilized(player: Player): boolean {
    return (player.statusEffects ?? []).some((s) => s.id === 'immobilized');
  }

  private applyBreakMeter(target: Player, damage: number): boolean {
    if (damage < BREAK_MIN_DAMAGE) return false;

    const current = target.breakMeter ?? 0;
    const rawGain = Math.round(damage * BREAK_PER_DAMAGE);
    const gain = Math.min(BREAK_GAIN_CAP, rawGain);

    const next = Math.min(BREAK_THRESHOLD, current + gain);
    target.breakMeter = next;

    if (next >= BREAK_THRESHOLD && current < BREAK_THRESHOLD) {
      target.statusEffects = [
        ...(target.statusEffects ?? []).filter((s) => s.id !== 'immobilized'),
        { id: 'immobilized', turns: BREAK_DURATION_TURNS },
      ];
      target.breakMeter = 0;
      this.brokeThisAction = true;
      return true;
    }
    return false;
  }

  private applyStatus(target: Player, effect: StatusEffect) {
    const existing = target.statusEffects ?? [];
    const idx = existing.findIndex((s) => s.id === effect.id);
    if (idx >= 0) {
      existing[idx] = effect;
      target.statusEffects = existing;
    } else {
      target.statusEffects = [...existing, effect];
    }
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

    if (this.brokeThisAction) {
      this.brokeThisAction = false;
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

  private sideHasAlive(game: GameState, teamId: TeamId) {
    return game.teams[teamId].players.some((p) => p.status === 'alive');
  }

  private markTeamDefeated(game: GameState, teamId: TeamId) {
    const team = game.teams[teamId];
    for (const p of team.players) {
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
    for (const team of Object.values(game.teams)) {
      for (const p of team.players) {
        if (!p.statusEffects?.length) continue;
        p.statusEffects = p.statusEffects
          .map((s) => ({ ...s, turns: s.turns - 1 }))
          .filter((s) => s.turns > 0);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* CPU retaliation                                                     */
  /* ------------------------------------------------------------------ */

  public cpuRetaliate(game: GameState, battle: CpuBattle) {
    const team = game.teams[battle.attackerTeamId];
    const alive = team.players.filter(
      (p) => p.status === 'alive' && !this.isImmobilized(p),
    );
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

    const target = this.pickCpuTarget(battle, alive, personality);
    const phaseMultiplier = this.currentPhaseMultiplier(battle);

    if (usesSignature) {
      this.cpuSignature(game, battle, target, phaseMultiplier);
    } else if (Math.random() < abilityChance) {
      this.cpuAbility(game, battle, target, phaseMultiplier, personality);
    } else {
      this.cpuBasicAttack(game, battle, target, phaseMultiplier);
    }

    const stillAlive = team.players.filter(
      (p) => p.status === 'alive' && !this.isImmobilized(p),
    );
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
  }

  /* ------------------------------------------------------------------ */
  /* Target selection                                                    */
  /* ------------------------------------------------------------------ */

  private pickCpuTarget(
    battle: CpuBattle,
    alive: Player[],
    personality: CpuPersonality,
  ): Player {
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
  ) {
    const roundMult = Math.min(
      ENEMY_ROUND_RAMP_CAP,
      1 + ((battle.round ?? 1) - 1) * ENEMY_ROUND_RAMP,
    );

    const base = roll(
      Math.max(1, battle.enemyAttack - 15),
      battle.enemyAttack + 15,
    );
    const enemyDmg = Math.round(base * phaseMultiplier * roundMult);

    target.hp = Math.max(0, target.hp - enemyDmg);

    const broke = this.applyBreakMeter(target, enemyDmg);

    battle.log.push(
      `${battle.enemyName} hits ${target.name} for ${enemyDmg} damage.`,
    );

    if (broke) {
      battle.log.push(`${target.name} is BROKEN!`);
    }

    if (target.hp === 0) {
      target.status = 'eliminated';
      battle.log.push(`${target.name} has fallen.`);
    }
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
    const mult = phaseMultiplier * pressure * enrageMult;

    const dmgRoll = (min: number, max: number): number =>
      Math.max(1, Math.round(roll(min, max) * mult));

    const hit = (
      p: Player,
      rawDmg: number,
    ): { dealt: number; crit: boolean } => {
      if (p.status !== 'alive') return { dealt: 0, crit: false };

      const crit = Math.random() < 0.12;
      const dmg = Math.round(rawDmg * (crit ? 1.75 : 1));

      p.hp = Math.max(0, p.hp - dmg);

      if (p.hp === 0) {
        p.status = 'eliminated';
        battle.log.push(
          crit
            ? `The blow is critical — ${p.name} falls.`
            : `${p.name} has fallen.`,
        );
      }

      return { dealt: dmg, crit };
    };

    /* ---------------------------------------------------------------- */
    /* Ability definitions                                               */
    /* ---------------------------------------------------------------- */

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
          const { dealt, crit } = hit(target, raw);
          battle.log.push(
            crit
              ? `${battle.enemyName} Rends ${target.name} — CRITICAL for ${dealt} damage.`
              : `${battle.enemyName} uses Rend on ${target.name} for ${dealt} damage.`,
          );
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

          for (const p of aliveTeam) {
            const raw = dmgRoll(32, 56);
            const { dealt, crit } = hit(p, raw);
            if (crit) anyCrit = true;
            totalDealt += dealt;
          }

          battle.log.push(
            anyCrit
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

          for (const p of aliveTeam) {
            const { dealt } = hit(p, raw);
            totalDealt += dealt;
          }

          battle.log.push(
            `${battle.enemyName} brings down Ruin. The team is crushed for ${totalDealt} total damage.`,
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
          const { dealt, crit } = hit(target, raw);

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
        },
      },
    ];

    /* ---------------------------------------------------------------- */
    /* Which abilities are allowed for this enemy?                       */
    /* ---------------------------------------------------------------- */

    const allowed = battle.abilities ?? null;

    const round = battle.round ?? 1;
    const pool = allAbilities.filter(
      (a) =>
        (a.minRound ?? 1) <= round &&
        (allowed === null || allowed.includes(a.id)),
    );

    if (pool.length === 0) {
      // Fallback: nothing allowed this round — basic attack.
      this.cpuBasicAttack(game, battle, target, phaseMultiplier);
      return;
    }

    /* ---------------------------------------------------------------- */
    /* Weighted pick                                                     */
    /* ---------------------------------------------------------------- */

    const pick = this.pickAbility(pool, enraged, personality);
    pick.run();
  }

  /**
   * Weighted pick from the allowed ability pool. Enraged bosses favor
   * Crush + Rend + Drain, regular bosses favor Rend + Sweep with the
   * occasional Mend, and everyone else leans on Rend + Sweep.
   */
  private pickAbility<T extends { id: CpuAbilityId }>(
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
  ) {
    const multiplier = battle.signatureMultiplier ?? 1.6;
    const dmg = Math.round(roll(112, 160) * phaseMultiplier * multiplier);

    target.hp = Math.max(0, target.hp - dmg);

    const broke = this.applyBreakMeter(target, dmg);

    battle.log.push(
      `${battle.enemyName} unleashes a devastating signature move on ${target.name} for ${dmg} damage!`,
    );

    if (broke) battle.log.push(`${target.name} is BROKEN!`);

    if (target.hp === 0) {
      target.status = 'eliminated';
      battle.log.push(`${target.name} has fallen.`);
    }
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
