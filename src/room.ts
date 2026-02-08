import type { ServerWebSocket } from 'bun';
import { encodeMessage, PROTOCOL_VERSION, type ServerMessage, ErrorCodes } from './protocol';
import type { WSData } from './index';

export interface Peer {
  id: string;
  ws: ServerWebSocket<WSData>;
  joinedAt: number;
}

export class Room {
  readonly id: string;
  private peers: Map<string, Peer> = new Map();
  private readonly maxPlayers: number;

  // Metrics
  private messageCount = 0;
  private lastMessageCountReset = Date.now();
  messagesPerSecond = 0;

  constructor(id: string, maxPlayers: number) {
    this.id = id;
    this.maxPlayers = maxPlayers;
  }

  get playerCount(): number {
    return this.peers.size;
  }

  get isFull(): boolean {
    return this.peers.size >= this.maxPlayers;
  }

  /** Bun pub/sub topic for this room */
  private get topic(): string {
    return `room:${this.id}`;
  }

  /**
   * Add a peer to the room. Auto-called on WebSocket open.
   * Returns false if room is full.
   */
  join(id: string, ws: ServerWebSocket<WSData>): boolean {
    if (this.isFull) {
      ws.sendBinary(encodeMessage({
        type: 'error',
        code: ErrorCodes.ROOM_FULL,
        message: `Room "${this.id}" is full (${this.maxPlayers} peers)`,
      }));
      return false;
    }

    // Collect existing peer IDs before adding the new one
    const existingPeerIds: string[] = [];
    for (const peer of this.peers.values()) {
      existingPeerIds.push(peer.id);
    }

    const peer: Peer = {
      id,
      ws,
      joinedAt: Date.now(),
    };

    this.peers.set(id, peer);

    // Send welcome to the new peer with list of existing peers
    ws.sendBinary(encodeMessage({
      type: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      playerId: id,
      peers: existingPeerIds,
    }));

    // Notify existing peers about the newcomer
    const joinMsg = encodeMessage({
      type: 'peer_joined',
      peerId: id,
    });
    this.publishToRoom(joinMsg, id);

    // Subscribe this client to the room topic
    ws.subscribe(this.topic);

    return true;
  }

  /**
   * Remove a peer from the room.
   */
  leave(id: string, ws: ServerWebSocket<WSData>): void {
    const peer = this.peers.get(id);
    if (!peer) return;

    this.peers.delete(id);
    ws.unsubscribe(this.topic);

    // Notify remaining peers
    const leaveMsg = encodeMessage({
      type: 'peer_left',
      peerId: id,
    });
    this.publishToRoom(leaveMsg);
  }

  /**
   * Relay a client message to all other peers in the room.
   * The original message is wrapped in a `relay` envelope.
   */
  relay(fromId: string, data: unknown): void {
    const peer = this.peers.get(fromId);
    if (!peer) return;

    const relayMsg = encodeMessage({
      type: 'relay',
      from: fromId,
      data,
    });
    this.publishToRoom(relayMsg, fromId);

    this.messageCount++;
  }

  /** Check if a peer exists in this room */
  hasPeer(id: string): boolean {
    return this.peers.has(id);
  }

  /** Publish binary data to room, optionally excluding one peer */
  private publishToRoom(data: Uint8Array, excludeId?: string): void {
    if (excludeId) {
      // Bun's publish() doesn't support exclude, so send individually
      for (const [id, peer] of this.peers) {
        if (id === excludeId) continue;
        peer.ws.sendBinary(data);
      }
    } else {
      // Use Bun's built-in pub/sub for efficient broadcasting
      const firstPeer = this.peers.values().next().value;
      if (firstPeer) {
        firstPeer.ws.publish(this.topic, data);
      }
    }
  }

  /** Update messages/sec metric (call periodically) */
  updateMetrics(): void {
    const now = Date.now();
    const elapsed = now - this.lastMessageCountReset;
    if (elapsed >= 1000) {
      this.messagesPerSecond = Math.round((this.messageCount / elapsed) * 1000);
      this.messageCount = 0;
      this.lastMessageCountReset = now;
    }
  }

  /** Clean up the room */
  destroy(): void {
    for (const peer of this.peers.values()) {
      peer.ws.close(1001, 'Room destroyed');
    }
    this.peers.clear();
  }
}
