"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Badge, Toggle, ConfirmModal, CardSkeleton } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { cn } from "@/shared/utils/cn";
import WebhookFormModal from "./WebhookFormModal";
import DeliveryPanel from "./DeliveryPanel";
import SecretManager from "./SecretManager";

/* ── Helpers ──────────────────────────────────────────────────────── */

function timeAgo(ts) {
  if (!ts) return "never";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/* ── Summary Stats ────────────────────────────────────────────────── */

function SummaryStats({ webhooks, loading }) {
  const active = webhooks.filter((w) => w.isActive).length;
  const withSecret = webhooks.filter((w) => w.secretConfigured).length;

  const items = [
    {
      title: "Webhooks",
      value: loading ? "—" : webhooks.length,
      icon: "webhook",
      sub: loading ? "" : `${active} active`,
    },
    {
      title: "Active",
      value: loading ? "—" : active,
      icon: "check_circle",
      accent: active > 0 ? "text-green-600" : "text-text-muted",
      sub: loading ? "" : `of ${webhooks.length} total`,
    },
    {
      title: "Signed",
      value: loading ? "—" : withSecret,
      icon: "key",
      sub: "with signing secret",
    },
    {
      title: "Event Types",
      value: loading ? "—" : "4",
      icon: "bolt",
      sub: "available events",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.title} padding="sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-1.5 rounded-md bg-bg text-text-muted">
              <span className="material-symbols-outlined text-[18px]">
                {item.icon}
              </span>
            </div>
            <span className="text-xs text-text-muted">{item.title}</span>
          </div>
          <p
            className={cn(
              "text-2xl font-semibold",
              item.accent || "text-text-main"
            )}
          >
            {item.value}
          </p>
          {item.sub && (
            <p className="text-[11px] text-text-muted mt-0.5">{item.sub}</p>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ── Webhook Card ─────────────────────────────────────────────────── */

function WebhookCard({
  webhook,
  onEdit,
  onDelete,
  onToggle,
  onViewDeliveries,
  onManageSecret,
}) {
  return (
    <Card
      padding="sm"
      className={cn(
        "transition-opacity",
        !webhook.isActive && "opacity-60"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: icon + info */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={cn(
              "size-9 rounded-lg flex items-center justify-center shrink-0",
              webhook.isActive
                ? "bg-brand-500/10 text-brand-600"
                : "bg-surface-3 text-text-muted"
            )}
          >
            <span className="material-symbols-outlined text-[18px]">
              webhook
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm text-text-main truncate">
                {webhook.name}
              </h3>
              <Badge
                variant={webhook.isActive ? "success" : "default"}
                size="sm"
                dot
              >
                {webhook.isActive ? "Active" : "Disabled"}
              </Badge>
              {webhook.secretConfigured && (
                <Badge variant="info" size="sm" icon="key">
                  Signed
                </Badge>
              )}
            </div>
            <p className="text-xs text-text-muted mt-0.5 font-mono truncate">
              {webhook.url}
            </p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {webhook.events.map((evt) => (
                <span
                  key={evt}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-2 text-text-muted border border-border-subtle"
                >
                  {evt}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right: toggle + actions */}
        <div className="flex items-center gap-2 sm:flex-col sm:items-end shrink-0">
          <Toggle
            checked={webhook.isActive}
            onChange={() => onToggle(webhook)}
            size="sm"
            ariaLabel={`${webhook.isActive ? "Disable" : "Enable"} ${webhook.name}`}
          />
          <div className="flex items-center gap-1">
            <button
              onClick={() => onViewDeliveries(webhook)}
              className="p-1.5 rounded text-text-muted hover:text-blue-600 hover:bg-blue-500/10 transition-colors"
              title="View deliveries"
            >
              <span className="material-symbols-outlined text-[16px]">
                history
              </span>
            </button>
            <button
              onClick={() => onManageSecret(webhook)}
              className="p-1.5 rounded text-text-muted hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
              title="Manage signing secret"
            >
              <span className="material-symbols-outlined text-[16px]">key</span>
            </button>
            <button
              onClick={() => onEdit(webhook)}
              className="p-1.5 rounded text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
              title="Edit"
            >
              <span className="material-symbols-outlined text-[16px]">
                edit
              </span>
            </button>
            <button
              onClick={() => onDelete(webhook)}
              className="p-1.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              title="Delete"
            >
              <span className="material-symbols-outlined text-[16px]">
                delete
              </span>
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Empty State ──────────────────────────────────────────────────── */

function EmptyState({ onCreate }) {
  return (
    <Card padding="lg">
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
          <span className="material-symbols-outlined text-[32px]">
            webhook
          </span>
        </div>
        <p className="text-text-main font-medium mb-1">No webhooks yet</p>
        <p className="text-sm text-text-muted mb-4 max-w-sm">
          Get notified when things happen in your router — request failures,
          provider outages, and quota events.
        </p>
        <Button icon="add" onClick={onCreate} className="w-full sm:w-auto">
          Create Webhook
        </Button>
      </div>
    </Card>
  );
}

/* ── Main Page Component ──────────────────────────────────────────── */

export default function WebhooksPageClient() {
  const [webhooks, setWebhooks] = useState([]);
  const [supportedEvents, setSupportedEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal state
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  // Panels
  const [deliveryWebhook, setDeliveryWebhook] = useState(null);
  const [secretWebhook, setSecretWebhook] = useState(null);

  const notify = useNotificationStore((s) => s);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/webhooks", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setWebhooks(data.webhooks || []);
      setSupportedEvents(data.supportedEvents || []);
    } catch (err) {
      setError(err.message || "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (data) => {
    const res = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create webhook");
    }
    const { webhook } = await res.json();
    const { secret, ...safeWebhook } = webhook;
    notify.success("Webhook created");
    await load();
    setShowFormModal(false);
    setSecretWebhook({ ...safeWebhook, oneTimeSecret: secret });
  };

  const handleUpdate = async (id, data) => {
    const res = await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to update webhook");
    }
    notify.success("Webhook updated");
    await load();
    setEditingWebhook(null);
  };

  const handleToggle = async (webhook) => {
    const res = await fetch(`/api/webhooks/${webhook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !webhook.isActive }),
    });
    if (res.ok) {
      notify.info(webhook.isActive ? "Webhook disabled" : "Webhook enabled");
      await load();
    }
  };

  const handleDelete = (webhook) => {
    setConfirmState({
      title: "Delete Webhook",
      message: `Delete "${webhook.name}"? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        const res = await fetch(`/api/webhooks/${webhook.id}`, {
          method: "DELETE",
        });
        if (res.ok) {
          notify.success("Webhook deleted");
          await load();
        }
      },
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Webhooks</h1>
          <p className="text-sm text-text-muted">
            Push event notifications to external services when things happen in
            your router.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={load}
            disabled={loading}
            icon="refresh"
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
          <Button
            icon="add"
            size="sm"
            onClick={() => setShowFormModal(true)}
          >
            Create Webhook
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-red-500/30 text-sm text-red-500" padding="sm">
          {error}
        </Card>
      )}

      {/* Summary */}
      <SummaryStats webhooks={webhooks} loading={loading} />

      {/* Webhook List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : webhooks.length === 0 ? (
        <EmptyState onCreate={() => setShowFormModal(true)} />
      ) : (
        <div className="flex flex-col gap-3">
          {webhooks.map((wh) => (
            <WebhookCard
              key={wh.id}
              webhook={wh}
              onEdit={() => setEditingWebhook(wh)}
              onDelete={() => handleDelete(wh)}
              onToggle={() => handleToggle(wh)}
              onViewDeliveries={() => setDeliveryWebhook(wh)}
              onManageSecret={() => setSecretWebhook(wh)}
            />
          ))}
        </div>
      )}

      {/* Info footer */}
      <Card padding="sm" className="border-border-subtle/50">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">
            info
          </span>
          <div className="text-xs text-text-muted space-y-1">
            <p>
              <strong className="text-text-main">Signing secrets</strong> let
              your endpoint verify that deliveries came from your router.
              Each delivery includes an{" "}
              <code className="bg-surface-2 px-1 rounded text-[11px]">
                x-miaw-signature
              </code>{" "}
              header containing the HMAC-SHA256 digest.
            </p>
            <p>
              <strong className="text-text-main">Retries</strong> are attempted
              up to 3 times with exponential backoff for server errors and
              timeouts.
            </p>
            <p>
              <strong className="text-text-main">URL validation</strong>{" "}
               allows HTTP or HTTPS and blocks private/reserved IP ranges to prevent
              SSRF.
            </p>
          </div>
        </div>
      </Card>

      {/* Modals & Panels */}
      {showFormModal && (
        <WebhookFormModal
          key="create"
          isOpen={showFormModal}
          onClose={() => setShowFormModal(false)}
          onSave={handleCreate}
          supportedEvents={supportedEvents}
        />
      )}

      {editingWebhook && (
        <WebhookFormModal
          key={editingWebhook.id}
          isOpen={!!editingWebhook}
          webhook={editingWebhook}
          onClose={() => setEditingWebhook(null)}
          onSave={(data) => handleUpdate(editingWebhook.id, data)}
          supportedEvents={supportedEvents}
        />
      )}

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />

      {deliveryWebhook && (
        <DeliveryPanel
          webhook={deliveryWebhook}
          onClose={() => setDeliveryWebhook(null)}
        />
      )}

      {secretWebhook && (
        <SecretManager
          webhook={secretWebhook}
          onClose={() => setSecretWebhook(null)}
          onUpdate={load}
        />
      )}
    </div>
  );
}
