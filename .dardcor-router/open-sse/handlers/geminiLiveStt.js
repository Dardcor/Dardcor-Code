import { Buffer } from "node:buffer";

//   - Node >= 22 global WebSocket (undici). No new dependency.

const SETUP_TIMEOUT_MS = 10_000;
const TURN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const CHUNK_BYTES = 16_384;
const GOAWAY_RECONNECTS = 1;

class GeminiLiveError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GeminiLiveError";
    this.status = status || 502;
  }
}

function toLiveWsUrl(baseUrl, model, token) {
  const url = new URL(baseUrl);
  url.protocol = "wss:";
  if (!url.pathname.startsWith("/ws/")) url.pathname = `/ws/api${url.pathname}`;
  const base = url.toString().replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(model)}:bidiGenerateContent?key=${encodeURIComponent(token || "")}`;
}

function bindSocket(ws, { onOpen, onMessage, onError, onClose }) {
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
    return;
  }
  ws.onopen = onOpen;
  ws.onmessage = onMessage;
  ws.onerror = onError;
  ws.onclose = onClose;
}

function parseFrame(data) {
  try {
    return JSON.parse(typeof data === "string" ? data : String(data));
  } catch {
    return null;
  }
}

function firstStringField(formData, key) {
  const v = typeof formData?.get === "function" ? formData.get(key) : null;
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function firstNumberField(formData, key, fallback) {
  const n = Number(firstStringField(formData, key));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TIMEOUT_MS) : fallback;
}

export async function transcribeGeminiLive({ cfg, file, model, token, formData, mimeType }) {
  const WS = globalThis.WebSocket;
  if (!WS) throw new GeminiLiveError("Gemini Live transport needs global WebSocket (Node >= 22)", 502);

  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) throw new GeminiLiveError("Empty audio file", 400);

  const instruction = firstStringField(formData, "prompt") || "Transcribe the spoken audio verbatim.";
  const language = firstStringField(formData, "language");
  const setupTimeoutMs = firstNumberField(formData, "setup_timeout_ms", SETUP_TIMEOUT_MS);
  const turnTimeoutMs = firstNumberField(formData, "turn_timeout_ms", TURN_TIMEOUT_MS);
  const instructionOverride = firstStringField(formData, "system_instruction");
  const systemText = instructionOverride
    || (language ? `${instruction} Language: ${language}.` : instruction);
  const wsUrl = toLiveWsUrl(cfg.baseUrl, model, token);

  return await new Promise((resolve, reject) => {
    let text = "";
    const chunks = [];
    let settled = false;
    let timer = null;
    let goAwayTimer = null;
    let ws = null;
    let generation = 0;
    let sentBytes = 0;
    let goAwayReconnects = GOAWAY_RECONNECTS;

    const arm = (ms, message) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fail(new GeminiLiveError(message, 504)), ms);
    };
    const shutdown = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (goAwayTimer) { clearTimeout(goAwayTimer); goAwayTimer = null; }
      if (!ws) return;
      try {
        if (ws.readyState === WS.OPEN || ws.readyState === WS.CONNECTING) ws.close(1000);
      } catch { }
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      shutdown();
      resolve({ text, chunks });
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      shutdown();
      reject(err);
    };
    const send = (frame) => {
      if (ws.readyState !== WS.OPEN) return false;
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        return false;
      }
      return true;
    };

    const streamAudioAndPrompt = () => {
      for (let off = sentBytes; off < buf.length; off += CHUNK_BYTES) {
        const mediaChunk = buf.subarray(off, off + CHUNK_BYTES).toString("base64");
        if (!send({ realtimeInput: { mediaChunks: [{ mimeType, data: mediaChunk }] } })) {
          fail(new GeminiLiveError("Gemini Live socket closed while streaming audio", 502));
          return;
        }
        sentBytes = Math.min(off + CHUNK_BYTES, buf.length);
      }
      send({ clientContent: { turns: [{ parts: [{ text: systemText }] }], turnComplete: true } });
    };

    const scheduleGoAwayReconnect = (goAway) => {
      if (settled || goAwayTimer || goAwayReconnects <= 0) return;
      const deadline = Date.parse(typeof goAway?.time === "string" ? goAway.time : "");
      const delay = Number.isFinite(deadline)
        ? Math.max(0, Math.min(deadline - Date.now(), setupTimeoutMs))
        : 0;
      goAwayTimer = setTimeout(() => {
        goAwayTimer = null;
        if (settled) return;
        goAwayReconnects--;
        generation++;
        try { ws?.close(1000); } catch { }
        open();
      }, delay);
    };

    const open = () => {
      const gen = ++generation;
      try {
        ws = new WS(wsUrl);
      } catch {
        fail(new GeminiLiveError("Gemini Live websocket connection failed", 502));
        return;
      }
      bindSocket(ws, {
        onOpen: () => {
          if (settled || gen !== generation) return;
          arm(setupTimeoutMs, "Gemini Live timed out waiting for setupComplete");
          send({
            setup: {
              model: `models/${model}`,
              generationConfig: {
                responseModalities: ["TEXT"],
                inputAudioTranscription: {},
              },
              systemInstruction: { parts: [{ text: systemText }] },
            },
          });
        },
        onMessage: (ev) => {
          if (settled || gen !== generation) return;
          const frame = parseFrame(ev?.data);
          if (!frame) return;

          if (frame.error) {
            const e = frame.error;
            fail(new GeminiLiveError(`Gemini Live error${e.status ? ` (${e.status})` : ""}: ${e.message || "unknown"}`, 502));
            return;
          }
          if (frame.goAway) {
            scheduleGoAwayReconnect(frame.goAway);
            return;
          }

          const sc = frame.serverContent;
          if (!sc) return;

          const delta = typeof sc.inputTranscription?.text === "string" ? sc.inputTranscription.text : "";
          if (delta.trim()) {
            text += delta;
            chunks.push(delta);
          }

          if (sc.setupComplete) {
            arm(turnTimeoutMs, "Gemini Live transcription timed out");
            streamAudioAndPrompt();
            return;
          }
          if (sc.turnComplete) succeed();
        },
        onError: () => {
          if (settled || gen !== generation) return;
          fail(new GeminiLiveError("Gemini Live websocket connection failed", 502));
        },
        onClose: (ev) => {
          if (settled || gen !== generation) return;
          if (text.trim()) succeed();
          else fail(new GeminiLiveError(`Gemini Live socket closed before completion${ev?.code ? ` (code ${ev.code})` : ""}`, 502));
        },
      });
    };

    open();
  });
}
