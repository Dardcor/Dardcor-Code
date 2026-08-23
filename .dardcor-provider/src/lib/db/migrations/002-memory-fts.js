import { TABLES, buildCreateTableSql } from "../schema.js";

function hasFts5(db) {
  try {
    db.exec("CREATE VIRTUAL TABLE temp.__memory_fts5_probe USING fts5(content)");
    db.exec("DROP TABLE temp.__memory_fts5_probe");
    return true;
  } catch {
    return false;
  }
}

export default {
  version: 2,
  name: "memory-fts5",
  up(db) {
    db.exec(buildCreateTableSql("memories", TABLES.memories));
    for (const index of TABLES.memories.indexes) db.exec(index);
    if (!hasFts5(db)) return;

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memoryFts USING fts5(
        content,
        content='memories',
        content_rowid='rowid',
        tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memoryFts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memoryFts(memoryFts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content ON memories BEGIN
        INSERT INTO memoryFts(memoryFts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO memoryFts(rowid, content) VALUES (new.rowid, new.content);
      END;
      INSERT INTO memoryFts(memoryFts) VALUES ('rebuild');
    `);
  },
};
