/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import {
  CreateRoomDto,
  JoinRoomDto,
  ReadReceiptDto,
  SendMessageDto,
  TypingDto,
} from './dto/chat.dto';

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: process.env.CLIENT_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
})
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private pingIntervals = new Map<string, NodeJS.Timeout>();
  private userSockets = new Map<string, Set<string>>(); // userId -> Set of socket ids

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token');

      const payload = await this.jwtService.verifyAsync(token);
      const userId = payload.sub;

      client.data.userId = userId;
      client.data.name = payload.name;

      // Track user sockets
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)?.add(client.id);

      // Send connected event
      client.emit('connected', { userId });

      // Send user's rooms immediately on connection
      const userRooms = this.chatService.getUserRooms(userId);
      client.emit('rooms:list', {
        rooms: userRooms,
      });

      // Set user online and broadcast presence
      this.chatService.setOnline(userId);
      this.server.emit('presence:update', {
        userId,
        online: true,
      });

      // Setup ping/pong heartbeat
      const pingInterval = setInterval(() => {
        if (client.connected) {
          client.emit('ping');
        } else {
          clearInterval(pingInterval);
          this.pingIntervals.delete(client.id);
        }
      }, 25000);
      this.pingIntervals.set(client.id, pingInterval);

      client.on('pong', () => {
        // Client responded - connection is alive
      });

      this.logger.log(`Client connected: ${userId} (${client.id})`);
    } catch (err) {
      this.logger.warn(`Rejected connection: ${(err as Error).message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (!userId) return;

    // Remove socket from tracking
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.delete(client.id);
      if (userSockets.size === 0) {
        this.userSockets.delete(userId);
        // Only set offline if no more sockets for this user
        this.chatService.setOffline(userId);
        this.server.emit('presence:update', { userId, online: false });
      }
    }

    // Clean up ping interval
    const pingInterval = this.pingIntervals.get(client.id);
    if (pingInterval) {
      clearInterval(pingInterval);
      this.pingIntervals.delete(client.id);
    }

    this.logger.log(`Client disconnected: ${userId} (${client.id})`);
  }

  // ✅ CREATE ROOM WITH CODE
  @SubscribeMessage('room:create')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: CreateRoomDto,
  ) {
    const userId = client.data.userId;

    // Ensure current user is in member list
    if (!dto.memberIds.includes(userId)) {
      dto.memberIds.push(userId);
    }

    this.logger.log(`Creating room with members: ${dto.memberIds.join(', ')}`);

    const room = this.chatService.createRoom({
      name: dto.name,
      isGroup: dto.isGroup ?? false,
      memberIds: dto.memberIds,
    });

    // Join the creator to the room
    void client.join(room.id);

    // Send room creation to ALL members
    dto.memberIds.forEach((memberId) => {
      const roomForUser = {
        ...room,
        memberIds: room.memberIds.filter((id) => id !== memberId),
      };

      // Send to each member by their userId
      this.server.to(memberId).emit('room:created', {
        room: roomForUser,
      });

      this.logger.log(`Sent room:created to ${memberId}`);
    });

    // Send room history to the creator
    client.emit('room:history', {
      roomId: room.id,
      roomName: room.name,
      messages: [],
      members: this.chatService.membersOf(room.id),
    });

    this.logger.log(
      `Room created: ${room.id} with code: ${room.code} by ${userId}`,
    );

    return { success: true, data: room };
  }

  // ✅ JOIN ROOM BY CODE
  @SubscribeMessage('room:join-by-code')
  handleJoinByCode(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { code: string },
  ) {
    const userId = client.data.userId;
    this.logger.log(
      `User ${userId} attempting to join room with code: ${data.code}`,
    );

    const room = this.chatService.getRoomByCode(data.code.toUpperCase());

    if (!room) {
      this.logger.warn(`Room not found with code: ${data.code}`);
      client.emit('error', { message: 'Room not found with this code' });
      return;
    }

    // Check if user is already a member
    if (this.chatService.isMember(room.id, userId)) {
      this.logger.log(`User ${userId} is already a member of room ${room.id}`);
      client.emit('error', { message: 'You are already in this room' });
      return;
    }

    // Add user to room
    const added = this.chatService.addUserToRoom(room.id, userId);
    if (!added) {
      client.emit('error', { message: 'Could not join room' });
      return;
    }

    // Join the room
    void client.join(room.id);

    // Send room history to the user
    client.emit('room:history', {
      roomId: room.id,
      roomName: room.name,
      messages: this.chatService.getHistory(room.id),
      members: this.chatService.membersOf(room.id),
    });

    // Notify all existing members about the new user
    const updatedMembers = this.chatService.membersOf(room.id);
    room.memberIds.forEach((memberId) => {
      this.server.to(memberId).emit('room:member-joined', {
        roomId: room.id,
        userId: userId,
        members: updatedMembers,
      });
    });

    // Send the room to the joining user
    const roomForUser = {
      ...room,
      memberIds: room.memberIds.filter((id) => id !== userId),
    };
    client.emit('room:created', {
      room: roomForUser,
    });

    this.logger.log(
      `User ${userId} joined room ${room.id} via code ${data.code}`,
    );
    return { success: true, room };
  }

  @SubscribeMessage('room:join')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: JoinRoomDto,
  ) {
    const userId = client.data.userId;
    if (!this.chatService.isMember(dto.roomId, userId)) {
      client.emit('error', { message: 'Not a member of this room' });
      return;
    }

    void client.join(dto.roomId);

    const room = this.chatService.getRoom(dto.roomId);

    client.emit('room:history', {
      roomId: dto.roomId,
      roomName: room?.name,
      messages: this.chatService.getHistory(dto.roomId),
      members: this.chatService.membersOf(dto.roomId),
    });

    this.logger.log(`User ${userId} joined room ${dto.roomId}`);
  }

  @SubscribeMessage('room:leave')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: JoinRoomDto,
  ) {
    void client.leave(dto.roomId);
    this.logger.log(`User ${client.data.userId} left room ${dto.roomId}`);
  }

  @SubscribeMessage('message:send')
  handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SendMessageDto,
  ) {
    const userId = client.data.userId;
    if (!this.chatService.isMember(dto.roomId, userId)) {
      client.emit('error', { message: 'Not a member of this room' });
      return;
    }

    const message = this.chatService.saveMessage({
      roomId: dto.roomId,
      senderId: userId,
      content: dto.content,
      attachments: dto.attachments,
      clientId: dto.clientId,
    });

    // Broadcast to everyone in the room
    this.server.to(dto.roomId).emit('message:new', {
      ...message,
      clientId: dto.clientId,
    });

    // Send delivered status to sender
    client.emit('message:status', {
      messageId: message.id,
      status: 'delivered',
    });

    // Update and broadcast status to room after a small delay
    setTimeout(() => {
      const delivered = this.chatService.updateStatus(
        dto.roomId,
        message.id,
        'delivered',
      );
      if (delivered) {
        this.server.to(dto.roomId).emit('message:status', {
          messageId: message.id,
          status: 'delivered',
        });
      }
    }, 100);

    this.logger.log(`Message sent in room ${dto.roomId} by ${userId}`);
  }

  @SubscribeMessage('typing:start')
  handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: TypingDto,
  ) {
    client.to(dto.roomId).emit('typing:update', {
      roomId: dto.roomId,
      userId: client.data.userId,
      isTyping: true,
    });
  }

  @SubscribeMessage('typing:stop')
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: TypingDto,
  ) {
    client.to(dto.roomId).emit('typing:update', {
      roomId: dto.roomId,
      userId: client.data.userId,
      isTyping: false,
    });
  }

  @SubscribeMessage('message:read')
  handleMessageRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ReadReceiptDto,
  ) {
    const updatedIds = this.chatService.markAllReadExcept(
      dto.roomId,
      client.data.userId,
    );
    if (updatedIds.length) {
      this.server.to(dto.roomId).emit('message:status:bulk', {
        roomId: dto.roomId,
        messageIds: updatedIds,
        status: 'read',
      });
    }
  }

  // ✅ GET ROOM CODE (for sharing)
  @SubscribeMessage('room:get-code')
  handleGetRoomCode(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const userId = client.data.userId;
    const room = this.chatService.getRoom(data.roomId);

    if (!room) {
      client.emit('error', { message: 'Room not found' });
      return;
    }

    if (!this.chatService.isMember(room.id, userId)) {
      client.emit('error', { message: 'Not a member of this room' });
      return;
    }

    client.emit('room:code', {
      roomId: room.id,
      code: room.code,
    });
  }
}
