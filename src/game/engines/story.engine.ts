import { GameState, StoryChoice, StoryNode } from '../game.types';

export class StoryEngine {
  private story: Record<string, StoryNode> = {
    start: {
      id: 'start',

      title: 'THE FIRST NIGHT',

      text:
        'The four teams awaken beneath a ruined cathedral. ' +
        'The doors are sealed and something is moving beneath the floor.',

      background: '/images/cathedral.jpg',

      choices: [
        {
          id: 'inspect_altar',

          text: 'Inspect the altar',

          result: 'safe',

          nextNodeId: 'cathedral',
        },

        {
          id: 'enter_crypt',

          text: 'Enter the crypt',

          result: 'random',

          nextNodeId: 'crypt',
        },

        {
          id: 'open_gate',

          text: 'Open the ancient gate',

          result: 'battle',

          nextNodeId: 'tower',

          enemyTeamId: 'wolves',

          enemyName: 'THE HOLLOW KNIGHT',

          enemyHp: 100,

          enemyMaxHp: 100,
        },
      ],
    },

    cathedral: {
      id: 'cathedral',

      title: 'THE CATHEDRAL',

      text:
        'The altar is covered in symbols. ' +
        'A strange whisper echoes through the cathedral.',

      background: '/images/cathedral.jpg',

      choices: [
        {
          id: 'touch_symbol',

          text: 'Touch the symbol',

          result: 'random',

          nextNodeId: 'tower',
        },

        {
          id: 'leave',

          text: 'Leave the cathedral',

          result: 'safe',

          nextNodeId: 'tower',
        },
      ],
    },

    tower: {
      id: 'tower',

      title: 'THE WATCHTOWER',

      text:
        'A ruined tower rises above the forest. ' +
        'Lightning reveals something watching from below.',

      background: '/images/tower.jpg',

      choices: [
        {
          id: 'climb',

          text: 'Climb the tower',

          result: 'safe',

          nextNodeId: 'final_gate',
        },

        {
          id: 'forest',

          text: 'Enter the forest',

          result: 'battle',

          enemyName: 'THE FOREST WRAITH',

          enemyHp: 150,

          enemyMaxHp: 150,
        },
      ],
    },

    final_gate: {
      id: 'final_gate',

      title: 'THE FINAL GATE',

      text:
        'The final gate stands before you. ' +
        'Something ancient waits on the other side.',

      background: '/images/gate.jpg',

      choices: [],
    },

    crypt: {
      id: 'crypt',

      title: 'THE CRYPT',

      text:
        'The floor collapses beneath the team. ' +
        'You hear something breathing in the darkness.',

      background: '/images/crypt.jpg',

      choices: [
        {
          id: 'run',

          text: 'Run',

          result: 'safe',

          nextNodeId: 'tower',
        },

        {
          id: 'fight',

          text: 'Fight whatever is there',

          result: 'battle',

          enemyName: 'CRYPT HORROR',

          enemyHp: 120,

          enemyMaxHp: 120,
        },
      ],
    },
  };

  getNode(nodeId: string): StoryNode | undefined {
    return this.story[nodeId];
  }

  getInitialNode(): StoryNode {
    return this.story.start;
  }

  getStory(): Readonly<Record<string, StoryNode>> {
    return this.story;
  }

  applyChoice(
    game: GameState,
    choiceId: string,
  ): {
    choice: StoryChoice;
    node?: StoryNode;
  } | null {
    const currentNode = this.getNode(game.currentNodeId);

    if (!currentNode) {
      return null;
    }

    const choice = currentNode.choices.find((item) => item.id === choiceId);

    if (!choice) {
      return null;
    }

    if (choice.nextNodeId) {
      game.currentNodeId = choice.nextNodeId;
    }

    return {
      choice,
      node: choice.nextNodeId ? this.getNode(choice.nextNodeId) : undefined,
    };
  }
  replaceNodes(nodes: Record<string, unknown>) {
    // Validate / normalize as needed.
    this.story = nodes as Record<string, StoryNode>;
  }
}
