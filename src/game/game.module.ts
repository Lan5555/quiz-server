import { Module } from '@nestjs/common';

import { GameGateway } from './game.gateway';
import { GameController } from './game.controller';
import { GameStore } from './game.store';

import { StoryEngine } from './engines/story.engine';
import { CombatEngine } from './engines/combat.engine';
import { GameAccountController } from './accounts/game-account.controller';
import { GameAccountsService } from './accounts/game-accounts.service';
import { ProgressionService } from './progression/progression.service';
import { GameCheckoutModule } from './payments/game-checkout.module';
import {
  GameAdminController,
  GameModeratorGuard,
} from './admin/game-admin.controller';
import { GameAdminService } from './admin/game-admin.service';

@Module({
  imports: [GameCheckoutModule],
  controllers: [GameController, GameAccountController, GameAdminController],

  providers: [
    GameGateway,
    GameStore,
    StoryEngine,
    CombatEngine,
    GameAccountsService,
    ProgressionService,
    GameAdminService,
    GameModeratorGuard,
  ],

  exports: [GameStore, StoryEngine, CombatEngine],
})
export class GameModule {}
