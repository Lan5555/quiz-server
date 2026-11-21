import { Module } from '@nestjs/common';
import { GameGearService } from './gear.service';
import { GameGearController } from './gear.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameGear } from './entities/game_gear.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GameGear])],
  controllers: [GameGearController],
  providers: [GameGearService],
  exports: [GameGearService],
})
export class GameGearModule {}
