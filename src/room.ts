import type { ServerWebSocket } from 'bun';
import { encodeMessage, type PlayerState, type ServerMessage, ErrorCodes } from './protocol';
import type { WSData } from './index';

export interface Player {
  id: string;
  ws: ServerWebSocket<WSData>;
  displayName: string;
  state: PlayerState;
  joinedAt: number;
}

export class Room {
  readonly id: string;
  private players: Map<string, Player> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxPlayers: number;
  private readonly snapshotHz: number;

  // Metrics
  private messageCount = 0;
  private lastMessageCountReset = Date.now();
  messagesPerSecond = 0;

  constructor(id: string, maxPlayers: number, snapshotHz: number) {
    this.id = id;
    this.maxPlayers = maxPlayers;
    this.snapshotHz = snapshotHz;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  get isRunning(): boolean {
    return this.tickInterval !== null;
  }

  /** Add a player to the room. Returns false if room is full. */
  join(id: string, ws: ServerWebSocket<WSData>, displayName: string): boolean {
    if (this.isFull) {
      ws.sendBinary(encodeMessage({
        type: 'error',
        payload: { code: ErrorCodes.ROOM_FULL, message: `Room "${this.id}" is full (${this.maxPlayers} players)` },
      }));
      return false;
    }

    const player: Player = {
      id,
      ws,
      displayName,
      state: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        action: 'idle',
      },
      joinedAt: Date.now(),
    };

    this.players.set(id, player);

    // Notify existing players via Bun's pub/sub
    const joinMsg = encodeMessage({
      type: 'player_joined',
      payload: { id, displayName },
    });
    this.publishToRoom(joinMsg, id);

    // Subscribe this client to the room topic
    ws.subscribe(this.topic);

    // Start tick loop if this is the first player
    if (this.players.size === 1 && !this.tickInterval) {
      this.startTickLoop();
    }

    return true;
  }

  /** Remove a player from the room */
  leave(id: string, ws: ServerWebSocket<WSData>): void {
    const player = this.players.get(id);
    if (!player) return;

    this.players.delete(id);
    ws.unsubscribe(this.topic);

    // Notify remaining players
    const leaveMsg = encodeMessage({
      type: 'player_left',
      payload: { id },
    });
    this.publishToRoom(leaveMsg);

    // Stop tick loop if room is empty
    if (this.players.size === 0) {
      this.stopTickLoop();
    }
  }

  /** Update a player's state */
  updatePlayerState(id: string, state: PlayerState): void {
    const player = this.players.get(id);
    if (!player) return;
    player.state = { ...state, timestamp: Date.now() };
    this.messageCount++;
  }

  /** Broadcast a chat message from a player */
  chat(id: string, message: string): void {
    const player = this.players.get(id);
    if (!player) return;
    const chatMsg = encodeMessage({
      type: 'chat',
      payload: { id, message: message.slice(0, 500) },
    });
    this.publishToRoom(chatMsg);
    this.messageCount++;
  }

  /** Check if a player exists in this room */
  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  /** Bun pub/sub topic for this room */
  private get topic(): string {
    return `room:${this.id}`;
  }

  /** Start the server-authoritative tick loop */
  private startTickLoop(): void {
    const intervalMs = 1000 / this.snapshotHz;
    this.tickInterval = setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  /** Stop the tick loop */
  private stopTickLoop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /** Single tick: broadcast snapshot of all player states */
  private tick(): void {
    if (this.players.size === 0) return;

    const players: Record<string, PlayerState & { displayName: string }> = {};
    for (const [id, player] of this.players) {
      players[id] = {
        ...player.state,
        displayName: player.displayName,
      };
    }

    const snapshot: ServerMessage = {
      type: 'snapshot',
      payload: {
        players,
        timestamp: Date.now(),
      },
    };

    this.publishToRoom(encodeMessage(snapshot));

    // Update messages/sec metric
    const now = Date.now();
    const elapsed = now - this.lastMessageCountReset;
    if (elapsed >= 1000) {
      this.messagesPerSecond = Math.round((this.messageCount / elapsed) * 1000);
      this.messageCount = 0;
      this.lastMessageCountReset = now;
    }
  }

  /** Publish binary data to all subscribers via Bun's pub/sub, optionally excluding one */
  private publishToRoom(data: Uint8Array, excludeId?: string): void {
    if (excludeId) {
      // Bun's publish() doesn't support exclude, so send individually
      for (const [id, player] of this.players) {
        if (id === excludeId) continue;
        player.ws.sendBinary(data);
      }
    } else {
      // Use Bun's built-in pub/sub for efficient broadcasting
      // Pick any connected player's ws to call publish()
      const firstPlayer = this.players.values().next().value;
      if (firstPlayer) {
        firstPlayer.ws.publish(this.topic, data);
      }
    }
  }

  /** Clean up the room */
  destroy(): void {
    this.stopTickLoop();
    for (const player of this.players.values()) {
      player.ws.close(1001, 'Room destroyed');
    }
    this.players.clear();
  }
}
