import { encode, decode } from '@msgpack/msgpack';

// ─── Message Types ───────────────────────────────────────────────

/** Client → Server message types */
export type ClientMessage =
  | { type: 'join'; payload: { displayName: string } }
  | { type: 'state'; payload: PlayerState }
  | { type: 'chat'; payload: { message: string } };

/** Server → Client message types */
export type ServerMessage =
  | { type: 'snapshot'; payload: { players: Record<string, PlayerState & { displayName: string }>; timestamp: number } }
  | { type: 'player_joined'; payload: { id: string; displayName: string } }
  | { type: 'player_left'; payload: { id: string } }
  | { type: 'chat'; payload: { id: string; message: string } }
  | { type: 'error'; payload: { code: string; message: string } };

/** Player state transmitted each tick */
export interface PlayerState {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  action: string;
  timestamp?: number;
}

// ─── Encode / Decode ─────────────────────────────────────────────

/**
 * Encode a server message to a binary msgpack buffer.
 * ~40% smaller than JSON for typical game state payloads.
 */
export function encodeMessage(msg: ServerMessage): Uint8Array {
  return encode(msg);
}

/**
 * Decode binary msgpack data from a client into a typed message.
 * Returns null if the data is malformed.
 */
export function decodeMessage(data: Buffer | ArrayBuffer | Uint8Array): ClientMessage | null {
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const msg = decode(bytes) as ClientMessage;
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return null;
    return msg;
  } catch {
    return null;
  }
}

// ─── Error Codes ─────────────────────────────────────────────────

export const ErrorCodes = {
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_FULL: 'ROOM_FULL',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  NOT_JOINED: 'NOT_JOINED',
} as const;
