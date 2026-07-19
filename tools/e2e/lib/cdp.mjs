// CDP client utilities for Tauri 2 E2E testing
// Zero-dependency: uses Node.js built-in net + crypto for WebSocket
// Connects to Chromium DevTools Protocol at http://127.0.0.1:9222

import net from 'net';
import crypto from 'crypto';

const CDP_BASE = 'http://127.0.0.1:9222';
let msgId = 1;

// ─── Minimal WebSocket client (RFC 6455) ───────────────────────

class MiniWS {
  constructor(url) {
    this.url = new URL(url);
    this._handlers = {};
    this._buffer = Buffer.alloc(0);
    this._handshakeDone = false;
    this._closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const port = parseInt(this.url.port) || 80;
      const host = this.url.hostname;
      this._socket = net.connect(port, host);

      this._socket.on('error', (err) => {
        if (!this._handshakeDone) reject(err);
        else this._emit('error', err);
      });

      this._socket.on('data', (chunk) => this._onData(chunk));
      this._socket.on('close', () => {
        this._closed = true;
        this._emit('close');
      });

      this._socket.on('connect', () => {
        this._startHandshake();
      });

      // Resolve when handshake completes
      this._resolveOpen = resolve;
      this._rejectOpen = reject;

      // Timeout
      setTimeout(() => {
        if (!this._handshakeDone) {
          reject(new Error('WebSocket handshake timeout'));
          this._socket?.destroy();
        }
      }, 5000);
    });
  }

  _startHandshake() {
    const key = crypto.randomBytes(16).toString('base64');
    const path = this.url.pathname + this.url.search;
    const lines = [
      `GET ${path} HTTP/1.1`,
      `Host: ${this.url.host}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      '',
      ''
    ];
    this._socket.write(lines.join('\r\n'));
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);

    if (!this._handshakeDone) {
      const idx = this._buffer.indexOf('\r\n\r\n');
      if (idx === -1) return;
      // Check for 101 response
      const headerStr = this._buffer.subarray(0, idx).toString();
      if (!headerStr.includes('101')) {
        this._rejectOpen?.(new Error(`WebSocket handshake failed: ${headerStr.split('\r\n')[0]}`));
        this._socket?.destroy();
        return;
      }
      this._buffer = this._buffer.subarray(idx + 4);
      this._handshakeDone = true;
      this._resolveOpen?.(this);
    }

    // Parse frames
    while (this._buffer.length > 0) {
      const frame = this._parseFrame();
      if (!frame) break;
      this._buffer = this._buffer.subarray(frame.totalLen);

      switch (frame.opcode) {
        case 0x1: // text
          this._emit('message', frame.payload.toString('utf-8'));
          break;
        case 0x8: // close
          this._closed = true;
          this._emit('close');
          this._socket?.destroy();
          break;
        case 0x9: // ping → pong
          this._sendFrame(0xA, frame.payload);
          break;
      }
    }
  }

  _parseFrame() {
    const buf = this._buffer;
    if (buf.length < 2) return null;

    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let payloadLen = buf[1] & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (buf.length < 4) return null;
      payloadLen = buf.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (buf.length < 10) return null;
      // Read 64-bit length (safely, since JS can handle up to 2^53)
      const high = buf.readUInt32BE(2);
      const low = buf.readUInt32BE(6);
      payloadLen = high * 0x100000000 + low;
      offset = 10;
    }

    if (masked) offset += 4;
    if (buf.length < offset + payloadLen) return null;

    let payload = buf.subarray(offset, offset + payloadLen);
    if (masked) {
      const mask = buf.subarray(offset - 4, offset);
      payload = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = buf[offset + i] ^ mask[i % 4];
      }
    }

    return { opcode, payload, totalLen: offset + payloadLen };
  }

  _sendFrame(opcode, payload) {
    payload = Buffer.from(payload);
    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i] ^ mask[i % 4];
    }

    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(payload.length, 6);
      mask.copy(header, 10);
    }

    this._socket.write(Buffer.concat([header, masked]));
  }

  send(data) {
    if (this._closed) return;
    this._sendFrame(0x1, data);
  }

  close() {
    if (this._closed) return;
    try { this._sendFrame(0x8, ''); } catch(e) {}
    this._socket?.destroy();
    this._closed = true;
  }

  addEventListener(event, handler) {
    (this._handlers[event] = this._handlers[event] || []).push(handler);
  }

  removeEventListener(event, handler) {
    const list = this._handlers[event];
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  _emit(event, ...args) {
    (this._handlers[event] || []).forEach(h => h(...args));
  }
}

// ─── CDP API ────────────────────────────────────────────────────

export async function getPageTarget() {
  const res = await fetch(`${CDP_BASE}/json/list`);
  const targets = await res.json();
  return targets.find(t => t.type === 'page') ?? targets[0];
}

export async function cdp(ws, method, params = {}) {
  const id = msgId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      let resp;
      try { resp = JSON.parse(data); } catch(e) { return; }
      if (resp.id === id) {
        ws.removeEventListener('message', handler);
        clearTimeout(timer);
        if (resp.error) reject(new Error(JSON.stringify(resp.error)));
        else resolve(resp.result);
      }
    };
    ws.addEventListener('message', handler);
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
  });
}

export async function evaluate(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result.subtype === 'error') throw new Error(r.result.description);
  return r.result.value;
}

export async function connectCdp() {
  const target = await getPageTarget();
  if (!target) throw new Error('No CDP page target found. Is the app running with CDP debugging?');
  const ws = new MiniWS(target.webSocketDebuggerUrl);
  await ws.connect();
  return ws;
}

export async function tauriInvoke(ws, cmd, args = {}) {
  const expr = `
    (async () => {
      const args = ${JSON.stringify(args)};
      try {
        if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
          const result = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, args);
          return { ok: true, value: result };
        }
        if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
          const result = await window.__TAURI__.core.invoke(${JSON.stringify(cmd)}, args);
          return { ok: true, value: result };
        }
        try {
          const mod = await import('@tauri-apps/api/core');
          if (mod.invoke) {
            const result = await mod.invoke(${JSON.stringify(cmd)}, args);
            return { ok: true, value: result };
          }
        } catch(e) { /* module not available */ }
        return { ok: false, error: 'No invoke pathway found. __TAURI_INTERNALS__=' + (typeof window.__TAURI_INTERNALS__) + ' __TAURI__=' + (typeof window.__TAURI__) };
      } catch(e) {
        return { ok: false, error: String(e?.message || e) };
      }
    })()
  `;
  return await evaluate(ws, expr);
}

export async function probeTauriGlobals(ws) {
  return await evaluate(ws, `
    JSON.stringify({
      hasTauriInternals: typeof window.__TAURI_INTERNALS__,
      hasTauri: typeof window.__TAURI__,
      tauriKeys: window.__TAURI__ ? Object.keys(window.__TAURI__) : [],
      internalsKeys: window.__TAURI_INTERNALS__ ? Object.keys(window.__TAURI_INTERNALS__) : [],
      hasElectron: typeof window.electron,
      hasGetCurrentWindow: typeof window.__TAURI__?.window?.getCurrentWindow,
      location: window.location.href,
    })
  `);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
