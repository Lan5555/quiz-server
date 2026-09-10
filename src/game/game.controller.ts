import { Body, Controller, Get, Post } from '@nestjs/common';

import { StoryEngine } from './engines/story.engine';

@Controller('game')
export class GameController {
  constructor(private readonly storyEngine: StoryEngine) {}

  /**
   * Static story content is loaded once by the frontend. During play, the
   * websocket state identifies the active entry with `currentNodeId`.
   */
  @Get('api/story')
  getStory() {
    return {
      success: true,
      message: 'Story content loaded successfully',
      data: {
        initialNodeId: this.storyEngine.getInitialNode().id,
        nodes: this.storyEngine.getStory(),
      },
    };
  }
  @Post('import')
  importStory(@Body() body: { nodes: Record<string, unknown> }) {
    this.storyEngine.replaceNodes(body.nodes);
    return { ok: true };
  }
}
