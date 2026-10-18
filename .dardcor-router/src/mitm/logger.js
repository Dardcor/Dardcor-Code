const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DATA_DIR } = require("./paths");
const { LOG_BLACKLIST_URL_PARTS } = require("./config");

function time() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const log = (msg) => console.log(`[${time()}] [MITM] ${msg}`);
const err = (msg) => console.error(`[${time()}] ❌ [MITM] ${msg}`);

const DUMP_DIR = path.join(DATA_DIR, "logs", "mitm");
if (!fs.existsSync(DUMP_DIR)) fs.mkdirSync(DUMP_DIR, { recursive: true });

function clearDumpDir() {
  try {
    if (!fs.existsSync(DUMP_DIR)) return;
    for (const f of fs.readdirSync(DUMP_DIR)) {
      try { fs.rmSync(path.join(DUMP_DIR, f), { recursive: true, force: true }); } catch { }
    }
  } catch { }
}

const EMPTY_BODY_RE = /^\s*(\{\s*\}|\[\s*\]|null)?\s*$/;

function slugify(s, max = 80) {
  return String(s).replace(/[^a-zA-Z0-9]/g, "_").substring(0, max);
}

function isBlacklisted(url) {
  if (!url) return false;
  return LOG_BLACKLIST_URL_PARTS.some(part => url.includes(part));
}

function decodeBody(buf, encoding) {
  if (!buf || buf.length === 0) return buf;
  try {
    const enc = (encoding || "").toLowerCase();
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf);
    if (enc.includes("deflate")) return zlib.inflateSync(buf);
  } catch { }
  return buf;
}

function dumpRequest(req, bodyBuffer, tag = "raw") {
  if (isBlacklisted(req.url)) return null;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = slugify((req.headers.host || "") + req.url);
    const file = path.join(DUMP_DIR, `${ts}_${tag}_${slug}.req.json`);
    let parsed = null;
    try { parsed = JSON.parse(bodyBuffer.toString()); } catch { }
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
        if (EMPTY_BODY_RE.test(text)) return;
        const cleanHeaders = { ...headers };
        delete cleanHeaders["content-encoding"];
        delete cleanHeaders["Content-Encoding"];
        const out = `STATUS: ${status}\nHEADERS: ${JSON.stringify(cleanHeaders, null, 2)}\n---BODY---\n${text}`;
        fs.writeFileSync(file, out);
      } catch { }
    },
    file
  };
}

module.exports = { log, err, dumpRequest, createResponseDumper, clearDumpDir };
