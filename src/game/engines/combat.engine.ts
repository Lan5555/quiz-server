import { Battle, CombatAction, GameState, Player, TeamId } from '../game.types';

export class CombatEngine {
  createBattle(
    attackerTeamId: TeamId,
    defenderTeamId: TeamId,
    enemyName: string,
    enemyHp: number,
    enemyMaxHp: number,
  ): Battle {
    return {
      id: crypto.randomUUID(),

      attackerTeamId,

      defenderTeamId,

      enemyName,

      enemyHp,

      enemyMaxHp,

      turnTeamId: attackerTeamId,

      status: 'active',

      log: [`${enemyName} has appeared.`],
    };
  }

  performAction(game: GameState, player: Player, action: CombatAction): string {
    if (!game.battle) {
      throw new Error('No active battle.');
    }

    const battle = game.battle;

    if (battle.status !== 'active') {
      throw new Error('Battle has already ended.');
    }

    if (player.status !== 'alive') {
      throw new Error('Eliminated players cannot fight.');
    }

    if (player.teamId !== battle.turnTeamId) {
      throw new Error("It is not your team's turn.");
    }

    let message = '';

    switch (action) {
      case 'attack':
        message = this.attack(game, player);
        break;

      case 'skill':
        message = this.skill(game, player);
        break;

      case 'heal':
        message = this.heal(player);
        break;

      case 'block':
        message = `${player.name} raised their guard.`;
        break;

      case 'dodge':
        message = `${player.name} prepared to dodge.`;
        break;

      default:
        throw new Error('Unknown combat action.');
    }

    battle.log.push(message);

    return message;
  }

  private attack(game: GameState, player: Player): string {
    const battle = game.battle!;

    const damage = Math.floor(Math.random() * 16) + 10;

    battle.enemyHp = Math.max(0, battle.enemyHp - damage);

    if (battle.enemyHp === 0) {
      battle.status = 'victory';

      return `${player.name} dealt ${damage} damage and defeated ${battle.enemyName}!`;
    }

    return `${player.name} attacked for ${damage} damage.`;
  }

  private skill(game: GameState, player: Player): string {
    const battle = game.battle!;

    const damage = Math.floor(Math.random() * 31) + 25;

    battle.enemyHp = Math.max(0, battle.enemyHp - damage);

    if (battle.enemyHp === 0) {
      battle.status = 'victory';

      return `${player.name} unleashed a devastating skill and defeated ${battle.enemyName}!`;
    }

    return `${player.name} used a skill for ${damage} damage.`;
  }

  private heal(player: Player): string {
    const amount = 20;

    const oldHp = player.hp;

    player.hp = Math.min(player.maxHp, player.hp + amount);

    const healed = player.hp - oldHp;

    return `${player.name} recovered ${healed} HP.`;
  }

  nextTurn(game: GameState) {
    if (!game.battle) {
      return;
    }

    const battle = game.battle;

    battle.turnTeamId =
      battle.turnTeamId === battle.attackerTeamId
        ? battle.defenderTeamId
        : battle.attackerTeamId;
  }
}
