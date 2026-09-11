/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Battle,
  CombatAction,
  CombatVariant,
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

const SKILL_DAMAGE: Record<SkillId, [number, number]> = {
  shadow_strike: [20, 488],
  blood_rage: [30, 500],
  fire_burst: [26, 44],
  void_blast: [214, 46],
};

const HEAL_AMOUNT: Record<HealId, number> = {
  minor_heal: 210,
  major_heal: 415,
};

const BREAK_THRESHOLD = 100;
const BREAK_PER_DAMAGE = 1.2;
const BREAK_DECAY_PER_ACTION = 15;

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
    const battle: TeamBattle = {
      id: crypto.randomUUID(),
      mode: 'team',
      attackerTeamId,
      defenderTeamId,
      turnTeamId: attackerTeamId,
      status: 'active',
      sourceNodeId,
      log: [`${attackerTeamId} and ${defenderTeamId} collide!`],
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
    },
  ): CpuBattle {
    const battle: CpuBattle = {
      id: crypto.randomUUID(),
      mode: 'cpu',
      attackerTeamId: teamId,
      defenderTeamId: teamId,
      enemyName,
      enemyHp,
      enemyMaxHp,
      enemyAttack: config?.attack ?? roll(12, 22),
      turnTeamId: teamId,
      status: 'active',
      round: 1,
      log: [`${enemyName} emerges from the shadows.`],
      personality: config?.personality ?? 'aggressive',
      abilityChance: config?.abilityChance ?? 0.2,
      signatureEveryNRounds: config?.signatureEveryNRounds ?? 0,
      signatureMultiplier: config?.signatureMultiplier ?? 1.6,
      telegraphs: config?.telegraphs ?? false,
      phases: config?.phases,
      phaseIndex: undefined,
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
    },
  ): CpuBattle {
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
      abilityChance: config.abilityChance ?? 0.4,
      signatureEveryNRounds: config.signatureEveryNRounds ?? 3,
      signatureMultiplier: config.signatureMultiplier ?? 1.8,
      telegraphs: config.telegraphs ?? true,
      phases: config.phases,
      phaseIndex: undefined,
    };

    this.assignFirstAlivePlayer(game, battle, teamId);
    return battle;
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

    battle.log.push(message);

    if (battle.mode === 'team') {
      this.checkTeamBattleEnd(game, battle);
    } else {
      // Only check whether the enemy died. Do NOT retaliate here —
      // the gateway drives that on a delay.
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
        const damage = roll(10, 25);
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
  /* PvP attacks (targeted)                                              */
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
    const damage = roll(10, 25);

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
  /* Heal (targeted)                                                     */
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
    const current = target.breakMeter ?? 0;
    const gain = Math.min(
      BREAK_THRESHOLD,
      Math.round(damage * BREAK_PER_DAMAGE),
    );
    const next = Math.min(BREAK_THRESHOLD, current + gain);
    target.breakMeter = next;

    if (next >= BREAK_THRESHOLD && current < BREAK_THRESHOLD) {
      target.statusEffects = [
        ...(target.statusEffects ?? []).filter((s) => s.id !== 'immobilized'),
        { id: 'immobilized', turns: 1 },
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

    // A fresh break grants the attacker an extra turn.
    if (this.brokeThisAction) {
      this.brokeThisAction = false;
      this.assignFirstAlivePlayer(game, battle, battle.turnTeamId);
      return;
    }

    // Normal alternation.
    battle.turnTeamId =
      battle.turnTeamId === battle.attackerTeamId
        ? battle.defenderTeamId
        : battle.attackerTeamId;

    // If the new side can't act (fully immobilized), flip back so the
    // other side acts again.
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

  // private checkTeamBattleEnd(game: GameState, battle: TeamBattle) {
  //   if (battle.status !== 'active') return;

  //   const attackerAlive = this.sideHasAlive(game, battle.attackerTeamId);
  //   const defenderAlive = this.sideHasAlive(game, battle.defenderTeamId);

  //   if (!attackerAlive && !defenderAlive) {
  //     battle.status = 'defeat';
  //     battle.log.push('Both sides have fallen.');
  //     return;
  //   }
  //   if (!attackerAlive) {
  //     battle.status = 'defeat';
  //     battle.log.push(`${battle.defenderTeamId} stands victorious.`);
  //     return;
  //   }
  //   if (!defenderAlive) {
  //     battle.status = 'victory';
  //     battle.log.push(`${battle.attackerTeamId} stands victorious.`);
  //   }
  // }

  private sideHasAlive(game: GameState, teamId: TeamId) {
    return game.teams[teamId].players.some((p) => p.status === 'alive');
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

    // ---- Phase check (boss battles) --------------------------------------
    this.checkBossPhase(battle);

    // ---- Telegraph -------------------------------------------------------
    if (battle.telegraphs && battle.round % 2 === 0) {
      battle.log.push(`${battle.enemyName} sizes up the party...`);
    }

    // ---- Choose an action ------------------------------------------------
    const personality = battle.personality ?? 'aggressive';
    const abilityChance = battle.abilityChance ?? 0.25;
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

    // ---- Check victory/defeat --------------------------------------------
    const stillAlive = team.players.filter(
      (p) => p.status === 'alive' && !this.isImmobilized(p),
    );
    if (stillAlive.length === 0) {
      battle.status = 'defeat';
      battle.log.push('Your team has been wiped out.');
      return;
    }

    // ---- Advance to the next player --------------------------------------
    const currentIndex = stillAlive.findIndex(
      (p) => p.id === battle.activePlayerId,
    );
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + 1) % stillAlive.length;

    battle.activePlayerId = stillAlive[nextIndex].id;
    battle.turnTeamId = battle.attackerTeamId;
    battle.round += 1;
  }

  /* -------------------------------------------------------------------- */
  /* Target selection                                                     */
  /* ---------------------------------------------------------------------- */

  private pickCpuTarget(
    battle: CpuBattle,
    alive: Player[],
    personality: CpuPersonality,
  ): Player {
    switch (personality) {
      case 'aggressive': {
        // Wound the weakest — best chance to eliminate.
        return alive.reduce((a, b) => (a.hp <= b.hp ? a : b));
      }

      case 'strategic': {
        // Kill the biggest damage threat.
        // Heuristic: players with fewer HP but still alive are more "dangerous"
        // in a short fight, but the real threat is the highest-HP one who can
        // still act. Prefer the highest-HP alive player (likely the carry).
        return alive.reduce((a, b) => (a.hp >= b.hp ? a : b));
      }

      case 'defensive': {
        // Prefer whoever healed last round — approximated by highest HP.
        // In practice you'd track a `lastAction` field; here we pick the
        // healthiest ally so we suppress their sustain.
        return alive.reduce((a, b) => (a.hp >= b.hp ? a : b));
      }

      case 'chaotic': {
        // Weighted random: wounded players are more likely to be picked.
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
        // Boss prioritizes whoever is broken or lowest HP.
        const broken = alive.find((p) => this.isImmobilized(p));
        if (broken) return broken;
        return alive.reduce((a, b) => (a.hp <= b.hp ? a : b));
      }

      default:
        return alive[roll(0, alive.length - 1)];
    }
  }

  /* -------------------------------------------------------------------- */
  /* Basic attack                                                         */
  /* ---------------------------------------------------------------------- */

  private cpuBasicAttack(
    game: GameState,
    battle: CpuBattle,
    target: Player,
    phaseMultiplier: number,
  ) {
    const base = roll(
      Math.max(1, battle.enemyAttack - 4),
      battle.enemyAttack + 4,
    );
    const enemyDmg = Math.round(base * phaseMultiplier);

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

  /* -------------------------------------------------------------------- */
  /* Ability                                                              */
  /* ---------------------------------------------------------------------- */

  private cpuAbility(
    game: GameState,
    battle: CpuBattle,
    target: Player,
    phaseMultiplier: number,
    personality: CpuPersonality,
  ) {
    // Small pool of abilities the CPU can choose from. Expand as you like.
    const abilities = [
      {
        name: 'Rend',
        run: () => {
          const dmg = Math.round(roll(14, 22) * phaseMultiplier);
          target.hp = Math.max(0, target.hp - dmg);
          battle.log.push(
            `${battle.enemyName} uses Rend on ${target.name} for ${dmg} damage.`,
          );
          if (target.hp === 0) {
            target.status = 'eliminated';
            battle.log.push(`${target.name} has fallen.`);
          }
        },
      },
      {
        name: 'Howl',
        run: () => {
          // Buff itself: raises future damage for a couple rounds.
          battle.enemyAttack = Math.round(battle.enemyAttack * 1.15);
          battle.log.push(
            `${battle.enemyName} lets out a Howl. Its attacks grow fiercer.`,
          );
        },
      },
      {
        name: 'Sweep',
        run: () => {
          // AoE: hits everyone for a smaller amount.
          const team = game.teams[battle.attackerTeamId];
          for (const p of team.players) {
            if (p.status !== 'alive') continue;
            const dmg = Math.round(roll(4, 9) * phaseMultiplier);
            p.hp = Math.max(0, p.hp - dmg);
            if (p.hp === 0) {
              p.status = 'eliminated';
              battle.log.push(`${p.name} is struck down by the Sweep.`);
            }
          }
          battle.log.push(`${battle.enemyName} sweeps across the whole team.`);
        },
      },
    ];

    // Bosses and strategic enemies prefer Howl when low; others pick randomly.
    const pick =
      personality === 'boss' && battle.enemyHp < battle.enemyMaxHp * 0.4
        ? abilities[1] // Howl to recover
        : abilities[roll(0, abilities.length - 1)];

    pick.run();
  }

  /* -------------------------------------------------------------------- */
  /* Signature move                                                       */
  /* ---------------------------------------------------------------------- */

  private cpuSignature(
    game: GameState,
    battle: CpuBattle,
    target: Player,
    phaseMultiplier: number,
  ) {
    const multiplier = battle.signatureMultiplier ?? 1.6;
    const dmg = Math.round(roll(18, 26) * phaseMultiplier * multiplier);

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

  /* -------------------------------------------------------------------- */
  /* Boss phases                                                          */
  /* ---------------------------------------------------------------------- */

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
          battle.enemyHp = Math.min(
            battle.enemyMaxHp,
            battle.enemyHp + phase.healOnEnter,
          );
          battle.log.push(
            `${battle.enemyName} regenerates ${phase.healOnEnter} HP!`,
          );
        }
      }
    }
  }

  private currentPhaseMultiplier(battle: CpuBattle): number {
    if (!battle.phases || battle.phaseIndex === undefined) return 1;
    return battle.phases[battle.phaseIndex]?.attackMultiplier ?? 1;
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
}
