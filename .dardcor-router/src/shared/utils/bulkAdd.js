
function parseLine(line, opts = {}) {
  const { isCloudflareAi = false } = opts;
  const parts = line.split("|");

  if (isCloudflareAi && parts.length >= 3) {
    const baseName = parts[0].trim();
    const apiKey = parts.slice(1, -1).join("|").trim();
    const accountId = parts[parts.length - 1].trim();
    return {
      baseName: baseName || "Key",
      apiKey,
      providerSpecificData: { accountId },
    };
  }

  if (parts.length >= 2) {
    const baseName = parts[0].trim();
    const apiKey = parts.slice(1).join("|").trim();
    return { baseName: baseName || "Key", apiKey };
  }

  const apiKey = parts[0].trim();
  return { baseName: "Key", apiKey };
}

export function planBulkAdd(lines, existingNames, opts = {}) {
  const { isCloudflareAi = false } = opts;

  const safeExisting = Array.isArray(existingNames) ? existingNames : [];
  const used = new Set(safeExisting.map((n) => (typeof n === "string" ? n.toLowerCase() : "")));

  const out = [];
  for (const raw of lines) {
    const line = typeof raw === "string" ? raw.trim() : "";
    if (!line) continue;

    const parsed = parseLine(line, { isCloudflareAi });
    if (!parsed || !parsed.apiKey) continue;

    const base = parsed.baseName;

    let idx = 1;
    let name;
    for (;;) {
      name = `${base} ${idx}`;
      if (!used.has(name.toLowerCase())) break;
      idx += 1;
    }
    used.add(name.toLowerCase());

    const entry = { name, apiKey: parsed.apiKey, skipped: false };
    if (parsed.providerSpecificData) entry.providerSpecificData = parsed.providerSpecificData;
    out.push(entry);
  }
  return out;
}
