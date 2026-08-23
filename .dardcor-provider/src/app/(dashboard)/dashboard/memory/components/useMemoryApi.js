/**
 * useMemoryApi — data hook for the Memory dashboard.
 *
 * Uses the existing /api/memory/* endpoints with userId="default".
 * The API contract:
 *   GET  /api/memory?userId=&sessionId=&limit=&offset= → { memories[] }
 *   POST /api/memory  { userId, content, metadata?, sessionId? } → { memory }
 *   DELETE /api/memory/[id]?userId= → { deleted: true }
 *   GET  /api/memory/search?userId=&q=&limit= → { memories[] }
 *   POST /api/memory/reindex → { indexed }
 *   GET  /api/memory/health → { ok, available, status, driver, entries, indexed, reason? }
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BASE = "/api/memory";
const USER_ID = "default";

export async function jsonFetch(url, options = {}) {
  const res = await fetch(url, { cache: "no-store", ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export function useMemoryApi() {
  // List state
  const [memories, setMemories] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [query, setQuery] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  // Health state
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState(null);

  // Action states
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(new Set());
  const [reindexing, setReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState(null);

  const abortRef = useRef(null);

  // ── Fetch memories (list or search) ─────────────────────────────
  const fetchMemories = useCallback(async (opts = {}) => {
    const p = opts.page ?? page;
    const q = opts.query ?? query;
    const ps = opts.pageSize ?? pageSize;

    // Cancel in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setListLoading(true);
    setListError(null);
    try {
      let data;
      if (q) {
        // Use search endpoint
        const params = new URLSearchParams({ userId: USER_ID, q, limit: String(ps) });
        data = await jsonFetch(`${BASE}/search?${params}`, { signal: controller.signal });
        setMemories(data.memories || []);
        setTotal((data.memories || []).length);
      } else {
        // Use list endpoint with offset pagination
        const offset = (p - 1) * ps;
        const params = new URLSearchParams({ userId: USER_ID, limit: String(ps), offset: String(offset) });
        data = await jsonFetch(`${BASE}?${params}`, { signal: controller.signal });
        setMemories(data.memories || []);
        // The API doesn't return total, so we estimate
        const fetched = (data.memories || []).length;
        setTotal(offset + fetched + (fetched === ps ? 1 : 0)); // rough estimate
      }
      setPage(p);
    } catch (err) {
      if (err.name !== "AbortError") {
        setListError(err.message || "Failed to load memories");
      }
    } finally {
      setListLoading(false);
    }
  }, [page, pageSize, query]);

  // ── Fetch health ────────────────────────────────────────────────
  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await jsonFetch(`${BASE}/health`);
      setHealth(data);
    } catch (err) {
      setHealthError(err.message || "Health check failed");
      setHealth({ ok: false });
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // ── Add memory ──────────────────────────────────────────────────
  const addMemory = useCallback(async ({ content, metadata }) => {
    setAdding(true);
    try {
      await jsonFetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID, content, metadata: metadata || {} }),
      });
      // Refresh list
      await fetchMemories({ page: 1 });
      setPage(1);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setAdding(false);
    }
  }, [fetchMemories]);

  // ── Delete memory ───────────────────────────────────────────────
  const deleteMemory = useCallback(async (id) => {
    setDeleting((prev) => new Set(prev).add(id));
    try {
      const params = new URLSearchParams({ userId: USER_ID });
      await jsonFetch(`${BASE}/${id}?${params}`, { method: "DELETE" });
      await fetchMemories();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [fetchMemories]);

  // ── Reindex ─────────────────────────────────────────────────────
  const reindex = useCallback(async () => {
    setReindexing(true);
    setReindexResult(null);
    try {
      const data = await jsonFetch(`${BASE}/reindex`, { method: "POST" });
      setReindexResult(data);
      await Promise.all([fetchMemories(), fetchHealth()]);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setReindexing(false);
    }
  }, [fetchMemories, fetchHealth]);

  // ── Search handler ──────────────────────────────────────────────
  const search = useCallback(async (q) => {
    setQuery(q);
    await fetchMemories({ query: q, page: 1 });
    setPage(1);
  }, [fetchMemories]);

  // ── Page change handler ─────────────────────────────────────────
  const goToPage = useCallback(async (p) => {
    setPage(p);
    await fetchMemories({ page: p });
  }, [fetchMemories]);

  // ── Initial load ────────────────────────────────────────────────
  useEffect(() => {
    fetchMemories();
    fetchHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // List
    memories,
    total,
    page,
    pageSize,
    query,
    listLoading,
    listError,
    fetchMemories,
    search,
    goToPage,
    // Health
    health,
    healthLoading,
    healthError,
    fetchHealth,
    // CRUD
    addMemory,
    adding,
    deleteMemory,
    deleting,
    // Reindex
    reindex,
    reindexing,
    reindexResult,
  };
}
