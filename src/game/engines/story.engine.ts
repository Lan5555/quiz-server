import { GameState, StoryChoice, StoryNode } from '../game.types';

export class StoryEngine {
  private story: Record<string, StoryNode> = {
    /* ---------------------------------------------------------------- */
    /* Opening                                                           */
    /* ---------------------------------------------------------------- */

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
          enemyName: 'BONE TYRANT',
          enemyHp: 900,
          enemyMaxHp: 900,
        },
        {
          id: 'open_gate',
          text: 'Open the ancient gate (PvP: Ravens vs Wolves)',
          result: 'battle',
          nextNodeId: 'tower',
          versus: ['ravens', 'dragons'],
        },
      ],
    },

    /* ---------------------------------------------------------------- */
    /* Safe path                                                         */
    /* ---------------------------------------------------------------- */

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
          nextNodeId: 'whisper_hall',
        },
        {
          id: 'leave',
          text: 'Leave the cathedral',
          result: 'safe',
          nextNodeId: 'tower',
        },
        {
          id: 'pray',
          text: 'Kneel and pray',
          result: 'safe',
          nextNodeId: 'blessing',
        },
      ],
    },

    blessing: {
      id: 'blessing',
      title: 'A MOMENT OF PEACE',
      text:
        'The whispers soften. For a breath, the darkness feels less hostile. ' +
        'Your team catches its breath.',
      background: '/images/cathedral.jpg',
      choices: [
        {
          id: 'continue',
          text: 'Continue onward',
          result: 'safe',
          nextNodeId: 'tower',
        },
      ],
    },

    whisper_hall: {
      id: 'whisper_hall',
      title: 'THE WHISPERING HALL',
      text:
        'Voices coil around the pillars. One of them calls your name. ' +
        'The floor hums with something alive.',
      background: '/images/cathedral.jpg',
      choices: [
        {
          id: 'answer',
          text: 'Answer the voice',
          result: 'random',
          nextNodeId: 'tower',
        },
        {
          id: 'silence',
          text: 'Stay silent',
          result: 'safe',
          nextNodeId: 'tower',
        },
        {
          id: 'challenge',
          text: 'Challenge the voice (PvP: Dragons vs Serpents)',
          result: 'battle',
          nextNodeId: 'tower',
          versus: ['dragons', 'ravens'],
        },
      ],
    },

    /* ---------------------------------------------------------------- */
    /* Random path                                                       */
    /* ---------------------------------------------------------------- */

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
          text: 'Fight whatever is there (CPU: Crypt Horror)',
          result: 'battle',
          nextNodeId: 'tower',
          enemyName: 'CRYPT HORROR',
          enemyHp: 900,
          enemyMaxHp: 900,
        },
        {
          id: 'listen',
          text: 'Listen in the dark',
          result: 'random',
          nextNodeId: 'ossuary',
        },
      ],
    },

    ossuary: {
      id: 'ossuary',
      title: 'THE OSSUARY',
      text:
        'Bones line every wall. A single skull turns to watch you. ' +
        'It does not attack. Yet.',
      background: '/images/crypt.jpg',
      choices: [
        {
          id: 'take_bone',
          text: 'Take a bone',
          result: 'random',
          nextNodeId: 'tower',
        },
        {
          id: 'back_away',
          text: 'Back away slowly',
          result: 'safe',
          nextNodeId: 'tower',
        },
        {
          id: 'smash',
          text: 'Smash the skull (CPU: Bone Tyrant)',
          result: 'battle',
          nextNodeId: 'tower',
          enemyName: 'BONE TYRANT',
          enemyHp: 90,
          enemyMaxHp: 90,
        },
      ],
    },

    /* ---------------------------------------------------------------- */
    /* Tower branch                                                      */
    /* ---------------------------------------------------------------- */

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
          text: 'Enter the forest (CPU: Forest Wraith)',
          result: 'battle',
          nextNodeId: 'forest_clearing',
          enemyName: 'THE FOREST WRAITH',
          enemyHp: 150,
          enemyMaxHp: 150,
        },
        {
          id: 'signal',
          text: 'Signal the other teams (PvP: Wolves vs Dragons)',
          result: 'battle',
          nextNodeId: 'standoff',
          versus: ['ravens', 'dragons'],
        },
      ],
    },

    forest_clearing: {
      id: 'forest_clearing',
      title: 'THE FOREST CLEARING',
      text:
        'The trees close behind you. Something enormous moves between them, ' +
        'and then stops. The silence is worse than the noise.',
      background: '/images/forest.jpg',
      choices: [
        {
          id: 'press_on',
          text: 'Press onward',
          result: 'safe',
          nextNodeId: 'final_gate',
        },
        {
          id: 'hide',
          text: 'Hide and wait',
          result: 'random',
          nextNodeId: 'final_gate',
        },
      ],
    },

    standoff: {
      id: 'standoff',
      title: 'THE STANDOFF',
      text:
        'Two teams face each other across a ruined courtyard. ' +
        'Neither side speaks. Someone will have to move first.',
      background: '/images/tower.jpg',
      choices: [
        {
          id: 'parley',
          text: 'Attempt parley',
          result: 'safe',
          nextNodeId: 'final_gate',
        },
        {
          id: 'strike',
          text: 'Strike first (PvP: Ravens vs Serpents)',
          result: 'battle',
          nextNodeId: 'final_gate',
          versus: ['ravens', 'dragons'],
        },
      ],
    },

    /* ---------------------------------------------------------------- */
    /* Elimination path                                                  */
    /* ---------------------------------------------------------------- */

    sacrifice: {
      id: 'sacrifice',
      title: 'THE SACRIFICE',
      text:
        'The gate demands a price. Someone must be left behind. ' +
        'The symbols on the ground begin to glow.',
      background: '/images/gate.jpg',
      choices: [
        {
          id: 'offer',
          text: 'Offer a fallen ally (Elimination)',
          result: 'elimination',
          nextNodeId: 'final_gate',
        },
        {
          id: 'refuse',
          text: 'Refuse the gate (CPU: Gate Warden)',
          result: 'battle',
          nextNodeId: 'final_gate',
          enemyName: 'GATE WARDEN',
          enemyHp: 200,
          enemyMaxHp: 200,
        },
      ],
    },

    /* ---------------------------------------------------------------- */
    /* Finale                                                            */
    /* ---------------------------------------------------------------- */

    final_gate: {
      id: 'final_gate',
      title: 'THE FINAL GATE',
      text: 'Something ancient waits on the other side.',
      background: '/images/gate.jpg',
      choices: [
        {
          id: 'face_warden',
          text: 'Face the Gate Warden (Boss)',
          result: 'battle',
          nextNodeId: 'epilogue',
          enemyName: 'NICHOLAS JOHNSON',
          enemyHp: 400,
          enemyMaxHp: 400,
          enemyAttack: 22,
        },
        // ...
      ],
    },

    epilogue: {
      id: 'epilogue',
      title: 'EPILOGUE',
      text:
        'The gate closes behind you. The Chronicle ends here — for now. ' +
        'The next telling will be different.',
      background: '/images/gate.jpg',
      choices: [],
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
  ): { choice: StoryChoice; node?: StoryNode } | null {
    const currentNode = this.getNode(game.currentNodeId);
    if (!currentNode) return null;

    const choice = currentNode.choices.find((item) => item.id === choiceId);
    if (!choice) return null;

    // Defer the pointer move for battles and eliminations — the gateway
    // applies `pendingNextNodeId` when the battle ends.
    const defers =
      choice.result === 'battle' || choice.result === 'elimination';

    if (choice.nextNodeId && !defers) {
      game.currentNodeId = choice.nextNodeId;
    }

    return {
      choice,
      node: choice.nextNodeId ? this.getNode(choice.nextNodeId) : undefined,
    };
  }
}
