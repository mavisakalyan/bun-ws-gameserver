import type { Room } from './room';

export interface HealthInfo {
  status: 'ok';
  uptime: number;
  rooms: number;
  connections: number;
  timestamp: string;
}

export interface MetricsInfo {
  uptime: number;
  rooms: Record<string, { players: number; messagesPerSecond: number; running: boolean }>;
  totalConnections: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal?: number;
  };
}

const startTime = Date.now();

/**
 * Build health response JSON.
 */
export function getHealthResponse(rooms: Map<string, Room>): Response {
  let totalConnections = 0;
  for (const room of rooms.values()) {
    totalConnections += room.playerCount;
  }

  const health: HealthInfo = {
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    rooms: rooms.size,
    connections: totalConnections,
    timestamp: new Date().toISOString(),
  };

  return Response.json(health);
}

/**
 * Build metrics response JSON.
 */
export function getMetricsResponse(rooms: Map<string, Room>): Response {
  let totalConnections = 0;
  const roomMetrics: MetricsInfo['rooms'] = {};

  for (const [id, room] of rooms) {
    totalConnections += room.playerCount;
    roomMetrics[id] = {
      players: room.playerCount,
      messagesPerSecond: room.messagesPerSecond,
      running: room.isRunning,
    };
  }

  const metrics: MetricsInfo = {
    uptime: Math.floor((Date.now() - startTime) / 1000),
    rooms: roomMetrics,
    totalConnections,
    memory: {
      rss: process.memoryUsage.rss(),
      heapUsed: process.memoryUsage().heapUsed,
    },
  };

  return Response.json(metrics);
}
