import { describe, expect, it, vi } from "vitest";
import migration from "../../src/lib/db/migrations/002-memory-fts.js";

describe("memory FTS5 migration fallback", () => {
  it("creates the memory table but skips all FTS objects when FTS5 is unavailable", () => {
    const statements = [];
    const db = {
      exec: vi.fn((sql) => {
        statements.push(sql);
        if (sql.includes("__memory_fts5_probe")) throw new Error("no such module: fts5");
      }),
    };

    expect(() => migration.up(db)).not.toThrow();
    expect(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS memories"))).toBe(true);
    expect(statements.some((sql) => sql.includes("CREATE TRIGGER"))).toBe(false);
    expect(statements.some((sql) => sql.includes("memoryFts(memoryFts)"))).toBe(false);
  });
});
