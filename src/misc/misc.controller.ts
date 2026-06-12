import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { MiscService } from './misc.service';
import { CreateMiscDto } from './dto/create-misc.dto';
import { UpdateMiscDto } from './dto/update-misc.dto';

@Controller('misc')
export class MiscController {
  constructor(private readonly miscService: MiscService) {}

  @Post('/api/create')
  async create(@Body() createMiscDto: CreateMiscDto) {
    return await this.miscService.create(createMiscDto);
  }

  @Get('/api/all')
  async findAll() {
    return await this.miscService.findAll();
  }

  @Get('/api/:id')
  async findOne(@Param('id') id: string) {
    return await this.miscService.findOne(+id);
  }

  @Patch('/api/:id')
  async update(@Param('id') id: string, @Body() updateMiscDto: UpdateMiscDto) {
    return await this.miscService.update(+id, updateMiscDto);
  }

  @Delete('/api/:id')
  async remove(@Param('id') id: string) {
    return await this.miscService.remove(+id);
  }
  @Post('/api/validate-key/:id')
  async checkIfValid(@Param('id') id: string, @Body('key') key: string) {
    return await this.miscService.checkIfValid(+id, key);
  }
}
