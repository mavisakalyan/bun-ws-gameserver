import { encode, decode } from '@msgpack/msgpack';

// ─── Server → Client Messages ─────────────────────────────────────

export type WelcomeMessage = {
  type: 'welcome';
  playerId: string;
  peers: string[];
};

export type PeerJoinedMessage = {
  type: 'peer_joined';
  peerId: string;
};

export type PeerLeftMessage = {
  type: 'peer_left';
  peerId: string;
};

export type RelayMessage = {
  type: 'relay';
  from: string;
  data: unknown;
};

export type PongMessage = {
  type: 'pong';
  nonce: string;
  serverTime: number;
};

export type ErrorMessage = {
  type: 'error';
  code: string;
  message: string;
};

export type ServerMessage =
  | WelcomeMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | RelayMessage
  | PongMessage
  | ErrorMessage;

// ─── Client → Server Messages ─────────────────────────────────────

export type PingMessage = {
  type: 'ping';
  nonce: string;
};

// Anything else the client sends is treated as game data and relayed.

// ─── Encode / Decode ──────────────────────────────────────────────

/**
 * Encode a server message to a binary msgpack buffer.
 */
export function encodeMessage(msg: ServerMessage): Uint8Array {
  return encode(msg);
}

/**
 * Decode binary msgpack data from a client.
 * Returns the decoded object, or null if malformed.
 */
export function decodeMessage(data: Buffer | ArrayBuffer | Uint8Array): Record<string, unknown> | null {
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const msg = decode(bytes);
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
    return msg as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Error Codes ──────────────────────────────────────────────────

export const ErrorCodes = {
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_FULL: 'ROOM_FULL',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
} as const;
