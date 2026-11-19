export function safeApply(fn, text) {
  if (typeof fn !== "function") return text;
  try {
    const out = fn(text);
    if (typeof out !== "string") return text;
    return out;
  } catch (err) {
    const name = fn.filterName || fn.name || "anonymous";
    console.warn(`[rtk] warning: filter '${name}' panicked — passing through raw output: ${err?.message || err}`);
    return text;
  }
}
