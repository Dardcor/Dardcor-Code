/**
 * MemoryPageClient — main client component for the Memory dashboard page.
 *
 * Renders:
 *   - Page header with search and actions
 *   - Health status card (entries, indexed, driver, FTS status)
 *   - Memory list with loading/error/empty states
 *   - Add memory modal
 *   - Reindex action with result feedback
 */

"use client";

import { useCallback, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { useMemoryApi } from "./useMemoryApi";
import MemoryTable from "./MemoryTable";
import AddMemoryModal from "./AddMemoryModal";

export default function MemoryPageClient() {
  const notify = useNotificationStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchInput, setSearchInput] = useState("");

  const {
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
  } = useMemoryApi();

  const handleSearch = useCallback(
    (e) => {
      e?.preventDefault?.();
      search(searchInput);
    },
    [search, searchInput]
  );

  const handleAdd = useCallback(
    async ({ content, metadata }) => {
      const result = await addMemory({ content, metadata });
      if (result.ok) {
        notify.success("Memory added successfully");
      } else {
        notify.error(result.error || "Failed to add memory");
      }
      return result;
    },
    [addMemory, notify]
  );

  const handleDelete = useCallback(
    async (id) => {
      const result = await deleteMemory(id);
      if (result.ok) {
        notify.success("Memory deleted");
      } else {
        notify.error(result.error || "Failed to delete memory");
      }
    },
    [deleteMemory, notify]
  );

  const handleReindex = useCallback(async () => {
    const result = await reindex();
    if (result.ok) {
      notify.success(`Reindex complete — ${result.data.indexed} entries indexed`);
    } else {
      notify.error(result.error || "Reindex failed");
    }
  }, [reindex, notify]);

  const handleRefreshAll = useCallback(() => {
    fetchMemories();
    fetchHealth();
  }, [fetchMemories, fetchHealth]);

  const isHealthy = health?.ok === true;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            <span className="material-symbols-outlined text-primary">psychology</span>
            Memory
          </h1>
          <p className="text-sm text-text-muted">
            Store and search semantic memories powered by FTS5 full-text search.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshAll}
            disabled={listLoading || healthLoading}
            icon="refresh"
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReindex}
            loading={reindexing}
            icon="sync"
          >
            Reindex
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAddModal(true)}
            icon="add"
          >
            Add Memory
          </Button>
        </div>
      </div>

      {/* ── Health Status ───────────────────────────────────────── */}
      {healthLoading && !health ? (
        <CardSkeleton />
      ) : health ? (
        <Card
          title="Memory Health"
          icon="health_and_safety"
          padding="sm"
          className={isHealthy ? "" : "border-error/30"}
        >
          <div className="flex flex-wrap items-center gap-4">
            <Badge variant={isHealthy ? "success" : "error"} dot size="sm">
              {isHealthy ? "Healthy" : "Degraded"}
            </Badge>
            {health.driver && (
              <span className="text-xs text-text-muted">
                Driver: <span className="font-medium text-text-main">{health.driver}</span>
              </span>
            )}
            {typeof health.entries === "number" && (
              <span className="text-xs text-text-muted">
                Entries: <span className="font-medium text-text-main">{health.entries}</span>
              </span>
            )}
            {typeof health.indexed === "number" && (
              <span className="text-xs text-text-muted">
                Indexed: <span className="font-medium text-text-main">{health.indexed}</span>
              </span>
            )}
          </div>
        </Card>
      ) : null}

      {/* ── Reindex Feedback ────────────────────────────────────── */}
      {reindexResult && !reindexing && (
        <Card padding="sm" className="border-brand-500/20 bg-brand-500/5">
          <div className="flex items-center gap-2 text-sm">
            <span className="material-symbols-outlined text-brand-500 text-[18px]">check_circle</span>
            <span className="text-text-main">
              Reindexed <strong>{reindexResult.indexed}</strong> entries into FTS5 index
            </span>
          </div>
        </Card>
      )}

      {/* ── Search Bar ──────────────────────────────────────────── */}
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="flex-1">
          <Input
            icon="search"
            placeholder="Search memories by content…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Button variant="secondary" size="md" type="submit" disabled={listLoading}>
          Search
        </Button>
        {query && (
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              setSearchInput("");
              search("");
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {/* ── Memory List ─────────────────────────────────────────── */}
      <MemoryTable
        memories={memories}
        loading={listLoading}
        error={listError}
        deleting={deleting}
        onDelete={handleDelete}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={goToPage}
        onRefresh={fetchMemories}
        isSearch={!!query}
      />

      {/* ── Add Memory Modal ────────────────────────────────────── */}
      <AddMemoryModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAdd}
        loading={adding}
      />
    </div>
  );
}
