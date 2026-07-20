import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gatway';
import { RoomController } from './chat.controller';

@Module({
  controllers: [RoomController],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
