import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChatMessage, RoomMember, Room } from './types/chat.types';

@Injectable()
export class ChatService {
  private messages = new Map<string, ChatMessage[]>(); // roomId -> messages
  private onlineUsers = new Set<string>();
  private roomMembers = new Map<string, string[]>(); // roomId -> userIds
  private rooms = new Map<string, Room>(); // roomId -> room metadata
  private roomCodes = new Map<string, string>(); // code -> roomId

  // Generate a unique room code
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  createRoom(input: {
    name: string;
    isGroup: boolean;
    memberIds: string[];
  }): Room {
    const roomId = randomUUID();
    const code = this.generateRoomCode();

    const room: Room = {
      id: roomId,
      name: input.name,
      isGroup: input.isGroup,
      memberIds: input.memberIds,
      code: code,
    };
    this.rooms.set(roomId, room);
    this.roomMembers.set(roomId, input.memberIds);
    this.roomCodes.set(code, roomId);
    return room;
  }

  // Get room by code
  getRoomByCode(code: string): Room | undefined {
    const roomId = this.roomCodes.get(code.toUpperCase());
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  // Add user to room
  addUserToRoom(roomId: string, userId: string): boolean {
    const members = this.roomMembers.get(roomId);
    if (!members) return false;
    if (members.includes(userId)) return true;
    members.push(userId);
    this.roomMembers.set(roomId, members);

    // Update room metadata
    const room = this.rooms.get(roomId);
    if (room) {
      room.memberIds = members;
      this.rooms.set(roomId, room);
    }
    return true;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getUserRooms(userId: string): Room[] {
    const userRooms: Room[] = [];
    for (const [roomId, memberIds] of this.roomMembers) {
      if (memberIds.includes(userId)) {
        const room = this.rooms.get(roomId);
        if (room) {
          userRooms.push({
            ...room,
            memberIds: room.memberIds.filter((id) => id !== userId),
          });
        }
      }
    }
    return userRooms;
  }

  getRoomMembers(roomId: string, currentUserId?: string): RoomMember[] {
    const memberIds = this.roomMembers.get(roomId) ?? [];
    return memberIds
      .filter((id) => id !== currentUserId)
      .map((id) => ({
        id,
        name: id,
        online: this.isOnline(id),
      }));
  }

  registerRoomMembers(roomId: string, userIds: string[]) {
    this.roomMembers.set(roomId, userIds);
  }

  isMember(roomId: string, userId: string): boolean {
    return this.roomMembers.get(roomId)?.includes(userId) ?? false;
  }

  getHistory(roomId: string, limit = 50): ChatMessage[] {
    const all = this.messages.get(roomId) ?? [];
    return all.slice(-limit);
  }

  saveMessage(input: {
    roomId: string;
    senderId: string;
    content: string;
    attachments?: string[];
    clientId?: string;
  }): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      roomId: input.roomId,
      senderId: input.senderId,
      content: input.content,
      attachments: input.attachments,
      createdAt: new Date().toISOString(),
      status: 'sent',
      clientId: input.clientId,
    };
    const existing = this.messages.get(input.roomId) ?? [];
    existing.push(message);
    this.messages.set(input.roomId, existing);
    return message;
  }

  updateStatus(
    roomId: string,
    messageId: string,
    status: ChatMessage['status'],
  ) {
    const list = this.messages.get(roomId) ?? [];
    const msg = list.find((m) => m.id === messageId);
    if (msg) msg.status = status;
    return msg;
  }

  markAllReadExcept(roomId: string, readerId: string): string[] {
    const list = this.messages.get(roomId) ?? [];
    const updatedIds: string[] = [];
    for (const m of list) {
      if (m.senderId !== readerId && m.status !== 'read') {
        m.status = 'read';
        updatedIds.push(m.id);
      }
    }
    return updatedIds;
  }

  setOnline(userId: string) {
    this.onlineUsers.add(userId);
  }

  setOffline(userId: string) {
    this.onlineUsers.delete(userId);
  }

  isOnline(userId: string) {
    return this.onlineUsers.has(userId);
  }

  membersOf(roomId: string): RoomMember[] {
    return (this.roomMembers.get(roomId) ?? []).map((id) => ({
      id,
      name: id,
      online: this.isOnline(id),
    }));
  }
}
