/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { CreateRoomDto } from './dto/chat.dto';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class RoomController {
  constructor(private readonly chatService: ChatService) {}

  @Post('/api/rooms')
  createRoom(@Body() dto: CreateRoomDto) {
    const room = this.chatService.createRoom({
      name: dto.name ?? 'Chat Room',
      isGroup: dto.isGroup ?? false,
      memberIds: dto.memberIds,
    });

    return {
      success: true,
      message: 'Room Created Successfully',
      data: room,
    };
  }

  @Get('/api/rooms/user/:userId')
  getUserRooms(@Param('userId') userId: string) {
    const rooms = this.chatService.getUserRooms(userId);
    return {
      success: true,
      data: rooms,
    };
  }

  @Get('/api/rooms/:roomId')
  getRoom(@Param('roomId') roomId: string) {
    const room = this.chatService.getRoom(roomId);
    if (!room) {
      return {
        success: false,
        message: 'Room not found',
      };
    }
    return {
      success: true,
      data: room,
    };
  }
}
