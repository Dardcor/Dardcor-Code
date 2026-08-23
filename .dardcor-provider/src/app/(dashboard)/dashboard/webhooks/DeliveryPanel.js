"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal, Badge, Button, Skeleton } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

/* ── Helpers ──────────────────────────────────────────────────────── */

function timeAgo(ts) {
  if (!ts) return "—";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function formatTimestamp(ts) {
  if (!ts) return "—";
  try {
    const d = typeof ts === "string" ? new Date(ts) : new Date(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

function statusBadge(status) {
  switch (status) {
    case "delivered":
      return (
        <Badge variant="success" size="sm" dot>
          Delivered
        </Badge>
      );
    case "delivering":
      return (
        <Badge variant="info" size="sm" dot>
          Delivering
        </Badge>
      );
    case "retrying":
      return (
        <Badge variant="warning" size="sm" dot>
          Retrying
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="default" size="sm" dot>
          Pending
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="error" size="sm" dot>
          Failed
        </Badge>
      );
    case "duplicate":
      return (
        <Badge variant="default" size="sm">
          Duplicate
        </Badge>
      );
    case "queue_full":
      return (
        <Badge variant="error" size="sm">
          Queue Full
        </Badge>
      );
    default:
      return <Badge variant="default" size="sm">{status}</Badge>;
  }
}

/* ── Delivery Detail ──────────────────────────────────────────────── */

function DeliveryDetail({ delivery }) {
  if (!delivery) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        {statusBadge(delivery.status)}
        {delivery.attempts > 0 && (
          <span className="text-xs text-text-muted">
            attempt {delivery.attempts}
          </span>
        )}
        {delivery.responseStatus > 0 && (
          <span className="text-xs font-mono text-text-muted">
            HTTP {delivery.responseStatus}
          </span>
        )}
        {delivery.error && (
          <span className="text-xs text-red-500">{delivery.error}</span>
        )}
      </div>

      {delivery.event && (
        <div>
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
            Event
          </h4>
          <code className="text-xs font-mono text-text-main bg-surface-2 px-2 py-1 rounded inline-block">
            {delivery.event}
          </code>
        </div>
      )}

      {delivery.createdAt && (
        <div>
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
            Created
          </h4>
          <p className="text-xs text-text-muted">
            {formatTimestamp(delivery.createdAt)}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Main Delivery Panel ──────────────────────────────────────────── */

export default function DeliveryPanel({ webhook, onClose }) {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // The [id] GET route returns { webhook, deliveries } in one call
      const res = await fetch(`/api/webhooks/${webhook.id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setDeliveries(data.deliveries || []);
    } catch (err) {
      setError(err.message || "Failed to load deliveries");
    } finally {
      setLoading(false);
    }
  }, [webhook.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Deliveries — ${webhook.name}`}
      size="full"
    >
      <div className="flex flex-col gap-4">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted">
            {loading ? "Loading…" : `${deliveries.length} deliveries`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={loading}
            icon="refresh"
          >
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : deliveries.length === 0 ? (
          <div className="text-center py-8">
            <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3 block">
              send
            </span>
            <p className="text-sm text-text-muted">No deliveries yet</p>
            <p className="text-xs text-text-muted mt-1">
              Deliveries appear here once events are triggered for this webhook.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto custom-scrollbar -mx-1 px-1">
            {deliveries.map((dlv, idx) => {
              const id = dlv.id || `dlv-${idx}`;
              const isExpanded = selected === id;
              return (
                <div key={id}>
                  <button
                    onClick={() => setSelected(isExpanded ? null : id)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left cursor-pointer",
                      isExpanded
                        ? "bg-surface-2 border border-border"
                        : "bg-surface-2/50 border border-transparent hover:bg-surface-2 hover:border-border-subtle"
                    )}
                  >
                    {/* Status dot */}
                    <div
                      className={cn(
                        "size-2 rounded-full shrink-0",
                        dlv.status === "delivered" && "bg-green-500",
                        dlv.status === "failed" && "bg-red-500",
                        dlv.status === "retrying" && "bg-yellow-500",
                        dlv.status === "delivering" && "bg-blue-500",
                        dlv.status === "pending" && "bg-gray-400",
                        dlv.status === "duplicate" && "bg-gray-300"
                      )}
                    />

                    {/* Event name */}
                    <code className="text-xs font-mono text-text-main shrink-0">
                      {dlv.event || "—"}
                    </code>

                    {/* Spacer */}
                    <span className="flex-1" />

                    {/* Status badge */}
                    {statusBadge(dlv.status)}

                    {/* HTTP status */}
                    {dlv.responseStatus > 0 && (
                      <span className="text-[11px] font-mono text-text-muted shrink-0">
                        {dlv.responseStatus}
                      </span>
                    )}

                    {/* Attempts */}
                    {dlv.attempts > 1 && (
                      <span className="text-[10px] text-text-muted shrink-0">
                        ×{dlv.attempts}
                      </span>
                    )}

                    {/* Timestamp */}
                    <span className="text-[11px] text-text-muted shrink-0">
                      {dlv.createdAt
                        ? timeAgo(
                            typeof dlv.createdAt === "string"
                              ? new Date(dlv.createdAt).getTime()
                              : dlv.createdAt
                          )
                        : "—"}
                    </span>

                    {/* Expand indicator */}
                    <span
                      className="material-symbols-outlined text-[16px] text-text-muted transition-transform shrink-0"
                      style={{
                        transform: isExpanded
                          ? "rotate(180deg)"
                          : "rotate(0)",
                      }}
                    >
                      expand_more
                    </span>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="mt-1 ml-5 mr-1 mb-2 p-3 rounded-lg bg-surface border border-border-subtle">
                      <DeliveryDetail delivery={dlv} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
