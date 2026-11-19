import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GameState, StoryChoice, StoryNode } from '../game.types';
import { HIGHLANDS_STORY } from '../story/highlands-v1';
import type { StoryDocument } from '../story/story-document';

@Injectable()
export class StoryEngine implements OnModuleInit {
  private story: StoryDocument = {
    initialNodeId: 'start',
    nodes: HIGHLANDS_STORY,
  };
  private readonly runs = new WeakMap<GameState, StoryDocument>();

  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    const rows = await this.db.query<
      { node_id: string; scene: StoryNode; initial_node_id: string }[]
    >(
      'SELECT n.node_id, n.scene, p.initial_node_id FROM game_story_nodes n CROSS JOIN game_story_publication p WHERE p.singleton',
    );
    const nodes = new Map(rows.map(({ node_id, scene }) => [node_id, scene]));
    const initialNodeId = rows[0]?.initial_node_id;
    if (!initialNodeId || !nodes.has(initialNodeId))
      throw new Error('Game story is missing its initial scene.');
    for (const [id, scene] of nodes) {
      if (
        scene.id !== id ||
        typeof scene.title !== 'string' ||
        typeof scene.text !== 'string' ||
        !Array.isArray(scene.choices) ||
        scene.choices.some(
          (choice) => choice.nextNodeId && !nodes.has(choice.nextNodeId),
        )
      ) {
        throw new Error(`Invalid game story scene: ${id}`);
      }
    }
    this.story = { initialNodeId, nodes: Object.fromEntries(nodes) };
  }

  startRun(game: GameState) {
    this.runs.set(game, this.story);
    game.currentNodeId = this.story.initialNodeId;
  }

  resetRun(game: GameState) {
    this.runs.delete(game);
    game.currentNodeId = this.story.initialNodeId;
  }

  getNode(nodeId: string, game?: GameState): StoryNode | undefined {
    const nodes = this.getStory(game);
    return Object.hasOwn(nodes, nodeId) ? nodes[nodeId] : undefined;
  }

  getInitialNode(): StoryNode {
    return this.story.nodes[this.story.initialNodeId];
  }

  getStory(game?: GameState): Readonly<Record<string, StoryNode>> {
    return (game ? (this.runs.get(game) ?? this.story) : this.story).nodes;
  }

  applyChoice(
    game: GameState,
    choiceId: string,
  ): { choice: StoryChoice; node?: StoryNode } | null {
    const currentNode = this.getNode(game.currentNodeId, game);
    if (!currentNode) return null;

    const choice = currentNode.choices.find((item) => item.id === choiceId);
    if (!choice) return null;

    const defers =
      choice.result === 'battle' ||
      choice.result === 'elimination' ||
      choice.result === 'random';

    if (choice.nextNodeId && !defers) {
      game.currentNodeId = choice.nextNodeId;
    }

    return {
      choice,
      node: choice.nextNodeId
        ? this.getNode(choice.nextNodeId, game)
        : undefined,
    };
  }
}
