import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { maskWebhookSecret } from "../../webhooks/response.js";

const mapWebhook = (row, includeSecret = false) => row && ({
  id: row.id, name: row.name, url: row.url, events: parseJson(row.events, []),
  isActive: row.isActive === 1, secretConfigured: Boolean(row.secret),
  secretPreview: maskWebhookSecret(row.secret),
  ...(includeSecret ? { secret: row.secret } : {}),
  createdAt: row.createdAt, updatedAt: row.updatedAt,
});

export async function listWebhooks() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM webhooks ORDER BY createdAt DESC`).map((r) => mapWebhook(r));
}

export async function getWebhook(id, { includeSecret = false } = {}) {
  const db = await getAdapter();
  return mapWebhook(db.get(`SELECT * FROM webhooks WHERE id = ?`, [id]), includeSecret);
}

export async function listActiveWebhooksForEvent(event) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM webhooks WHERE isActive = 1`).map((r) => mapWebhook(r, true)).filter((w) => w.events.includes(event));
}

export async function createWebhook(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const webhook = { id: crypto.randomUUID(), ...data, secret: data.secret || crypto.randomBytes(32).toString("hex"), createdAt: now, updatedAt: now };
  db.run(`INSERT INTO webhooks(id,name,url,events,secret,isActive,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)`,
    [webhook.id, webhook.name, webhook.url, stringifyJson(webhook.events), webhook.secret, webhook.isActive === false ? 0 : 1, now, now]);
  return mapWebhook({ ...webhook, events: stringifyJson(webhook.events), isActive: webhook.isActive === false ? 0 : 1 }, true);
}

export async function updateWebhook(id, changes) {
  const db = await getAdapter();
  const current = mapWebhook(db.get(`SELECT * FROM webhooks WHERE id = ?`, [id]), true);
  if (!current) return null;
  const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
  db.run(`UPDATE webhooks SET name=?,url=?,events=?,secret=?,isActive=?,updatedAt=? WHERE id=?`,
    [next.name, next.url, stringifyJson(next.events), next.secret, next.isActive ? 1 : 0, next.updatedAt, id]);
  next.secretPreview = maskWebhookSecret(next.secret);
  delete next.secret;
  next.secretConfigured = true;
  return next;
}

export async function deleteWebhook(id) {
  const db = await getAdapter();
  return db.run(`DELETE FROM webhooks WHERE id = ?`, [id]).changes > 0;
}

export async function createWebhookDelivery(delivery) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const result = db.run(`INSERT OR IGNORE INTO webhookDeliveries(id,webhookId,event,idempotencyKey,status,attempts,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)`,
    [delivery.id, delivery.webhookId, delivery.event, delivery.idempotencyKey, "pending", 0, now, now]);
  return result.changes > 0;
}

export async function updateWebhookDelivery(id, changes) {
  const db = await getAdapter();
  db.run(`UPDATE webhookDeliveries SET status=?,attempts=?,responseStatus=?,error=?,updatedAt=? WHERE id=?`,
    [changes.status, changes.attempts, changes.responseStatus ?? null, changes.error ?? null, new Date().toISOString(), id]);
}

export async function listWebhookDeliveries(webhookId, limit = 100) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM webhookDeliveries WHERE webhookId = ? ORDER BY createdAt DESC LIMIT ?`, [webhookId, limit]);
}
