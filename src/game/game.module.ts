import { Module } from '@nestjs/common';

import { GameGateway } from './game.gateway';
import { GameController } from './game.controller';
import { GameStore } from './game.store';

import { StoryEngine } from './engines/story.engine';
import { CombatEngine } from './engines/combat.engine';

@Module({
  controllers: [GameController],

  providers: [GameGateway, GameStore, StoryEngine, CombatEngine],

  exports: [GameStore, StoryEngine, CombatEngine],
})
export class GameModule {}
