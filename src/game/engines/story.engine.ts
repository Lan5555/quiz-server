import { GameState, StoryChoice, StoryNode } from '../game.types';

export class StoryEngine {
  private story: Record<string, StoryNode> = {
    /* ================================================================ */
    /* ACT I — THE AWAKENING                                            */
    /* ================================================================ */

    start: {
      id: 'start',
      title: 'THE HIGHLANDS',
      text:
        'The four teams awaken beneath a blood-red sky. ' +
        'A ruined cathedral surrounds them, its doors sealed from the outside. ' +
        'Nobody remembers how they arrived. ' +
        'Nobody remembers the journey. ' +
        'But somewhere beyond the mountains, something remembers them.',
      background: '/images/cathedral.jpg',

      onEnter: {
        id: 'highlands-opening',
        once: true,
        lines: [
          {
            id: 'opening-01',
            speaker: 'The Chronicler',
            text: 'Welcome to the Highlands.',
            duration: 3200,
            tone: 'mystic',
            voice: '/audio/vo/welcome.mp3',
          },
          {
            id: 'opening-02',
            speaker: 'The Chronicler',
            text: 'Four teams entered.',
            duration: 3000,
            tone: 'mystic',
            voice: '/audio/vo/four_teams.mp3',
          },
          {
            id: 'opening-03',
            speaker: 'The Chronicler',
            text: 'But not all four will leave.',
            duration: 3600,
            tone: 'danger',
            voice: '/audio/vo/not_all_leave.mp3',
          },
          {
            id: 'opening-04',
            speaker: 'The Chronicler',
            text: 'You have been here before.',
            duration: 3300,
            tone: 'mystic',
            voice: '/audio/vo/been_here_before.mp3',
          },
          {
            id: 'opening-05',
            speaker: 'The Chronicler',
            text: 'You simply do not remember.',
            duration: 3600,
            tone: 'dark',
            voice: '/audio/vo/do_not_remember.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'inspect_gate',
          text: 'Approach the ancient gate',
          result: 'safe',
          nextNodeId: 'gate',
        },
        {
          id: 'descend_cliff',
          text: 'Search the cliffs',
          result: 'random',
          nextNodeId: 'gate',
        },
        {
          id: 'search_cathedral',
          text: 'Search the cathedral',
          result: 'safe',
          nextNodeId: 'gate',
        },
      ],
    },

    /* ================================================================ */
    /* THE GATE — PvP #1                                                */
    /* ================================================================ */

    gate: {
      id: 'gate',
      title: 'THE GATE',
      text:
        'A colossal gate stands between the teams and the mountain. ' +
        'Names are carved into the stone. ' +
        'Some belong to people standing beside you. ' +
        'Others belong to people nobody remembers.',
      background: '/images/gate.jpg',

      onEnter: {
        id: 'gate-warden',
        once: true,
        lines: [
          {
            id: 'gate-01',
            speaker: 'Gate Warden',
            text: 'The gate does not imprison you.',
            duration: 3600,
            tone: 'ominous',
            voice: '/audio/vo/gate_warden_01.mp3',
          },
          {
            id: 'gate-02',
            speaker: 'Gate Warden',
            text: 'It protects the world from what is inside.',
            duration: 4200,
            tone: 'danger',
            voice: '/audio/vo/gate_warden_02.mp3',
          },
          {
            id: 'gate-03',
            speaker: 'Gate Warden',
            text: 'And you are the ones it was built to stop.',
            duration: 4300,
            tone: 'danger',
            voice: '/audio/vo/gate_warden_03.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'open_gate',
          text: 'Open the gate (Ravens vs Dragons)',
          result: 'battle',
          nextNodeId: 'cathedral',
          versus: ['ravens', 'dragons'],

          cutscene: {
            id: 'gate-choice',
            lines: [
              {
                id: 'gate-cutscene-01',
                speaker: 'The Gate',
                text: 'Two houses will bleed before this night ends.',
                duration: 3800,
                tone: 'mystic',
                voice: '/audio/vo/two_houses.mp3',
              },
            ],
          },

          onBattle: {
            id: 'gate-battle',
            lines: [
              {
                id: 'gate-battle-01',
                speaker: 'The Chronicler',
                text: 'Ravens and Dragons meet across the threshold.',
                duration: 3400,
                tone: 'danger',
                voice: '/audio/vo/ravens_dragons_battle.mp3',
              },
            ],
          },
        },
        {
          id: 'refuse_gate',
          text: 'Refuse to open it',
          result: 'safe',
          nextNodeId: 'cathedral',
        },
        {
          id: 'search_names',
          text: 'Search the names',
          result: 'random',
          nextNodeId: 'cathedral',
        },
      ],
    },

    /* ================================================================ */
    /* THE CATHEDRAL                                                    */
    /* ================================================================ */

    cathedral: {
      id: 'cathedral',
      title: 'THE CATHEDRAL',
      text:
        'The altar is covered in symbols. ' +
        'The same four symbols appear again and again: ' +
        'a raven, a serpent, a dragon and a wolf.',
      background: '/images/cathedral.jpg',

      onEnter: {
        id: 'cathedral-voices',
        once: true,
        lines: [
          {
            id: 'cathedral-01',
            speaker: 'Unknown Woman',
            text: 'Why is my name on this?',
            duration: 3000,
            tone: 'fear',
            voice: '/audio/vo/gate_ravens_01.mp3',
          },
          {
            id: 'cathedral-02',
            speaker: 'Unknown Man',
            text: "Everyone's name is here.",
            duration: 3200,
            tone: 'fear',
            voice: '/audio/vo/gate_serpents_01.mp3',
          },
          {
            id: 'cathedral-03',
            speaker: 'Unknown',
            text: 'Not everyone.',
            duration: 2600,
            tone: 'dark',
            voice: '/audio/vo/gate_unknown_01.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'touch_symbol',
          text: 'Touch the symbol',
          result: 'random',
          nextNodeId: 'blessing',
        },
        {
          id: 'read_symbols',
          text: 'Study the four symbols',
          result: 'safe',
          nextNodeId: 'blessing',
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
        'The whispers soften. For one brief moment, the Highlands feels almost peaceful. ' +
        'The team catches its breath.',
      background: '/images/cathedral.jpg',

      choices: [
        {
          id: 'continue',
          text: 'Continue onward',
          result: 'safe',
          nextNodeId: 'cliff',
        },
        {
          id: 'rest_longer',
          text: 'Rest a while longer',
          result: 'safe',
          nextNodeId: 'cliff',
        },
        {
          id: 'search_pews',
          text: 'Search the pews',
          result: 'random',
          nextNodeId: 'cliff',
        },
      ],
    },

    /* ================================================================ */
    /* THE ABYSS                                                        */
    /* ================================================================ */

    cliff: {
      id: 'cliff',
      title: 'THE ABYSS',
      text:
        'The mountain ends abruptly at a massive cliff. ' +
        'There is no bottom. ' +
        'Only darkness.',
      background: '/images/cliff.jpg',

      onEnter: {
        id: 'abyss-voices',
        once: true,
        lines: [
          {
            id: 'abyss-01',
            speaker: 'The Abyss',
            text: 'We remember you.',
            duration: 3200,
            tone: 'horror',
            voice: '/audio/vo/abyss_01.mp3',
          },
          {
            id: 'abyss-02',
            speaker: 'The Abyss',
            text: 'Why do you keep coming back?',
            duration: 3800,
            tone: 'horror',
            voice: '/audio/vo/abyss_02.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'look_down',
          text: 'Look into the abyss',
          result: 'random',
          nextNodeId: 'echo',
        },
        {
          id: 'step_back',
          text: 'Step away',
          result: 'safe',
          nextNodeId: 'echo',
        },
        {
          id: 'jump',
          text: 'Step into the darkness',
          result: 'elimination',
          nextNodeId: 'echo',
        },
      ],
    },

    /* ================================================================ */
    /* THE ECHO                                                         */
    /* ================================================================ */

    echo: {
      id: 'echo',
      title: 'THE ECHO',
      text:
        'A voice comes from behind you. ' +
        'When you turn around, nobody is there.',
      background: '/images/forest.jpg',

      onEnter: {
        id: 'echo-voices',
        once: true,
        lines: [
          {
            id: 'echo-01',
            speaker: 'The Echo',
            text: 'Do you remember the first time you died?',
            duration: 4000,
            tone: 'mystic',
            voice: '/audio/vo/echo_01.mp3',
          },
          {
            id: 'echo-02',
            speaker: 'The Echo',
            text: 'No?',
            duration: 1900,
            tone: 'dark',
            voice: '/audio/vo/echo_02.mp3',
          },
          {
            id: 'echo-03',
            speaker: 'The Echo',
            text: 'That makes sense.',
            duration: 3000,
            tone: 'distorted',
            voice: '/audio/vo/echo_03.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'follow_echo',
          text: 'Follow the voice (CPU: Echo Beast)',
          result: 'battle',
          nextNodeId: 'memory',
          enemyName: 'ECHO BEAST',
          enemyHp: 1000,
          enemyMaxHp: 1000,
          enemyAttack: 16,

          onBattle: {
            id: 'echo-beast',
            lines: [
              {
                id: 'echo-beast-01',
                speaker: 'Echo Beast',
                text: 'You should have kept looking.',
                duration: 3400,
                tone: 'horror',
                voice: '/audio/vo/echo_beast_01.mp3',
              },
              {
                id: 'echo-beast-02',
                speaker: 'Echo Beast',
                text: 'Now you belong to us.',
                duration: 3200,
                tone: 'danger',
                voice: '/audio/vo/echo_beast_02.mp3',
              },
            ],
          },
        },
        {
          id: 'ignore_echo',
          text: 'Ignore the voice',
          result: 'safe',
          nextNodeId: 'memory',
        },
        {
          id: 'look_longer',
          text: 'Look deeper into the memory',
          result: 'random',
          nextNodeId: 'memory',
        },
      ],
    },

    /* ================================================================ */
    /* THE MEMORY                                                       */
    /* ================================================================ */

    memory: {
      id: 'memory',
      title: "A MEMORY THAT ISN'T YOURS",
      text:
        'The world changes. ' +
        'For a moment, the Highlands disappears. ' +
        'You see a village burning beneath the mountain. ' +
        'But the flames do not move. The smoke does not rise. ' +
        'It is a painting. A lie painted on the inside of your eyes.',
      background: '/images/burning_village.jpg',

      onEnter: {
        id: 'memory-sequence',
        once: true,
        lines: [
          {
            id: 'memory-01',
            speaker: 'Memory Woman',
            text: 'Please... somebody help us.',
            duration: 3400,
            tone: 'fear',
            voice: '/audio/vo/memory_woman_01.mp3',
          },
          {
            id: 'memory-02',
            speaker: 'Memory Child',
            text: 'Where is everyone going?',
            duration: 3000,
            tone: 'sad',
            voice: '/audio/vo/memory_child_01.mp3',
          },
          {
            id: 'memory-03',
            speaker: 'Memory Man',
            text: 'Do not let him reach the mountain.',
            duration: 3800,
            tone: 'fear',
            voice: '/audio/vo/memory_man_01.mp3',
          },
          {
            id: 'memory-04',
            speaker: 'Nicholas Johnson',
            text: 'Too late.',
            duration: 2500,
            tone: 'dark',
            voice: '/audio/vo/nicholas_memory_01.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'follow_nicholas',
          text: 'Follow the man',
          result: 'safe',
          nextNodeId: 'burning_house',
        },
        {
          id: 'save_memory',
          text: 'Try to save the people',
          result: 'random',
          nextNodeId: 'burning_house',
        },
        {
          id: 'reject_memory',
          text: 'Reject the vision',
          result: 'safe',
          nextNodeId: 'burning_house',
        },
      ],
    },

    burning_house: {
      id: 'burning_house',
      title: 'THE BURNING HOUSE',
      text:
        'Flames consume the old house. ' +
        'Yet the photographs refuse to burn. ' +
        'A familiar voice speaks from behind you.',
      background: '/images/burning_house.jpg',

      onEnter: {
        id: 'burning-house-nicholas',
        once: true,
        lines: [
          {
            id: 'burning-01',
            speaker: 'Nicholas Johnson',
            text: 'You should have left the past alone.',
            duration: 3800,
            tone: 'sad',
            voice: '/audio/vo/nicholas_house_01.mp3',
          },
          {
            id: 'burning-02',
            speaker: 'Nicholas Johnson',
            text: 'It is cruel when it burns.',
            duration: 3200,
            tone: 'sad',
            voice: '/audio/vo/nicholas_house_02.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'chase_voice',
          text: 'Chase the voice',
          result: 'safe',
          nextNodeId: 'village',
        },
        {
          id: 'escape_fire',
          text: 'Escape the fire',
          result: 'safe',
          nextNodeId: 'village',
        },
        {
          id: 'burn_photos',
          text: 'Burn the photographs',
          result: 'random',
          nextNodeId: 'village',
        },
      ],
    },

    /* ================================================================ */
    /* THE DEAD VILLAGE                                                 */
    /* ================================================================ */

    village: {
      id: 'village',
      title: 'THE DEAD VILLAGE',
      text:
        'An abandoned village sits beneath the mountain. ' +
        'There are no bodies. ' +
        'There are no animals. ' +
        'There is not even wind. ' +
        'But in the center of the square, four fresh graves have been dug. ' +
        'Each one is the exact size of a team member.',
      background: '/images/village.jpg',

      onEnter: {
        id: 'village-voices',
        once: true,
        lines: [
          {
            id: 'village-01',
            speaker: 'Village Elder',
            text: 'Four teams.',
            duration: 2700,
            tone: 'mystic',
            voice: '/audio/vo/village_unknown_01.mp3',
          },
          {
            id: 'village-02',
            speaker: 'Village Elder',
            text: 'Four chances to disappoint him.',
            duration: 3800,
            tone: 'dark',
            voice: '/audio/vo/village_unknown_02.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'enter_house',
          text: 'Enter the old house',
          result: 'safe',
          nextNodeId: 'old_house',
        },
        {
          id: 'search_village',
          text: 'Search the village',
          result: 'random',
          nextNodeId: 'old_house',
        },
        {
          id: 'open_grave',
          text: 'Open one of the graves',
          result: 'safe',
          nextNodeId: 'old_house',
        },
      ],
    },

    old_house: {
      id: 'old_house',
      title: 'THE OLD HOUSE',
      text:
        'Photographs cover the walls. ' +
        'Every photograph contains one of the four teams. ' +
        'Some photographs are impossibly old. ' +
        'In one of them, Nicholas Johnson stands beside a woman ' +
        'who has your face.',
      background: '/images/old_house.jpg',

      onEnter: {
        id: 'old-house-voices',
        once: true,
        lines: [
          {
            id: 'house-01',
            speaker: 'The Housekeeper',
            text: 'You always look surprised when you find these.',
            duration: 3600,
            tone: 'mystic',
            voice: '/audio/vo/house_unknown_01.mp3',
          },
          {
            id: 'house-02',
            speaker: 'The Housekeeper',
            text: 'You should be used to it by now.',
            duration: 3400,
            tone: 'dark',
            voice: '/audio/vo/house_unknown_02.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'read_journal',
          text: 'Read the journal',
          result: 'safe',
          nextNodeId: 'journal',
        },
        {
          id: 'leave_house',
          text: 'Leave',
          result: 'safe',
          nextNodeId: 'journal',
        },
        {
          id: 'burn_photos_2',
          text: 'Burn the photographs',
          result: 'random',
          nextNodeId: 'journal',
        },
      ],
    },

    journal: {
      id: 'journal',
      title: 'THE JOURNAL',
      text:
        "The journal is written in Nicholas Johnson's handwriting. " +
        'The entries describe people arriving at the Highlands long before tonight. ' +
        'The final entry is dated tomorrow.',
      background: '/images/journal.jpg',

      onEnter: {
        id: 'nicholas-journal',
        once: true,
        lines: [
          {
            id: 'journal-01',
            speaker: 'Nicholas Johnson',
            text: 'Day 1. They arrived today.',
            duration: 3300,
            tone: 'neutral',
            voice: '/audio/vo/nicholas_journal_01.mp3',
          },
          {
            id: 'journal-02',
            speaker: 'Nicholas Johnson',
            text: 'Day 17. They are beginning to forget.',
            duration: 3600,
            tone: 'worried',
            voice: '/audio/vo/nicholas_journal_02.mp3',
          },
          {
            id: 'journal-03',
            speaker: 'Nicholas Johnson',
            text: 'Day 42. I have stopped asking for forgiveness.',
            duration: 4000,
            tone: 'broken',
            voice: '/audio/vo/nicholas_journal_03.mp3',
          },
          {
            id: 'journal-04',
            speaker: 'Nicholas Johnson',
            text: 'Day 43. There is no one left to forgive me.',
            duration: 4200,
            tone: 'tragic',
            voice: '/audio/vo/nicholas_journal_04.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'take_journal',
          text: 'Take the journal',
          result: 'safe',
          nextNodeId: 'bell_tower',
        },
        {
          id: 'destroy_journal',
          text: 'Destroy the journal',
          result: 'random',
          nextNodeId: 'bell_tower',
        },
        {
          id: 'read_last_page',
          text: 'Read the last page',
          result: 'safe',
          nextNodeId: 'bell_tower',
        },
      ],
    },

    bell_tower: {
      id: 'bell_tower',
      title: 'THE BELL TOWER',
      text:
        'A gigantic bell hangs above the tower. ' +
        'Its surface is covered with names. ' +
        'One of the names is yours. ' +
        'It has been crossed out and rewritten fourteen times.',
      background: '/images/bell_tower.jpg',

      onEnter: {
        id: 'bell-keeper',
        once: true,
        lines: [
          {
            id: 'bell-01',
            speaker: 'Bell Keeper',
            text: 'You should not have rung the bell.',
            duration: 3600,
            tone: 'ominous',
            voice: '/audio/vo/bell_keeper_01.mp3',
          },
          {
            id: 'bell-02',
            speaker: 'Bell Keeper',
            text: 'Every bell remembers a death.',
            duration: 3600,
            tone: 'dark',
            voice: '/audio/vo/bell_keeper_02.mp3',
          },
          {
            id: 'bell-03',
            speaker: 'Bell Keeper',
            text: 'Which one of you will it remember tonight?',
            duration: 4000,
            tone: 'danger',
            voice: '/audio/vo/bell_keeper_03.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'ring_bell',
          text: 'Ring the bell (CPU: The Bell Keeper)',
          result: 'battle',
          nextNodeId: 'blood_hunters',
          enemyName: 'THE BELL KEEPER',
          enemyHp: 1200,
          enemyMaxHp: 1200,
          enemyAttack: 18,
        },
        {
          id: 'leave_bell',
          text: 'Leave the tower',
          result: 'safe',
          nextNodeId: 'blood_hunters',
        },
        {
          id: 'read_names',
          text: 'Read the names',
          result: 'safe',
          nextNodeId: 'blood_hunters',
        },
      ],
    },

    blood_hunters: {
      id: 'blood_hunters',
      title: 'THE BLOOD HUNTERS',
      text:
        'Masked hunters surround the path. ' +
        'Their weapons are stained with blood, but none of them looks afraid. ' +
        'When they remove their masks, they have your face. ' +
        'All of them.',
      background: '/images/hunters.jpg',

      onEnter: {
        id: 'blood-hunters-intro',
        once: true,
        lines: [
          {
            id: 'hunter-01',
            speaker: 'Blood Hunter Captain',
            text: 'Which team do you belong to?',
            duration: 3200,
            tone: 'cold',
            voice: '/audio/vo/blood_hunter_01.mp3',
          },
          {
            id: 'hunter-02',
            speaker: 'Blood Hunter Captain',
            text: 'It does not matter.',
            duration: 2800,
            tone: 'cold',
            voice: '/audio/vo/blood_hunter_02.mp3',
          },
          {
            id: 'hunter-03',
            speaker: 'Blood Hunter Captain',
            text: 'He told us all four must bleed.',
            duration: 3600,
            tone: 'danger',
            voice: '/audio/vo/blood_hunter_03.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'fight_hunters',
          text: 'Fight the Blood Hunters (CPU)',
          result: 'battle',
          nextNodeId: 'graveyard',
          enemyName: 'BLOOD HUNTERS',
          enemyHp: 1300,
          enemyMaxHp: 1300,
          enemyAttack: 20,
        },
        {
          id: 'run_hunters',
          text: 'Run',
          result: 'safe',
          nextNodeId: 'graveyard',
        },
        {
          id: 'hide_hunters',
          text: 'Hide and wait',
          result: 'random',
          nextNodeId: 'graveyard',
        },
      ],
    },

    graveyard: {
      id: 'graveyard',
      title: 'THE GRAVEYARD',
      text:
        'Hundreds of graves surround the path. ' +
        'Every grave carries a name belonging to someone you recognize. ' +
        'Except one. ' +
        'The oldest grave bears your name. ' +
        'The date of death is two hundred years before you were born.',
      background: '/images/graveyard.jpg',

      onEnter: {
        id: 'graveyard-voices',
        once: true,
        lines: [
          {
            id: 'grave-01',
            speaker: 'The Gravekeeper',
            text: 'You were supposed to die here.',
            duration: 3400,
            tone: 'dark',
            voice: '/audio/vo/grave_voice_01.mp3',
          },
          {
            id: 'grave-02',
            speaker: 'The Gravekeeper',
            text: 'You already did.',
            duration: 3000,
            tone: 'horror',
            voice: '/audio/vo/grave_voice_02.mp3',
          },
          {
            id: 'grave-03',
            speaker: 'Raven Spirit',
            text: 'Ravens...',
            duration: 2200,
            tone: 'whisper',
            voice: '/audio/vo/graveyard_whisper_01.mp3',
          },
          {
            id: 'grave-04',
            speaker: 'Serpent Spirit',
            text: 'Serpents...',
            duration: 2200,
            tone: 'whisper',
            voice: '/audio/vo/graveyard_whisper_02.mp3',
          },
          {
            id: 'grave-05',
            speaker: 'Dragon Spirit',
            text: 'Dragons...',
            duration: 2200,
            tone: 'whisper',
            voice: '/audio/vo/graveyard_whisper_03.mp3',
          },
          {
            id: 'grave-06',
            speaker: 'Wolf Spirit',
            text: 'Wolves...',
            duration: 2200,
            tone: 'whisper',
            voice: '/audio/vo/graveyard_whisper_04.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'challenge_gravekeeper',
          text: 'Challenge the Gravekeeper (CPU)',
          result: 'battle',
          nextNodeId: 'team_crossroads',
          enemyName: 'THE REMNANT',
          enemyHp: 1400,
          enemyMaxHp: 1400,
          enemyAttack: 21,
        },
        {
          id: 'open_grave_2',
          text: 'Open one of the graves',
          result: 'random',
          nextNodeId: 'team_crossroads',
        },
        {
          id: 'leave_graveyard',
          text: 'Leave the graveyard',
          result: 'safe',
          nextNodeId: 'team_crossroads',
        },
      ],
    },

    /* ================================================================ */
    /* ACT II — FOUR HOUSES                                             */
    /* ================================================================ */

    team_crossroads: {
      id: 'team_crossroads',
      title: 'FOUR HOUSES',
      text:
        'The four teams finally stand together. ' +
        'Ravens. Serpents. Dragons. Wolves. ' +
        'For the first time, everyone understands that the Highlands was built for them.',
      background: '/images/courtyard.jpg',

      onEnter: {
        id: 'four-houses',
        once: true,
        lines: [
          {
            id: 'houses-01',
            speaker: 'The Chronicler',
            text: 'Four houses.',
            duration: 2400,
            tone: 'mystic',
            voice: '/audio/vo/four_houses_01.mp3',
          },
          {
            id: 'houses-02',
            speaker: 'The Chronicler',
            text: 'Four memories.',
            duration: 2500,
            tone: 'mystic',
            voice: '/audio/vo/four_houses_02.mp3',
          },
          {
            id: 'houses-03',
            speaker: 'The Chronicler',
            text: 'Only one survives the Highlands.',
            duration: 3600,
            tone: 'danger',
            voice: '/audio/vo/four_houses_03.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'ravens_dragons',
          text: 'Ravens confront Dragons (PvP)',
          result: 'battle',
          nextNodeId: 'team_war_aftermath',
          versus: ['ravens', 'dragons'],

          cutscene: {
            id: 'ravens-dragons-cutscene',
            lines: [
              {
                id: 'rd-01',
                speaker: 'Ravens Captain',
                text: 'We have lost enough people tonight.',
                duration: 3600,
                tone: 'angry',
                voice: '/audio/vo/ravens_captain_01.mp3',
              },
              {
                id: 'rd-02',
                speaker: 'Dragons Captain',
                text: 'Then stop standing in our way.',
                duration: 3400,
                tone: 'aggressive',
                voice: '/audio/vo/dragons_captain_01.mp3',
              },
            ],
          },

          onBattle: {
            id: 'ravens-dragons-battle',
            lines: [
              {
                id: 'rd-battle',
                speaker: 'The Chronicler',
                text: 'The courtyard erupts into chaos.',
                duration: 3400,
                tone: 'danger',
                voice: '/audio/vo/ravens_dragons_battle.mp3',
              },
            ],
          },
        },
        {
          id: 'serpents_wolves',
          text: 'Serpents confront Wolves (PvP)',
          result: 'battle',
          nextNodeId: 'team_war_aftermath',
          versus: ['serpents', 'wolves'],

          cutscene: {
            id: 'serpents-wolves-cutscene',
            lines: [
              {
                id: 'sw-01',
                speaker: 'Serpents Captain',
                text: 'We know what you did.',
                duration: 3300,
                tone: 'accusing',
                voice: '/audio/vo/serpents_captain_01.mp3',
              },
              {
                id: 'sw-02',
                speaker: 'Wolves Captain',
                text: 'You know nothing.',
                duration: 3000,
                tone: 'angry',
                voice: '/audio/vo/wolves_captain_01.mp3',
              },
            ],
          },

          onBattle: {
            id: 'serpents-wolves-battle',
            lines: [
              {
                id: 'sw-battle',
                speaker: 'The Chronicler',
                text: 'Steel clashes beneath the blood-red sky.',
                duration: 3500,
                tone: 'danger',
                voice: '/audio/vo/serpents_wolves_battle.mp3',
              },
            ],
          },
        },
        {
          id: 'refuse_war',
          text: 'Refuse to fight',
          result: 'safe',
          nextNodeId: 'team_war_aftermath',
        },
      ],
    },

    team_war_aftermath: {
      id: 'team_war_aftermath',
      title: 'AFTER THE BLOOD',
      text:
        'The battlefield falls silent. ' +
        'The survivors stare at one another. ' +
        'Then someone begins to laugh.',
      background: '/images/courtyard.jpg',

      onEnter: {
        id: 'nicholas-war-aftermath',
        once: true,
        lines: [
          {
            id: 'war-01',
            speaker: 'Nicholas Johnson',
            text: 'Excellent.',
            duration: 2300,
            tone: 'pleased',
            voice: '/audio/vo/nicholas_war_01.mp3',
          },
          {
            id: 'war-02',
            speaker: 'Nicholas Johnson',
            text: 'You are finally becoming what I knew you would become.',
            duration: 4300,
            tone: 'pleased',
            voice: '/audio/vo/nicholas_war_02.mp3',
          },
          {
            id: 'war-03',
            speaker: 'Nicholas Johnson',
            text: 'Enemies.',
            duration: 2400,
            tone: 'dark',
            voice: '/audio/vo/nicholas_war_03.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'seek_nicholas',
          text: 'Find Nicholas',
          result: 'safe',
          nextNodeId: 'alliance',
        },
        {
          id: 'continue_mountain',
          text: 'Continue toward the mountain',
          result: 'safe',
          nextNodeId: 'alliance',
        },
        {
          id: 'search_bodies',
          text: 'Search the bodies',
          result: 'random',
          nextNodeId: 'alliance',
        },
      ],
    },

    alliance: {
      id: 'alliance',
      title: 'THE LAST ALLIANCE',
      text:
        'The surviving members finally understand the truth. ' +
        'The teams were never meant to escape separately. ' +
        'They were meant to destroy one another.',
      background: '/images/mountain.jpg',

      onEnter: {
        id: 'alliance-voices',
        once: true,
        lines: [
          {
            id: 'alliance-01',
            speaker: 'Wolves Captain',
            text: 'We stop fighting each other.',
            duration: 3400,
            tone: 'determined',
            voice: '/audio/vo/wolves_alliance_01.mp3',
          },
          {
            id: 'alliance-02',
            speaker: 'Ravens Captain',
            text: 'And if the mountain turns us against each other?',
            duration: 3800,
            tone: 'worried',
            voice: '/audio/vo/ravens_alliance_01.mp3',
          },
          {
            id: 'alliance-03',
            speaker: 'Serpents Captain',
            text: 'Then we remind ourselves who the real enemy is.',
            duration: 4000,
            tone: 'determined',
            voice: '/audio/vo/serpents_alliance_01.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'climb_mountain',
          text: 'Climb the mountain',
          result: 'safe',
          nextNodeId: 'mountain_path',
        },
        {
          id: 'search_sanctum',
          text: 'Search for the hidden entrance',
          result: 'safe',
          nextNodeId: 'mountain_path',
        },
        {
          id: 'rest_alliance',
          text: 'Rest before the climb',
          result: 'safe',
          nextNodeId: 'mountain_path',
        },
      ],
    },

    mountain_path: {
      id: 'mountain_path',
      title: 'THE MOUNTAIN PATH',
      text:
        'The path narrows as the mountain rises. ' +
        'Ancient armor lies scattered across the snow. ' +
        'Every suit of armor is sized for a child.',
      background: '/images/mountain.jpg',

      choices: [
        {
          id: 'fight_knights',
          text: 'Pass through the fallen knights (CPU)',
          result: 'battle',
          nextNodeId: 'truth',
          enemyName: 'HOLLOW KNIGHTS',
          enemyHp: 1600,
          enemyMaxHp: 1600,
          enemyAttack: 28,

          onBattle: {
            id: 'hollow-knights',
            lines: [
              {
                id: 'hk-01',
                speaker: 'Hollow Knight Commander',
                text: 'We died defending the Highlands.',
                duration: 3600,
                tone: 'hollow',
                voice: '/audio/vo/hollow_knight_01.mp3',
              },
              {
                id: 'hk-02',
                speaker: 'Hollow Knight Commander',
                text: 'Now you will die defending it too.',
                duration: 3600,
                tone: 'danger',
                voice: '/audio/vo/hollow_knight_02.mp3',
              },
            ],
          },
        },
        {
          id: 'avoid_knights',
          text: 'Avoid the armor',
          result: 'safe',
          nextNodeId: 'truth',
        },
        {
          id: 'search_snow',
          text: 'Search the snow',
          result: 'random',
          nextNodeId: 'truth',
        },
      ],
    },

    /* ================================================================ */
    /* ACT III — THE TRUTH                                              */
    /* ================================================================ */

    truth: {
      id: 'truth',
      title: 'THE TRUTH',
      text:
        'The mountain opens. ' +
        'A massive chamber lies beneath it. ' +
        'Screens display memories of the four teams. ' +
        'Hundreds of them. ' +
        'And in the center of the chamber, a single chair. ' +
        'The chair is warm. Someone has been sitting in it.',
      background: '/images/sanctum.jpg',

      onEnter: {
        id: 'nicholas-truth',
        once: true,
        lines: [
          {
            id: 'truth-01',
            speaker: 'Nicholas Johnson',
            text: 'Now you remember.',
            duration: 3000,
            tone: 'calm',
            voice: '/audio/vo/nicholas_truth_01.mp3',
          },
          {
            id: 'truth-02',
            speaker: 'Nicholas Johnson',
            text: 'You were never prisoners.',
            duration: 3400,
            tone: 'calm',
            voice: '/audio/vo/nicholas_truth_02.mp3',
          },
          {
            id: 'truth-03',
            speaker: 'Nicholas Johnson',
            text: 'You were participants.',
            duration: 3200,
            tone: 'dark',
            voice: '/audio/vo/nicholas_truth_03.mp3',
          },
          {
            id: 'truth-04',
            speaker: 'Nicholas Johnson',
            text: 'Every battle was part of the experiment.',
            duration: 3900,
            tone: 'dark',
            voice: '/audio/vo/nicholas_truth_04.mp3',
          },
          {
            id: 'truth-05',
            speaker: 'Nicholas Johnson',
            text: 'Every death taught me something.',
            duration: 3600,
            tone: 'tragic',
            voice: '/audio/vo/nicholas_truth_05.mp3',
          },
          {
            id: 'truth-06',
            speaker: 'Nicholas Johnson',
            text: 'And I built the Highlands to remember all of it.',
            duration: 4300,
            tone: 'broken',
            voice: '/audio/vo/nicholas_truth_06.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'demand_answers',
          text: 'Demand answers',
          result: 'safe',
          nextNodeId: 'final_duel',
        },
        {
          id: 'search_room',
          text: 'Search the chamber',
          result: 'random',
          nextNodeId: 'final_duel',
        },
        {
          id: 'sit_in_chair',
          text: 'Sit in the chair',
          result: 'safe',
          nextNodeId: 'final_duel',
        },
      ],
    },

    /* ================================================================ */
    /* THE FINAL DUEL — PvP #2                                          */
    /* ================================================================ */

    final_duel: {
      id: 'final_duel',
      title: 'THE FINAL DUEL',
      text:
        'The machine hums. ' +
        'The surviving teams stand in the chamber. ' +
        'Nicholas speaks from everywhere and nowhere at once.',
      background: '/images/sanctum.jpg',

      onEnter: {
        id: 'final-duel-intro',
        once: true,
        lines: [
          {
            id: 'duel-01',
            speaker: 'Nicholas Johnson',
            text: 'Only one of you is allowed to reach me.',
            duration: 4000,
            tone: 'cold',
            voice: '/audio/vo/nicholas_final_duel_01.mp3',
          },
          {
            id: 'duel-02',
            speaker: 'Nicholas Johnson',
            text: 'The others are just noise.',
            duration: 3400,
            tone: 'cold',
            voice: '/audio/vo/nicholas_final_duel_02.mp3',
          },
          {
            id: 'duel-03',
            speaker: 'The Chronicler',
            text: 'Let the last survivors settle it.',
            duration: 3400,
            tone: 'mystic',
            voice: '/audio/vo/final_duel_chronicler_01.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'ravens_dragons_final',
          text: 'Ravens vs Dragons (PvP — winner advances)',
          result: 'battle',
          nextNodeId: 'confession',
          versus: ['ravens', 'dragons'],

          cutscene: {
            id: 'final-duel-ravens-dragons',
            lines: [
              {
                id: 'frd-01',
                speaker: 'Ravens Captain',
                text: 'This is where it ends.',
                duration: 3400,
                tone: 'serious',
                voice: '/audio/vo/final_duel_ravens_01.mp3',
              },
              {
                id: 'frd-02',
                speaker: 'Dragons Captain',
                text: 'For one of us.',
                duration: 3000,
                tone: 'serious',
                voice: '/audio/vo/final_duel_dragons_01.mp3',
              },
            ],
          },

          onBattle: {
            id: 'final-duel-ravens-dragons-battle',
            lines: [
              {
                id: 'frd-battle',
                speaker: 'The Chronicler',
                text: 'The chamber becomes a tomb.',
                duration: 3500,
                tone: 'danger',
                voice: '/audio/vo/final_duel_battle_01.mp3',
              },
            ],
          },
        },
        {
          id: 'serpents_wolves_final',
          text: 'Serpents vs Wolves (PvP — winner advances)',
          result: 'battle',
          nextNodeId: 'confession',
          versus: ['serpents', 'wolves'],

          cutscene: {
            id: 'final-duel-serpents-wolves',
            lines: [
              {
                id: 'fsw-01',
                speaker: 'Serpents Captain',
                text: 'Only one house walks away.',
                duration: 3400,
                tone: 'serious',
                voice: '/audio/vo/final_duel_serpents_01.mp3',
              },
              {
                id: 'fsw-02',
                speaker: 'Wolves Captain',
                text: 'Then let it be mine.',
                duration: 3000,
                tone: 'serious',
                voice: '/audio/vo/final_duel_wolves_01.mp3',
              },
            ],
          },

          onBattle: {
            id: 'final-duel-serpents-wolves-battle',
            lines: [
              {
                id: 'fsw-battle',
                speaker: 'The Chronicler',
                text: 'Steel rings out under the mountain.',
                duration: 3500,
                tone: 'danger',
                voice: '/audio/vo/final_duel_battle_02.mp3',
              },
            ],
          },
        },
        {
          id: 'refuse_duel',
          text: 'Refuse the duel',
          result: 'safe',
          nextNodeId: 'confession',
        },
      ],
    },

    /* ================================================================ */
    /* ACT IV — THE CONFESSION AND THE ASCENT                           */
    /* ================================================================ */

    confession: {
      id: 'confession',
      title: 'THE CONFESSION',
      text:
        'Nicholas finally appears. ' +
        'There is no throne. ' +
        'No armor. ' +
        'Only a tired man standing beside a machine that should never have existed.',
      background: '/images/sanctum.jpg',

      onEnter: {
        id: 'nicholas-confession',
        once: true,
        lines: [
          {
            id: 'confession-01',
            speaker: 'Nicholas Johnson',
            text: 'Do you want to know why I did it?',
            duration: 3500,
            tone: 'quiet',
            voice: '/audio/vo/nicholas_confession_01.mp3',
          },
          {
            id: 'confession-02',
            speaker: 'Nicholas Johnson',
            text: 'Because the first time I tried to save everyone...',
            duration: 3900,
            tone: 'sad',
            voice: '/audio/vo/nicholas_confession_02.mp3',
          },
          {
            id: 'confession-03',
            speaker: 'Nicholas Johnson',
            text: 'everyone died.',
            duration: 3000,
            tone: 'broken',
            voice: '/audio/vo/nicholas_confession_03.mp3',
          },
          {
            id: 'confession-04',
            speaker: 'Nicholas Johnson',
            text: 'So I built a world where death could be reversed.',
            duration: 4200,
            tone: 'regret',
            voice: '/audio/vo/nicholas_confession_04.mp3',
          },
          {
            id: 'confession-05',
            speaker: 'Nicholas Johnson',
            text: 'Then I discovered something terrible.',
            duration: 3500,
            tone: 'dark',
            voice: '/audio/vo/nicholas_confession_05.mp3',
          },
          {
            id: 'confession-06',
            speaker: 'Nicholas Johnson',
            text: 'People only become precious when they know they can lose them.',
            duration: 4700,
            tone: 'philosophical',
            voice: '/audio/vo/nicholas_confession_06.mp3',
          },
          {
            id: 'confession-07',
            speaker: 'Nicholas Johnson',
            text: 'So I gave them something to lose.',
            duration: 3400,
            tone: 'dark',
            voice: '/audio/vo/nicholas_confession_07.mp3',
          },
          {
            id: 'confession-08',
            speaker: 'Nicholas Johnson',
            text: 'You.',
            duration: 2500,
            tone: 'whisper',
            voice: '/audio/vo/nicholas_confession_08.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'forgive_nicholas',
          text: 'Ask him to stop',
          result: 'safe',
          nextNodeId: 'betrayal',
        },
        {
          id: 'condemn_nicholas',
          text: 'Condemn him',
          result: 'safe',
          nextNodeId: 'betrayal',
        },
        {
          id: 'study_machine',
          text: 'Study the machine',
          result: 'random',
          nextNodeId: 'betrayal',
        },
      ],
    },

    betrayal: {
      id: 'betrayal',
      title: 'THE BETRAYAL',
      text:
        'Nicholas lowers his weapon. ' +
        'For the first time, he appears afraid. ' +
        'But his eyes are not afraid. ' +
        'His eyes are hungry.',
      background: '/images/sanctum.jpg',

      onEnter: {
        id: 'nicholas-betrayal',
        once: true,
        lines: [
          {
            id: 'betrayal-01',
            speaker: 'Nicholas Johnson',
            text: 'You think I want to kill you?',
            duration: 3400,
            tone: 'hurt',
            voice: '/audio/vo/nicholas_betrayal_01.mp3',
          },
          {
            id: 'betrayal-02',
            speaker: 'Nicholas Johnson',
            text: 'I have killed you more times than you could ever remember.',
            duration: 4400,
            tone: 'confession',
            voice: '/audio/vo/nicholas_betrayal_02.mp3',
          },
          {
            id: 'betrayal-03',
            speaker: 'Nicholas Johnson',
            text: 'And every time... I hated myself a little more.',
            duration: 4300,
            tone: 'broken',
            voice: '/audio/vo/nicholas_betrayal_03.mp3',
          },
          {
            id: 'betrayal-04',
            speaker: 'Nicholas Johnson',
            text: 'But tonight is different.',
            duration: 3300,
            tone: 'serious',
            voice: '/audio/vo/nicholas_betrayal_04.mp3',
          },
          {
            id: 'betrayal-05',
            speaker: 'Nicholas Johnson',
            text: 'Tonight, one of you will remember everything.',
            duration: 4300,
            tone: 'ominous',
            voice: '/audio/vo/nicholas_betrayal_05.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'trust_him',
          text: 'Trust Nicholas',
          result: 'safe',
          nextNodeId: 'betrayal_end',
        },
        {
          id: 'refuse_trust',
          text: 'Refuse to trust him',
          result: 'safe',
          nextNodeId: 'betrayal_end',
        },
        {
          id: 'question_him',
          text: 'Question his motives',
          result: 'random',
          nextNodeId: 'betrayal_end',
        },
      ],
    },

    betrayal_end: {
      id: 'betrayal_end',
      title: 'THE PRICE OF TRUST',
      text:
        'Someone steps forward. ' +
        'The machine recognizes the choice. ' +
        'The entire mountain begins to shake. ' +
        'And somewhere far below, something begins to laugh.',
      background: '/images/sanctum.jpg',

      onEnter: {
        id: 'betrayal-end',
        once: true,
        lines: [
          {
            id: 'betrayal-end-01',
            speaker: 'Nicholas Johnson',
            text: 'Thank you.',
            duration: 2700,
            tone: 'sincere',
            voice: '/audio/vo/nicholas_betrayal_end_01.mp3',
          },
          {
            id: 'betrayal-end-02',
            speaker: 'Nicholas Johnson',
            text: 'I needed someone to trust me.',
            duration: 3500,
            tone: 'emotional',
            voice: '/audio/vo/nicholas_betrayal_end_02.mp3',
          },
          {
            id: 'betrayal-end-03',
            speaker: 'Nicholas Johnson',
            text: 'The machine only opens for a willing heart.',
            duration: 4100,
            tone: 'dark',
            voice: '/audio/vo/nicholas_betrayal_end_03.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'enter_sanctum',
          text: 'Enter the inner sanctum',
          result: 'safe',
          nextNodeId: 'sanctum',
        },
      ],
    },

    sanctum: {
      id: 'sanctum',
      title: 'THE SANCTUM',
      text:
        'Thousands of memories float inside transparent chambers. ' +
        'People you met. People you lost. People you cannot remember. ' +
        'In every single chamber, the face is the same. ' +
        'It is your face. ' +
        'Every soul Nicholas ever trapped looks exactly like you.',
      background: '/images/sanctum.jpg',

      onEnter: {
        id: 'nicholas-sanctum',
        once: true,
        lines: [
          {
            id: 'sanctum-01',
            speaker: 'Nicholas Johnson',
            text: 'Look around you.',
            duration: 2800,
            tone: 'quiet',
            voice: '/audio/vo/nicholas_sanctum_01.mp3',
          },
          {
            id: 'sanctum-02',
            speaker: 'Nicholas Johnson',
            text: 'Every person you met here was real.',
            duration: 3700,
            tone: 'sad',
            voice: '/audio/vo/nicholas_sanctum_02.mp3',
          },
          {
            id: 'sanctum-03',
            speaker: 'Nicholas Johnson',
            text: 'Every person you lost was real.',
            duration: 3600,
            tone: 'tragic',
            voice: '/audio/vo/nicholas_sanctum_03.mp3',
          },
          {
            id: 'sanctum-04',
            speaker: 'Nicholas Johnson',
            text: 'And every person you forgot...',
            duration: 3400,
            tone: 'quiet',
            voice: '/audio/vo/nicholas_sanctum_04.mp3',
          },
          {
            id: 'sanctum-05',
            speaker: 'Nicholas Johnson',
            text: 'was erased by me.',
            duration: 3600,
            tone: 'dark',
            voice: '/audio/vo/nicholas_sanctum_05.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'confront_nicholas',
          text: 'Confront Nicholas (Boss)',
          result: 'battle',
          nextNodeId: 'nicholas_boss',
          enemyName: 'NICHOLAS JOHNSON',
          enemyHp: 1300,
          enemyMaxHp: 1300,
          enemyAttack: 35,
        },
        {
          id: 'destroy_memory',
          text: 'Destroy the memory system (Boss)',
          result: 'battle',
          nextNodeId: 'nicholas_boss',
          enemyName: 'NICHOLAS JOHNSON',
          enemyHp: 1300,
          enemyMaxHp: 1300,
          enemyAttack: 35,
        },
        {
          id: 'touch_memory',
          text: 'Touch the memory chambers',
          result: 'random',
          nextNodeId: 'nicholas_boss',
        },
      ],
    },

    nicholas_boss: {
      id: 'nicholas_boss',
      title: 'NICHOLAS JOHNSON',
      text:
        'The machine awakens. ' +
        'Nicholas stands at its center. ' +
        'The memories of every previous cycle begin screaming around him.',
      background: '/images/nicholas_boss.jpg',

      onEnter: {
        id: 'nicholas-boss-intro',
        once: true,
        lines: [
          {
            id: 'boss-01',
            speaker: 'Nicholas Johnson',
            text: 'You finally made it this far.',
            duration: 3500,
            tone: 'calm',
            voice: '/audio/vo/nicholas_final_01.mp3',
          },
          {
            id: 'boss-02',
            speaker: 'Nicholas Johnson',
            text: 'Do you know how many times I have watched you die?',
            duration: 5300,
            tone: 'dark',
            voice: '/audio/vo/nicholas_final_02.mp3',
          },
          {
            id: 'boss-03',
            speaker: 'Nicholas Johnson',
            text: 'Do you know how many times I have heard you scream?',
            duration: 5300,
            tone: 'dark',
            voice: '/audio/vo/nicholas_final_03.mp3',
          },
          {
            id: 'boss-04',
            speaker: 'Nicholas Johnson',
            text: 'You call me evil because I remember.',
            duration: 4900,
            tone: 'angry',
            voice: '/audio/vo/nicholas_final_04.mp3',
          },
          {
            id: 'boss-05',
            speaker: 'Nicholas Johnson',
            text: 'I call myself necessary.',
            duration: 3300,
            tone: 'cold',
            voice: '/audio/vo/nicholas_final_05.mp3',
          },
          {
            id: 'boss-06',
            speaker: 'Nicholas Johnson',
            text: 'Now prove me wrong.',
            duration: 3000,
            tone: 'aggressive',
            voice: '/audio/vo/nicholas_final_06.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'fight_nicholas_phase_one',
          text: 'Fight Nicholas (Boss)',
          result: 'battle',
          nextNodeId: 'final_choice',
          enemyName: 'NICHOLAS JOHNSON',
          enemyHp: 1500,
          enemyMaxHp: 1500,
          enemyAttack: 38,

          onBattle: {
            id: 'nicholas-phase-one',
            lines: [
              {
                id: 'phase-01',
                speaker: 'Nicholas Johnson',
                text: 'I wanted to save them.',
                duration: 4200,
                tone: 'sad',
                voice: '/audio/vo/nicholas_phase_one_01.mp3',
              },
              {
                id: 'phase-02',
                speaker: 'Nicholas Johnson',
                text: 'That is how every monster begins.',
                duration: 4900,
                tone: 'dark',
                voice: '/audio/vo/nicholas_phase_one_02.mp3',
              },
              {
                id: 'phase-03',
                speaker: 'Nicholas Johnson',
                text: 'With a reason.',
                duration: 2500,
                tone: 'quiet',
                voice: '/audio/vo/nicholas_phase_one_03.mp3',
              },
              {
                id: 'phase-04',
                speaker: 'Nicholas Johnson',
                text: 'With a promise.',
                duration: 2500,
                tone: 'quiet',
                voice: '/audio/vo/nicholas_phase_one_04.mp3',
              },
              {
                id: 'phase-05',
                speaker: 'Nicholas Johnson',
                text: 'And eventually...',
                duration: 2700,
                tone: 'dark',
                voice: '/audio/vo/nicholas_phase_one_05.mp3',
              },
              {
                id: 'phase-06',
                speaker: 'Nicholas Johnson',
                text: 'with an excuse.',
                duration: 3000,
                tone: 'dark',
                voice: '/audio/vo/nicholas_phase_one_06.mp3',
              },
              {
                id: 'phase-07',
                speaker: 'Nicholas Johnson',
                text: 'Then let us see what you remember.',
                duration: 4500,
                tone: 'aggressive',
                voice: '/audio/vo/nicholas_phase_battle_01.mp3',
              },
            ],
          },
        },
      ],
    },

    final_choice: {
      id: 'final_choice',
      title: 'THE LAST MEMORY',
      text:
        'Nicholas falls to his knees. ' +
        'The machine is collapsing. ' +
        'The Highlands is dying around you.',
      background: '/images/nicholas_boss.jpg',

      onEnter: {
        id: 'nicholas-final-choice',
        once: true,
        lines: [
          {
            id: 'choice-01',
            speaker: 'Nicholas Johnson',
            text: 'Wait...',
            duration: 2800,
            tone: 'desperate',
            voice: '/audio/vo/nicholas_final_choice_01.mp3',
          },
          {
            id: 'choice-02',
            speaker: 'Nicholas Johnson',
            text: 'If you destroy this place...',
            duration: 4500,
            tone: 'desperate',
            voice: '/audio/vo/nicholas_final_choice_02.mp3',
          },
          {
            id: 'choice-03',
            speaker: 'Nicholas Johnson',
            text: 'all the memories disappear with it.',
            duration: 4900,
            tone: 'sad',
            voice: '/audio/vo/nicholas_final_choice_03.mp3',
          },
          {
            id: 'choice-04',
            speaker: 'Nicholas Johnson',
            text: 'Everyone I saved will die.',
            duration: 4500,
            tone: 'tragic',
            voice: '/audio/vo/nicholas_final_choice_04.mp3',
          },
          {
            id: 'choice-05',
            speaker: 'Nicholas Johnson',
            text: 'Everyone I killed will finally be free.',
            duration: 4900,
            tone: 'tragic',
            voice: '/audio/vo/nicholas_final_choice_05.mp3',
          },
          {
            id: 'choice-06',
            speaker: 'Nicholas Johnson',
            text: 'And you...',
            duration: 2600,
            tone: 'emotional',
            voice: '/audio/vo/nicholas_final_choice_06.mp3',
          },
          {
            id: 'choice-07',
            speaker: 'Nicholas Johnson',
            text: 'you will forget me.',
            duration: 3900,
            tone: 'broken',
            voice: '/audio/vo/nicholas_final_choice_07.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'destroy_highlands',
          text: 'Destroy the Highlands (Final Boss)',
          result: 'battle',
          nextNodeId: 'ending_destroy',
          enemyName: 'NICHOLAS JOHNSON — FINAL FORM',
          enemyHp: 2000,
          enemyMaxHp: 2000,
          enemyAttack: 42,

          onBattle: {
            id: 'nicholas-final-form',
            lines: [
              {
                id: 'final-form-01',
                speaker: 'Nicholas Johnson',
                text: 'Then let the Highlands remember you.',
                duration: 4700,
                tone: 'furious',
                voice: '/audio/vo/nicholas_final_form_01.mp3',
              },
              {
                id: 'final-form-02',
                speaker: 'Nicholas Johnson',
                text: 'Because I will not die alone.',
                duration: 4600,
                tone: 'furious',
                voice: '/audio/vo/nicholas_final_form_02.mp3',
              },
              {
                id: 'final-form-03',
                speaker: 'Nicholas Johnson',
                text: 'I will take this entire world with me.',
                duration: 4900,
                tone: 'rage',
                voice: '/audio/vo/nicholas_final_form_03.mp3',
              },
            ],
          },
        },
        {
          id: 'preserve_memories',
          text: 'Preserve the memories',
          result: 'safe',
          nextNodeId: 'ending_destroy',
        },
        {
          id: 'remember_nicholas',
          text: 'Remember Nicholas',
          result: 'safe',
          nextNodeId: 'ending_destroy',
        },
      ],
    },

    ending_destroy: {
      id: 'ending_destroy',
      title: 'THE END OF THE HIGHLANDS',
      text:
        'The machine collapses. ' +
        'The mountain begins to fall. ' +
        'Every memory stored inside the Highlands disappears. ' +
        'Every soul. Every clone. Every version of you. ' +
        'The four teams. The villagers. The children. ' +
        'All of them were Nicholas. ' +
        'All of them were you. ' +
        'And you have just killed every single one.',
      background: '/images/gate.jpg',

      onEnter: {
        id: 'destroy-ending',
        once: true,
        lines: [
          {
            id: 'destroy-01',
            speaker: 'Nicholas Johnson',
            text: 'You chose death over forgetting.',
            duration: 4800,
            tone: 'exhausted',
            voice: '/audio/vo/nicholas_ending_destroy_01.mp3',
          },
          {
            id: 'destroy-02',
            speaker: 'Nicholas Johnson',
            text: 'Perhaps... you were stronger than I was.',
            duration: 4200,
            tone: 'accepting',
            voice: '/audio/vo/nicholas_ending_destroy_02.mp3',
          },
          {
            id: 'destroy-03',
            speaker: 'Nicholas Johnson',
            text: 'Goodbye.',
            duration: 3200,
            tone: 'exhausted',
            voice: '/audio/vo/nicholas_ending_destroy_03.mp3',
          },
        ],
      },

      choices: [
        {
          id: 'finish',
          text: 'Finish',
          result: 'credits',
        },
      ],
    },

    /* ================================================================ */
    /* LEGACY ENDINGS — kept for audio refs, not reachable from start   */
    /* ================================================================ */

    ending_memory: {
      id: 'ending_memory',
      title: 'THE MEMORY REMAINS',
      text: 'The machine survives. The memories remain. But Nicholas is gone.',
      background: '/images/sanctum.jpg',
      onEnter: {
        id: 'memory-ending',
        once: true,
        lines: [
          {
            id: 'memory-ending-01',
            speaker: 'Nicholas Johnson',
            text: 'Perhaps memories are more dangerous than death.',
            duration: 4900,
            tone: 'sad',
            voice: '/audio/vo/nicholas_ending_memory_01.mp3',
          },
          {
            id: 'memory-ending-02',
            speaker: 'Nicholas Johnson',
            text: 'Take care of them.',
            duration: 3000,
            tone: 'gentle',
            voice: '/audio/vo/nicholas_ending_memory_02.mp3',
          },
        ],
      },
      choices: [],
    },

    ending_nicholas: {
      id: 'ending_nicholas',
      title: 'THE MAN WHO REMEMBERED',
      text:
        'You choose not to destroy the memories. ' +
        'Instead, you allow Nicholas to finally let them go. ' +
        'For the first time, the Highlands becomes silent.',
      background: '/images/sanctum.jpg',
      onEnter: {
        id: 'true-ending',
        once: true,
        lines: [
          {
            id: 'true-01',
            speaker: 'Nicholas Johnson',
            text: 'I spent my entire life trying to make sure nobody was forgotten.',
            duration: 5800,
            tone: 'emotional',
            voice: '/audio/vo/nicholas_true_ending_01.mp3',
          },
          {
            id: 'true-02',
            speaker: 'Nicholas Johnson',
            text: 'And somehow...',
            duration: 3000,
            tone: 'sad',
            voice: '/audio/vo/nicholas_true_ending_02.mp3',
          },
          {
            id: 'true-03',
            speaker: 'Nicholas Johnson',
            text: 'I became the reason they could never move on.',
            duration: 4900,
            tone: 'broken',
            voice: '/audio/vo/nicholas_true_ending_03.mp3',
          },
          {
            id: 'true-04',
            speaker: 'Nicholas Johnson',
            text: 'Do not remember me as a hero.',
            duration: 3800,
            tone: 'quiet',
            voice: '/audio/vo/nicholas_true_ending_04.mp3',
          },
          {
            id: 'true-05',
            speaker: 'Nicholas Johnson',
            text: 'Heroes know when to stop.',
            duration: 3500,
            tone: 'reflective',
            voice: '/audio/vo/nicholas_true_ending_05.mp3',
          },
          {
            id: 'true-06',
            speaker: 'Nicholas Johnson',
            text: 'I never did.',
            duration: 3300,
            tone: 'tragic',
            voice: '/audio/vo/nicholas_true_ending_06.mp3',
          },
        ],
      },
      choices: [],
    },

    /* ================================================================ */
    /* LEGACY SIDE NODES — kept for audio refs                          */
    /* ================================================================ */

    tower: {
      id: 'tower',
      title: 'THE WATCHTOWER',
      text: 'A ruined tower rises above the forest. Lightning reveals something watching from below.',
      background: '/images/tower.jpg',
      choices: [
        {
          id: 'climb',
          text: 'Climb the tower',
          result: 'safe',
          nextNodeId: 'graveyard',
        },
      ],
    },

    forest_clearing: {
      id: 'forest_clearing',
      title: 'THE FOREST CLEARING',
      text: 'The trees close behind you. Something enormous moves between them, and then stops.',
      background: '/images/forest.jpg',
      choices: [
        {
          id: 'press_on',
          text: 'Press onward',
          result: 'safe',
          nextNodeId: 'graveyard',
        },
      ],
    },

    crypt: {
      id: 'crypt',
      title: 'THE CRYPT',
      text: 'The floor collapses beneath the team. You hear something breathing in the darkness.',
      background: '/images/crypt.jpg',
      choices: [
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
      text: 'Bones line every wall. A single skull turns to watch you. It does not attack. Yet.',
      background: '/images/crypt.jpg',
      choices: [
        {
          id: 'back_away',
          text: 'Back away slowly',
          result: 'safe',
          nextNodeId: 'tower',
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
  ): { choice: StoryChoice; node?: StoryNode } | null {
    const currentNode = this.getNode(game.currentNodeId);
    if (!currentNode) return null;

    const choice = currentNode.choices.find((item) => item.id === choiceId);
    if (!choice) return null;

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
