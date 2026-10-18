
const QODER_STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const QODER_CUSTOM_ALPHABET = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";

const QODER_S2C = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) {
    table[QODER_STD_ALPHABET.charCodeAt(i)] = QODER_CUSTOM_ALPHABET.charCodeAt(i);
  }
  table["=".charCodeAt(0)] = "$".charCodeAt(0);
  return table;
})();

export function qoderEncodeBody(plaintext) {
  const buf = Buffer.isBuffer(plaintext)
    ? plaintext
    : typeof plaintext === "string"
      ? Buffer.from(plaintext, "utf8")
      : Buffer.from(plaintext);

  const std = buf.toString("base64");
  const n = std.length;
  const a = Math.floor(n / 3);
  const rearranged = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a);

  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const c = rearranged.charCodeAt(i);
    if (c < 128 && QODER_S2C[c] >= 0) {
      out[i] = QODER_S2C[c];
    } else {
      out[i] = c;
    }
  }
  return out.toString("latin1");
}
