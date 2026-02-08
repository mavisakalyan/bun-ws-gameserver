import { decodeMessage, encodeMessage, ErrorCodes } from './protocol';
import { Room } from './room';
import { RateLimiter } from './rate-limit';
import { getHealthResponse, getMetricsResponse } from './health';

// ─── Configuration ───────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 8080;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
const SNAPSHOT_HZ = Number(process.env.SNAPSHOT_HZ) || 20;
const KEEPALIVE_MS = Number(process.env.KEEPALIVE_MS) || 30000;
const MAX_MESSAGES_PER_SECOND = Number(process.env.MAX_MESSAGES_PER_SECOND) || 60;
const MAX_PLAYERS_PER_ROOM = Number(process.env.MAX_PLAYERS_PER_ROOM) || 50;

// ─── State ───────────────────────────────────────────────────────

const rooms = new Map<string, Room>();
const rateLimiter = new RateLimiter(MAX_MESSAGES_PER_SECOND);

/** Per-connection data stored in ws.data (zero-allocation pattern) */
export interface WSData {
  clientId: string;
  roomId: string;
  joined: boolean;
}

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Room(roomId, MAX_PLAYERS_PER_ROOM, SNAPSHOT_HZ);
    rooms.set(roomId, room);
  }
  return room;
}

// ─── Bun Server ──────────────────────────────────────────────────

const server = Bun.serve<WSData>({
  port: PORT,
  idleTimeout: 255, // max idle timeout (seconds)

  fetch(req, server) {
    const url = new URL(req.url);

    // ── Health + Metrics ────────────────────────────────────
    if (url.pathname === '/health') {
      return getHealthResponse(rooms);
    }
    if (url.pathname === '/metrics') {
      return getMetricsResponse(rooms);
    }

    // ── WebSocket upgrade ───────────────────────────────────
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'ws') {
      // Origin check
      if (ALLOWED_ORIGINS[0] !== '*') {
        const origin = req.headers.get('origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) {
          return new Response('Forbidden', { status: 403 });
        }
      }

      const roomId = pathParts[1] || 'lobby';
      const clientId = crypto.randomUUID();

      const upgraded = server.upgrade(req, {
        data: { clientId, roomId, joined: false } satisfies WSData,
      });

      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      // Bun returns undefined on successful upgrade
      return undefined;
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },

  websocket: {
    // ── Keepalive ─────────────────────────────────────────
    idleTimeout: Math.ceil(KEEPALIVE_MS / 1000),
    sendPings: true,

    open(ws) {
      // Connection opened — waiting for "join" message
    },

    message(ws, message) {
      const { clientId, roomId } = ws.data;

      // Rate limiting
      if (!rateLimiter.allow(clientId)) {
        ws.sendBinary(encodeMessage({
          type: 'error',
          payload: { code: ErrorCodes.RATE_LIMITED, message: 'Rate limited' },
        }));
        return;
      }

      // Decode the binary message
      const data = typeof message === 'string'
        ? new TextEncoder().encode(message)
        : message;

      const decoded = decodeMessage(data);
      if (!decoded) {
        ws.sendBinary(encodeMessage({
          type: 'error',
          payload: { code: ErrorCodes.INVALID_MESSAGE, message: 'Invalid message format' },
        }));
        return;
      }

      const room = getOrCreateRoom(roomId);

      switch (decoded.type) {
        case 'join': {
          if (ws.data.joined) break;
          const displayName = (decoded.payload.displayName || 'Anonymous').slice(0, 32);
          const success = room.join(clientId, ws, displayName);
          if (success) {
            ws.data.joined = true;
          }
          break;
        }

        case 'state': {
          if (!ws.data.joined) {
            ws.sendBinary(encodeMessage({
              type: 'error',
              payload: { code: ErrorCodes.NOT_JOINED, message: 'Send a "join" message first' },
            }));
            break;
          }
          room.updatePlayerState(clientId, decoded.payload);
          break;
        }

        case 'chat': {
          if (!ws.data.joined) break;
          room.chat(clientId, decoded.payload.message);
          break;
        }
      }
    },

    close(ws, code, reason) {
      const { clientId, roomId } = ws.data;
      rateLimiter.remove(clientId);

      const room = rooms.get(roomId);
      if (room) {
        room.leave(clientId, ws);
        // Clean up empty rooms (except lobby)
        if (room.playerCount === 0 && roomId !== 'lobby') {
          room.destroy();
          rooms.delete(roomId);
        }
      }
    },
  },
});

// ─── Rate limiter cleanup ────────────────────────────────────────

setInterval(() => {
  rateLimiter.cleanup();
}, 10_000);

// ─── Start ───────────────────────────────────────────────────────

console.log(`[bun-ws-gameserver] Listening on port ${server.port}`);
console.log(`[bun-ws-gameserver] WebSocket endpoint: ws://localhost:${server.port}/ws/:roomId`);
console.log(`[bun-ws-gameserver] Health: http://localhost:${server.port}/health`);
console.log(`[bun-ws-gameserver] Metrics: http://localhost:${server.port}/metrics`);
console.log(`[bun-ws-gameserver] Config: ${SNAPSHOT_HZ}Hz tick, ${MAX_PLAYERS_PER_ROOM} max/room, ${MAX_MESSAGES_PER_SECOND} msg/s limit`);
