import { parseSocketMessage, type SocketMessage } from './protocol';

export type TransportStatus = 'connected' | 'disconnected';

/**
 * Owns only the browser socket lifecycle: URL construction, reconnect backoff,
 * raw JSON frames and generation guards. It does not know room state or ops.
 */
export class SocketTransport {
  private socket: WebSocket | null = null;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private roomSlug: string | null = null;

  onMessage: ((message: SocketMessage) => void) | null = null;
  onStatus: ((status: TransportStatus) => void) | null = null;

  get isActive(): boolean {
    return this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING;
  }

  connect(roomSlug: string): void {
    this.stopSocket();
    this.roomSlug = roomSlug;
    const generation = ++this.generation;
    this.open(roomSlug, generation);
  }

  disconnect(): void {
    ++this.generation;
    this.roomSlug = null;
    this.stopSocket();
  }

  send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private stopSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const old = this.socket;
    this.socket = null;
    if (old && (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING)) old.close();
  }

  private open(roomSlug: string, generation: number): void {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/api/rooms/${encodeURIComponent(roomSlug)}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      if (generation !== this.generation || this.socket !== socket) return;
      this.retry = 0;
      this.onStatus?.('connected');
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation || this.socket !== socket) return;
      const message = parseSocketMessage(event.data);
      if (message) this.onMessage?.(message);
    };
    socket.onclose = () => {
      if (generation !== this.generation || this.socket !== socket) return;
      this.socket = null;
      this.onStatus?.('disconnected');
      if (this.roomSlug !== roomSlug) return;
      const delay = Math.min(1000 * 2 ** this.retry, 10_000);
      this.retry += 1;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (generation === this.generation && this.roomSlug === roomSlug) this.open(roomSlug, generation);
      }, delay);
    };
  }
}
