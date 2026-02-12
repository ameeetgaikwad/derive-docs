import type { WsMessage, WsSubscription } from "./types";
import { getConfig, type DeriveEnv } from "./constants";

type WsHandler = (data: unknown, channel: string) => void;
type WsStatusHandler = (status: "connecting" | "connected" | "disconnected" | "error") => void;

const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;

export class DeriveWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers = new Map<string, Set<WsHandler>>();
  private statusHandlers = new Set<WsStatusHandler>();
  private subscriptions = new Set<string>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private rpcId = 1;
  private pendingRpcs = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _isConnected = false;

  constructor(env?: DeriveEnv) {
    const config = getConfig(env);
    this.url = config.wsUrl;
  }

  get isConnected() {
    return this._isConnected;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.emitStatus("connecting");

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.emitStatus("error");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._isConnected = true;
      this.reconnectAttempts = 0;
      this.emitStatus("connected");
      this.startHeartbeat();
      this.resubscribeAll();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._isConnected = false;
      this.stopHeartbeat();
      this.emitStatus("disconnected");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.emitStatus("error");
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.subscriptions.clear();
    this.handlers.clear();
    this.pendingRpcs.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
    this.emitStatus("disconnected");
  }

  subscribe(channel: string, handler: WsHandler) {
    const existing = this.handlers.get(channel);
    if (existing) {
      existing.add(handler);
    } else {
      this.handlers.set(channel, new Set([handler]));
    }

    if (!this.subscriptions.has(channel)) {
      this.subscriptions.add(channel);
      if (this._isConnected) {
        this.sendSubscribe(channel);
      }
    }

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(channel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(channel);
          this.subscriptions.delete(channel);
          if (this._isConnected) {
            this.sendUnsubscribe(channel);
          }
        }
      }
    };
  }

  onStatus(handler: WsStatusHandler) {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  async login(wallet: `0x${string}`, timestamp: string, signature: string) {
    return this.rpc("public/login", {
      wallet,
      timestamp,
      signature,
    });
  }

  /** Call any private method after WS login */
  async callPrivate<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.rpc(`private/${method}`, params) as Promise<T>;
  }


  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.rpcId++;
    return new Promise((resolve, reject) => {
      this.pendingRpcs.set(id, { resolve, reject });
      this.send({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      setTimeout(() => {
        if (this.pendingRpcs.has(id)) {
          this.pendingRpcs.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 10_000);
    });
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(msg: WsMessage) {
    // Handle RPC responses
    if (msg.id !== undefined) {
      const pending = this.pendingRpcs.get(msg.id);
      if (pending) {
        this.pendingRpcs.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Handle subscription data
    if (msg.method === "subscription" && msg.params) {
      const { channel, data } = msg.params;
      const handlers = this.handlers.get(channel);
      if (handlers) {
        for (const handler of handlers) {
          handler(data, channel);
        }
      }
    }
  }

  private sendSubscribe(channel: string) {
    this.send({
      jsonrpc: "2.0",
      id: this.rpcId++,
      method: "subscribe",
      params: { channels: [channel] },
    });
  }

  private sendUnsubscribe(channel: string) {
    this.send({
      jsonrpc: "2.0",
      id: this.rpcId++,
      method: "unsubscribe",
      params: { channels: [channel] },
    });
  }

  private resubscribeAll() {
    for (const channel of this.subscriptions) {
      this.sendSubscribe(channel);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_DELAY * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_DELAY
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this._isConnected) {
        this.send({
          jsonrpc: "2.0",
          id: this.rpcId++,
          method: "public/heartbeat",
          params: {},
        });
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private emitStatus(status: "connecting" | "connected" | "disconnected" | "error") {
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }
}
