import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connect(): GameSocket {
  return io({ transports: ['websocket', 'polling'] });
}
