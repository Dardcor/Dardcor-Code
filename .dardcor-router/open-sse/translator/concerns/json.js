export function safeParseJSON(str, fallback) {
  if (typeof str !== "string") return str;
  try { return JSON.parse(str); } catch { return fallback; }
}
