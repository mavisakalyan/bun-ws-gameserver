# bun-ws-gameserver

Protocol-agnostic Bun-native WebSocket relay server with room-based architecture, binary protocol (msgpack), and per-client rate limiting. 5-8x faster than Node.js `ws` — same protocol, same clients.

[![Deploy on Alternate Futures](https://app.alternatefutures.ai/badge/deploy.svg)](https://app.alternatefutures.ai/deploy/bun-ws-gameserver)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/SkArS3?referralCode=vwwMnH)

## Features

- **Bun-native WebSocket** — Uses `Bun.serve()` built-in WebSocket (5-8x faster than Node.js `ws`)
- **Room-based architecture** — `/ws/:roomId` with auto-created rooms and configurable player caps
- **Protocol-agnostic relay** — Server relays any msgpack message between peers without inspecting payloads
- **Binary protocol (msgpack)** — ~40% smaller payloads than JSON
- **Instant relay** — Messages forwarded immediately to peers (no server-side batching)
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
| `KEEPALIVE_MS` | `30000` | Idle timeout (ms) |
| `MAX_MESSAGES_PER_SECOND` | `60` | Per-client rate limit |
| `MAX_PLAYERS_PER_ROOM` | `50` | Room capacity |

## Protocol

Both [`node-ws-gameserver`](https://github.com/mavisakalyan/node-ws-gameserver) and `bun-ws-gameserver` use the same **msgpack binary relay protocol**, so clients are backend-agnostic.

The server is **protocol-agnostic** — it manages rooms and connections, but treats game data as opaque payloads. Any client that speaks msgpack can use it: multiplayer games, collaborative tools, IoT dashboards, chat apps, etc.

### Connection Flow

1. Client connects to `ws://host/ws/:roomId`
2. Server auto-assigns a `playerId` and sends `welcome` with list of existing peers
3. Client sends any msgpack messages — server wraps each in a `relay` envelope and forwards to all other peers
4. When peers join/leave, server notifies all remaining peers

### Server → Client

```typescript
// Sent on connect
{ type: "welcome", playerId: string, peers: string[] }

// Peer lifecycle
{ type: "peer_joined", peerId: string }
{ type: "peer_left",   peerId: string }

// Relayed game data from another peer (data is passed through untouched)
{ type: "relay", from: string, data: any }

// Keepalive response
{ type: "pong", nonce: string, serverTime: number }

// Errors (rate limit, room full, bad message)
{ type: "error", code: string, message: string }
```

### Client → Server

```typescript
// Optional keepalive
{ type: "ping", nonce: string }

// ANYTHING ELSE is relayed to all other peers in the room.
// The server does not inspect or validate your game data.
// Examples:
{ type: "position", x: 1.5, y: 0, z: -3.2 }
{ type: "chat", text: "hello" }
{ type: "snapshot", pos: [0, 1, 0], rotY: 3.14, locomotion: "run" }
```

### Example Client (browser)

```typescript
import { encode, decode } from '@msgpack/msgpack';

const ws = new WebSocket('ws://localhost:8080/ws/lobby');
ws.binaryType = 'arraybuffer';

let myId: string;

ws.onmessage = (event) => {
  const msg = decode(new Uint8Array(event.data));

  switch (msg.type) {
    case 'welcome':
      myId = msg.playerId;
      console.log(`Joined as ${myId}, peers:`, msg.peers);
      break;
    case 'peer_joined':
      console.log(`${msg.peerId} joined`);
      break;
    case 'peer_left':
      console.log(`${msg.peerId} left`);
      break;
    case 'relay':
      // msg.from = peer ID, msg.data = whatever they sent
      handlePeerData(msg.from, msg.data);
      break;
  }
};

// Send your game state (any shape you want)
setInterval(() => {
  ws.send(encode({
    type: 'position',
    x: Math.random() * 10,
    y: 0,
    z: Math.random() * 10,
  }));
}, 50);
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
| `/ws/:roomId` | WS | WebSocket connection (default room: "lobby") |
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
