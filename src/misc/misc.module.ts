import { Module } from '@nestjs/common';
import { MiscService } from './misc.service';
import { MiscController } from './misc.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Misc } from './entities/misc.entity';
import { User } from 'src/entities/entity';

@Module({
  imports: [TypeOrmModule.forFeature([Misc, User])],
  controllers: [MiscController],
  providers: [MiscService],
  exports: [MiscService],
})
export class MiscModule {}
