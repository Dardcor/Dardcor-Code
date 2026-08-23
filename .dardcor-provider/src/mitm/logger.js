const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { DATA_DIR } = require("./paths");
const { LOG_BLACKLIST_URL_PARTS } = require("./config");

function time() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const log = (msg) => console.log(`[${time()}] [MITM] ${msg}`);
const err = (msg) => console.error(`[${time()}] ❌ [MITM] ${msg}`);

const DUMP_DIR = path.join(DATA_DIR, "logs", "mitm");
if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR, { recursive: true });

// Clear all files inside DUMP_DIR (called on MITM server start to avoid unbounded growth)
function clearDumpDir() {
  try {
    if (!fs.existsSync(DUMP_DIR)) return;
    for (const f of fs.readdirSync(DUMP_DIR)) {
      try { fs.rmSync(path.join(DUMP_DIR, f), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

const EMPTY_BODY_RE = /^\s*(\{\s*\}|\[\s*\]|null)?\s*$/;

function slugify(s, max = 80) {
  return String(s).replace(/[^a-zA-Z0-9]/g, "_").substring(0, max);
}

function isBlacklisted(url) {
  if (!url) return false;
  return LOG_BLACKLIST_URL_PARTS.some(part => url.includes(part));
}

// Decode body buffer based on content-encoding header
function decodeBody(buf, encoding) {
  if (!buf || buf.length === 0) return buf;
  try {
    const enc = (encoding || "").toLowerCase();
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf);
    if (enc.includes("deflate")) return zlib.inflateSync(buf);
  } catch { /* return raw on failure */ }
  return buf;
}

// Save raw request: method + url + headers + body
function dumpRequest(req, bodyBuffer, tag = "raw") {
  if (isBlacklisted(req.url)) return null;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = slugify((req.headers.host || "") + req.url);
    const file = path.join(DUMP_DIR, `${ts}_${tag}_${slug}.req.json`);
    let parsed = null;
    try { parsed = JSON.parse(bodyBuffer.toString()); } catch { /* not JSON */ }
    fs.writeFileSync(file, JSON.stringify({
      method: req.method,
      url: req.url,
      host: req.headers.host,
      headers: req.headers,
      body: parsed ?? bodyBuffer.toString("utf8")
    }, null, 2));
    return file;
  } catch { return null; }
}

// Buffer-based response dumper — collects chunks then decodes + writes once on end()
// Trade-off: holds response in RAM, but enables gzip/br decoding for readable output.
function createResponseDumper(req, tag = "raw") {
  if (isBlacklisted(req.url)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = slugify((req.headers.host || "") + req.url);
  const file = path.join(DUMP_DIR, `${ts}_${tag}_${slug}.res.txt`);
  let status = 0;
  let headers = {};
  const chunks = [];
  return {
    writeHeader: (s, h) => { status = s; headers = h || {}; },
    writeChunk: (chunk) => {
      if (chunk == null) return;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
    end: () => {
      try {
        const raw = Buffer.concat(chunks);
        const enc = headers["content-encoding"] || headers["Content-Encoding"];
        const decoded = decodeBody(raw, enc);
        const text = decoded.toString("utf8");
        // Skip empty / trivially-empty bodies
        if (EMPTY_BODY_RE.test(text)) return;
        // Strip content-encoding since body is now decoded
        const cleanHeaders = { ...headers };
        delete cleanHeaders["content-encoding"];
        delete cleanHeaders["Content-Encoding"];
        const out = `STATUS: ${status}\nHEADERS: ${JSON.stringify(cleanHeaders, null, 2)}\n---BODY---\n${text}`;
        fs.writeFileSync(file, out);
      } catch { /* ignore */ }
    },
    file
  };
}

// ── Privacy-bounded Cursor AgentService capture ───────────────
// Opt-in, local-only, byte-transparent relay capture. Inactive unless
// MITM_CURSOR_CAPTURE=1. Metadata-only by default; raw protobuf bytes are
// retained only when MITM_CURSOR_CAPTURE_FULL=1 (explicit second consent).
// Never logs header/token/cookie/body VALUES — only counts, flags, status,
// error, and header/trailer NAMES. Fail-open: capture errors never break or
// slow the relay (synchronous bounded memory/file work at end only).

const CURSOR_CAPTURE_ENABLED = process.env.MITM_CURSOR_CAPTURE === "1";
const CURSOR_CAPTURE_FULL = process.env.MITM_CURSOR_CAPTURE_FULL === "1";
const CURSOR_CAPTURE_DIR = path.join(DATA_DIR, "logs", "mitm", "cursor-capture");
const REQUEST_CAP_BYTES = 4 * 1024 * 1024;   // 4 MiB
const RESPONSE_CAP_BYTES = 16 * 1024 * 1024; // 16 MiB

function stripQuery(url) {
  if (!url) return "";
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

/**
 * Returns null when disabled (capture fully inactive). Otherwise returns an
 * idempotent handle exposing writeRequestChunk / writeResponseChunk /
 * setResponse / setTrailers / error / end. In metadata-only mode no body
 * chunks are retained in memory — only running byte counts.
 */
function createCursorCapture(req) {
  if (!CURSOR_CAPTURE_ENABLED) return null;
  const full = CURSOR_CAPTURE_FULL;
  // Collision-resistant local ID (timestamp + random bytes); never derived from
  // prompt, auth, URL query data, or host strings.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
  const base = path.join(CURSOR_CAPTURE_DIR, `${ts}_${id}`);
  const metaFile = `${base}.meta.json`;
  const reqFile = `${base}.request.bin`;
  const resFile = `${base}.response.bin`;

  // Raw chunks retained only under explicit full-consent flag (memory-bounded).
  const reqChunks = full ? [] : null;
  const resChunks = full ? [] : null;
  let reqCaptured = 0;
  let resCaptured = 0;

  const meta = {
    timestamp: new Date().toISOString(),
    method: req.method,
    pathname: stripQuery(req.url),
    byteCounts: { request: 0, response: 0 },
    capturedByteCounts: { request: 0, response: 0 },
    truncated: { request: false, response: false },
    responseStatus: null,
    responseHeaderNames: [],
    trailerNames: [],
    error: null,
  };

  let ended = false;
  try {
    fs.mkdirSync(CURSOR_CAPTURE_DIR, { recursive: true, mode: 0o700 });
  } catch { /* fail-open */ }

  return {
    writeRequestChunk(chunk) {
      if (ended || chunk == null) return;
      meta.byteCounts.request += chunk.length;
      if (!reqChunks) return;
      // Enforce cap while receiving: slice the last accepted chunk, never buffer unbounded.
      if (reqCaptured >= REQUEST_CAP_BYTES) { meta.truncated.request = true; return; }
      const space = REQUEST_CAP_BYTES - reqCaptured;
      const part = chunk.length > space ? chunk.subarray(0, space) : chunk;
      reqChunks.push(part);
      reqCaptured += part.length;
      if (chunk.length > space) meta.truncated.request = true;
    },
    writeResponseChunk(chunk) {
      if (ended || chunk == null) return;
      meta.byteCounts.response += chunk.length;
      if (!resChunks) return;
      if (resCaptured >= RESPONSE_CAP_BYTES) { meta.truncated.response = true; return; }
      const space = RESPONSE_CAP_BYTES - resCaptured;
      const part = chunk.length > space ? chunk.subarray(0, space) : chunk;
      resChunks.push(part);
      resCaptured += part.length;
      if (chunk.length > space) meta.truncated.response = true;
    },
    setResponse(status, headerNames) {
      if (ended) return;
      meta.responseStatus = status;
      meta.responseHeaderNames = (headerNames || []).map(String); // names only, never values
    },
    setTrailers(names) {
      if (ended) return;
      meta.trailerNames = (names || []).map(String); // names only, never values
    },
    error(msg) {
      if (ended || !msg) return;
      meta.error = String(msg).slice(0, 1000);
    },
    end() {
      if (ended) return;
      ended = true;
      try {
        meta.capturedByteCounts.request = reqCaptured;
        meta.capturedByteCounts.response = resCaptured;
        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), { mode: 0o600 });
        if (reqChunks && reqCaptured > 0) fs.writeFileSync(reqFile, Buffer.concat(reqChunks), { mode: 0o600 });
        if (resChunks && resCaptured > 0) fs.writeFileSync(resFile, Buffer.concat(resChunks), { mode: 0o600 });
      } catch { /* fail-open: capture I/O errors never break the relay */ }
    },
  };
}

module.exports = { log, err, dumpRequest, createResponseDumper, clearDumpDir, createCursorCapture };
