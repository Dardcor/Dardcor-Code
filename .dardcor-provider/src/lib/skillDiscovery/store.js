import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";

// Ownership/install records live as a JSON file under DATA_DIR. The path is
// never returned in API responses — only record contents (ids, targets,
// relative owned files) are surfaced.
export const DEFAULT_STORE_PATH = path.join(DATA_DIR, "skill-install-records.json");

/**
 * Create an install-record store. `filePath` is injectable so tests can point
 * at a temp file without touching the real registry.
 */
export function createInstallStore(filePath = DEFAULT_STORE_PATH) {
  async function read() {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async function write(records) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(records, null, 2), "utf8");
    await fs.rename(tmp, filePath);
  }

  return {
    async list() {
      return read();
    },
    async get(id) {
      return (await read()).find((r) => r.id === id) || null;
    },
    async upsert(record) {
      const records = await read();
      const idx = records.findIndex((r) => r.id === record.id);
      if (idx >= 0) records[idx] = record;
      else records.push(record);
      await write(records);
      return record;
    },
    async removeTarget(id, target) {
      const records = await read();
      const idx = records.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const record = records[idx];
      record.targets = (record.targets || []).filter((t) => t.id !== target);
      if (record.targets.length === 0) records.splice(idx, 1);
      else records[idx] = record;
      await write(records);
      return record;
    },
  };
}

export const __test__ = { DEFAULT_STORE_PATH };
