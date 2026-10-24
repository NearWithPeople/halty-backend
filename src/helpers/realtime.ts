import type { Core } from '@strapi/strapi';
import { WebSocket, WebSocketServer } from 'ws';

let wss: WebSocketServer | null = null;

/**
 * Push an event to every connected WebSocket client.
 * Envelope matches the frontend contract: `{ type, payload, timestamp }`.
 * No-op until {@link initRealtime} has run.
 */
export function broadcast(type: string, payload: unknown): void {
  if (!wss) return;

  const message = JSON.stringify({ type, payload, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * Mount the raw WebSocket server on the Strapi HTTP server at `/ws` and expose
 * `strapi.broadcast(type, payload)` so any controller can push live updates.
 */
export function initRealtime(strapi: Core.Strapi): void {
  if (wss) return;

  wss = new WebSocketServer({ server: strapi.server.httpServer, path: '/ws' });

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'CONNECTED', data: { time: Date.now() } }));
  });

  wss.on('error', (error) => strapi.log.error(`[ws] ${error.message}`));

  (strapi as Core.Strapi & { broadcast: typeof broadcast }).broadcast = broadcast;
  strapi.log.info('[ws] WebSocket server mounted on /ws');
}
