import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { GameGearService } from './gear.service';
import { GameGearDto } from './dto/game_gear.dto';

@Controller('game-gear')
export class GameGearController {
  constructor(private readonly gameGearService: GameGearService) {}
  @Post('/create-gear')
  async createGear(@Body() gear: GameGearDto) {
    return this.gameGearService.createGear(gear);
  }
  @Get('/fetch-all-gear')
  async findAllGear() {
    return this.gameGearService.fetchAllGear();
  }
  @Patch('/update-one-gear')
  async updateGear(@Query('id') id: string, @Body() gear: GameGearDto) {
    return await this.gameGearService.updateGear(id, gear);
  }
}
