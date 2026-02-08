# bun-ws-gameserver

Production-grade Bun-native WebSocket game server with room-based architecture, binary protocol (msgpack), server-authoritative tick loop, and per-client rate limiting. 5-8x faster than Node.js `ws` — same protocol, same clients.

[![Deploy on Alternate Futures](https://app.alternatefutures.ai/badge/deploy.svg)](https://app.alternatefutures.ai/deploy/bun-ws-gameserver)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/SkArS3?referralCode=vwwMnH)

## Features

- **Bun-native WebSocket** — Uses `Bun.serve()` built-in WebSocket (5-8x faster than Node.js `ws`)
- **Room-based architecture** — `/ws/:roomId` with auto-created rooms and configurable player caps
- **Binary protocol (msgpack)** — ~40% smaller payloads than JSON
- **Server-authoritative tick loop** — Configurable Hz for snapshot broadcasting
- **Player state sync** — Position, rotation, action, and timestamp per player
- **Bun pub/sub** — Built-in topic-based broadcasting for efficient room messages
- **Zero-allocation per-connection state** — `ws.data` pattern for per-client metadata
- **Per-client rate limiting** — Sliding window algorithm
- **KeepAlive** — Bun's built-in ping/pong with configurable idle timeout
- **Origin allowlist** — Configurable CORS protection
- **Health + Metrics endpoints** — `/health` and `/metrics` for monitoring and autoscaling
- **Production Dockerfile** — Multi-stage (oven/bun:1-alpine), non-root user, HEALTHCHECK

## Quick Start

```bash
# Install dependencies
bun install

# Development (with hot reload)
bun run dev

# Production
bun src/index.ts
```

## Docker

```bash
# Build and run
docker compose up --build

# Or manually
docker build -t bun-ws-gameserver .
docker run -p 8080:8080 bun-ws-gameserver
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server listen port |
| `ALLOWED_ORIGINS` | `*` | Comma-separated allowed origins |
| `SNAPSHOT_HZ` | `20` | Tick rate (snapshots/sec) |
| `KEEPALIVE_MS` | `30000` | Idle timeout (ms) |
| `MAX_MESSAGES_PER_SECOND` | `60` | Per-client rate limit |
| `MAX_PLAYERS_PER_ROOM` | `50` | Room capacity |

## Protocol

Both [`node-ws-gameserver`](https://github.com/alternatefutures/node-ws-gameserver) and `bun-ws-gameserver` use the same **msgpack binary protocol**, so clients are backend-agnostic.

### Client → Server

```typescript
{ type: "join",  payload: { displayName: string } }
{ type: "state", payload: { position: {x,y,z}, rotation: {x,y,z,w}, action: string } }
{ type: "chat",  payload: { message: string } }
```

### Server → Client

```typescript
{ type: "snapshot",      payload: { players: Record<id, PlayerState>, timestamp: number } }
{ type: "player_joined", payload: { id: string, displayName: string } }
{ type: "player_left",   payload: { id: string } }
{ type: "chat",          payload: { id: string, message: string } }
{ type: "error",         payload: { code: string, message: string } }
```

### Example Client (browser)

```typescript
import { encode, decode } from '@msgpack/msgpack';

const ws = new WebSocket('ws://localhost:8080/ws/lobby');
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
  ws.send(encode({ type: 'join', payload: { displayName: 'Player1' } }));
};

ws.onmessage = (event) => {
  const msg = decode(new Uint8Array(event.data));
  if (msg.type === 'snapshot') {
    // Update game state with msg.payload.players
  }
};

// Send player state at 30fps
setInterval(() => {
  ws.send(encode({
    type: 'state',
    payload: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      action: 'idle',
    },
  }));
}, 33);
```

## Why Bun?

| | Node.js (`ws`) | Bun (native) |
|---|---|---|
| WebSocket throughput | ~50k msg/s | ~400k msg/s |
| HTTP + WS server | Separate setup | Single `Bun.serve()` |
| Per-connection state | WeakMap lookup | `ws.data` (zero-alloc) |
| Broadcasting | Manual loop | Built-in pub/sub topics |
| Startup time | ~200ms | ~20ms |

Same protocol, same clients, same API — just faster.

## Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/ws/:roomId` | WS | WebSocket game connection (default room: "lobby") |
| `/health` | GET | Health check — status, rooms, connections, uptime |
| `/metrics` | GET | Detailed metrics — memory, messages/sec per room |

## Deploy

### Alternate Futures

Click the deploy button at the top, or go to [app.alternatefutures.ai](https://app.alternatefutures.ai) — select this template and deploy to decentralized cloud in one click.

### Railway

1. Fork this repo
2. Connect to Railway
3. Deploy — Railway reads `railway.toml` automatically

### Docker (any host)

```bash
docker build --platform linux/amd64 -t bun-ws-gameserver .
docker run -p 8080:8080 -e PORT=8080 bun-ws-gameserver
```

## License

MIT
