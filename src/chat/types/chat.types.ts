export interface Room {
  id: string;
  name: string;
  isGroup: boolean;
  memberIds: string[];
  code?: string; // ✅ ADDED - Join code
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  attachments?: string[];
  createdAt: string;
  status: 'sent' | 'delivered' | 'read';
  clientId?: string;
}

export interface RoomMember {
  id: string;
  name: string;
  online: boolean;
}
