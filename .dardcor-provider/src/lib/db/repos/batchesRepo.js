import { getAdapter } from "../driver.js";

const map = (row) => row && ({ ...row, inputBytes: Number(row.inputBytes), recordCount: Number(row.recordCount), attempts: Number(row.attempts) });

export async function createBatch(row) {
  const db = await getAdapter();
  db.run(`INSERT INTO batchJobs(id,model,provider,status,inputPath,resultPath,errorPath,inputBytes,recordCount,totalRequests,attempts,error,createdAt,updatedAt,startedAt,completedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id,row.provider,row.provider,row.status,row.inputPath,row.resultPath,row.errorPath,row.inputBytes,row.recordCount,row.recordCount,row.attempts,row.error,row.createdAt,row.updatedAt,row.startedAt,row.completedAt]);
  return map(row);
}
export async function getBatch(id) { return map((await getAdapter()).get(`SELECT * FROM batchJobs WHERE id = ?`, [id])); }
export async function listBatches(limit = 100) { return (await getAdapter()).all(`SELECT * FROM batchJobs ORDER BY createdAt DESC LIMIT ?`, [Math.min(Math.max(Number(limit) || 100, 1), 500)]).map(map); }
export async function updateBatch(id, changes) {
  const db = await getAdapter(); const current = db.get(`SELECT * FROM batchJobs WHERE id = ?`, [id]); if (!current) return null;
  const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
  db.run(`UPDATE batchJobs SET status=?,attempts=?,error=?,updatedAt=?,startedAt=?,completedAt=? WHERE id=?`, [next.status,next.attempts,next.error,next.updatedAt,next.startedAt,next.completedAt,id]);
  return map(next);
}
export async function deleteBatch(id) {
  const db = await getAdapter();
  const current = db.get(`SELECT * FROM batchJobs WHERE id = ?`, [id]);
  if (!current) return null;
  db.run(`DELETE FROM batchJobs WHERE id = ?`, [id]);
  return map(current);
}
export async function removeExpiredBatches(cutoff, maxRetained) {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM batchJobs WHERE status IN ('completed','failed','canceled') ORDER BY createdAt DESC`);
  const removed = rows.filter((row, index) => row.completedAt < cutoff || index >= maxRetained);
  for (const row of removed) db.run(`DELETE FROM batchJobs WHERE id = ?`, [row.id]);
  return removed.map(map);
}
