"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  Badge,
  Button,
  Input,
  Select,
  Modal,
  CardSkeleton,
  ConfirmModal,
} from "@/shared/components";
import { cn } from "@/shared/utils/cn";

/* ── Constants ─────────────────────────────────────────────────── */

const BATCH_API = "/api/batches";

const STATUS_VARIANT = {
  queued: "warning",
  running: "info",
  completed: "success",
  failed: "error",
  canceled: "default",
};

const STATUS_ICON = {
  queued: "schedule",
  running: "progress_activity",
  completed: "check_circle",
  failed: "error",
  canceled: "cancel",
};

const EXAMPLE_JSONL = [
  '{"custom_id":"req-1","method":"POST","url":"/v1/chat/completions","body":{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}}',
  '{"custom_id":"req-2","method":"POST","url":"/v1/chat/completions","body":{"model":"gpt-4o-mini","messages":[{"role":"user","content":"World"}]}}',
].join("\n");

/* ── Helpers ───────────────────────────────────────────────────── */

function timeAgo(ts) {
  if (!ts) return "—";
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function progressPct(batch) {
  if (!batch.totalRequests || batch.totalRequests === 0) return 0;
  // For completed/failed, we know the ratio based on attempts and error presence
  if (batch.status === "completed") return 100;
  if (batch.status === "failed") return 100;
  if (batch.status === "canceled") return 0;
  return 0; // For queued/running we don't have granular progress
}

/* ── Page Header ───────────────────────────────────────────────── */

function PageHeader({ loading, refresh, onNewBatch, hasProviders }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2.5">
          <span className="material-symbols-outlined text-[28px] text-primary">
            batch_prediction
          </span>
          Batch
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Submit and manage batch LLM requests. Send large workloads through the
          MiawRouter gateway with progress tracking and result retrieval.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={refresh}
          disabled={loading}
          icon="refresh"
        >
          {loading ? "Loading…" : "Refresh"}
        </Button>
        <Button variant="primary" size="sm" onClick={onNewBatch} icon="add" disabled={!hasProviders}>
          New Batch Job
        </Button>
      </div>
    </div>
  );
}

/* ── Summary Cards ─────────────────────────────────────────────── */

function SummaryCards({ batches, loading }) {
  const counts = { queued: 0, running: 0, completed: 0, failed: 0, canceled: 0 };
  let totalRecords = 0;
  for (const b of batches) {
    counts[b.status] = (counts[b.status] || 0) + 1;
    totalRecords += b.recordCount || 0;
  }

  const items = [
    {
      title: "Total Jobs",
      value: loading ? "—" : batches.length,
      icon: "batch_prediction",
    },
    {
      title: "Active",
      value: loading ? "—" : counts.queued + counts.running,
      icon: "progress_activity",
      accent: counts.queued + counts.running > 0 ? "text-blue-500" : "text-text-muted",
    },
    {
      title: "Completed",
      value: loading ? "—" : counts.completed,
      icon: "check_circle",
      accent: counts.completed > 0 ? "text-green-500" : "text-text-muted",
    },
    {
      title: "Total Records",
      value: loading ? "—" : totalRecords.toLocaleString(),
      icon: "data_object",
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
          <p className={cn("text-2xl font-semibold", item.accent || "text-text-main")}>
            {item.value}
          </p>
        </Card>
      ))}
    </div>
  );
}

/* ── Status Badge ──────────────────────────────────────────────── */

function StatusBadge({ status }) {
  return (
    <Badge variant={STATUS_VARIANT[status] || "default"} size="sm" dot>
      {status}
    </Badge>
  );
}

/* ── Progress Indicator ────────────────────────────────────────── */

function ProgressIndicator({ batch }) {
  if (batch.status === "completed") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden min-w-[50px]">
          <div className="h-full rounded-full bg-green-500" style={{ width: "100%" }} />
        </div>
        <span className="text-[11px] text-green-600 tabular-nums shrink-0">100%</span>
      </div>
    );
  }
  if (batch.status === "failed") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden min-w-[50px]">
          <div className="h-full rounded-full bg-red-500" style={{ width: "100%" }} />
        </div>
        <span className="text-[11px] text-red-500 tabular-nums shrink-0">
          {batch.error || "failed"}
        </span>
      </div>
    );
  }
  if (batch.status === "running") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden min-w-[50px]">
          <div className="h-full rounded-full bg-blue-500 animate-pulse" style={{ width: "40%" }} />
        </div>
        <span className="text-[11px] text-blue-500 tabular-nums shrink-0">running…</span>
      </div>
    );
  }
  return null;
}

/* ── New Batch Modal ───────────────────────────────────────────── */

function NewBatchModal({ isOpen, onClose, onSubmit, registeredProviders }) {
  const [provider, setProvider] = useState("");
  const [inputFile, setInputFile] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  // Reset on open
  const prevOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpen.current) {
      setProvider("");
      setInputFile("");
      setError("");
      setSubmitting(false);
    }
    prevOpen.current = isOpen;
  }, [isOpen]);

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".jsonl") && !file.name.endsWith(".json")) {
      setError("Please upload a .jsonl file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setInputFile(ev.target.result);
      setError("");
    };
    reader.readAsText(file);
  }, []);

  const lineCount = inputFile.trim()
    ? inputFile.trim().split("\n").filter(Boolean).length
    : 0;

  const handleSubmit = async () => {
    if (!provider) {
      setError("Select a provider");
      return;
    }
    if (!inputFile.trim()) {
      setError("Provide JSONL input data (one request per line)");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit({ provider, input: inputFile });
    } catch (err) {
      setError(err.message || "Failed to create batch job");
    } finally {
      setSubmitting(false);
    }
  };

  const noProviders = registeredProviders.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Batch Job"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={submitting}
            disabled={noProviders}
            icon="send"
          >
            Submit Batch Job
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Provider support notice */}
        <div className="flex items-start gap-2.5 p-3 rounded-[var(--radius-brand)] bg-amber-500/8 border border-amber-500/20">
          <span className="material-symbols-outlined text-[18px] text-amber-600 mt-0.5 shrink-0">
            info
          </span>
          <div className="text-xs text-text-muted space-y-1.5">
            <p>
              <strong className="text-text-main">Provider support varies.</strong>{" "}
              Batch processing requires a provider with a registered batch executor.
            </p>
            {noProviders ? (
              <p className="text-amber-700 dark:text-amber-400 font-medium">
                No batch-capable providers are currently registered. Batch processing
                will be available once a provider with batch support is configured.
              </p>
            ) : (
              <p>
                Selected provider:{" "}
                <strong className="text-text-main">{provider}</strong>.
              </p>
            )}
          </div>
        </div>

        <Select
          label="Provider"
          options={registeredProviders.map((p) => ({ value: p, label: p }))}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder={
            noProviders
              ? "No batch providers available"
              : "Select a provider"
          }
          disabled={noProviders}
          required
        />

        {/* File upload / paste area */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-main">
            Input Data (JSONL) <span className="text-red-500 ml-1">*</span>
          </label>
          <p className="text-xs text-text-muted">
            One JSON request per line. Each record should have a{" "}
            <code className="text-[11px] bg-surface-2 px-1 py-0.5 rounded font-mono">
              custom_id
            </code>{" "}
            field. Max 10,000 records, 5 MB.
          </p>

          <div className="flex gap-2 items-center">
            <Button
              variant="secondary"
              size="sm"
              icon="upload_file"
              onClick={() => fileRef.current?.click()}
            >
              Upload .jsonl
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".jsonl,.json"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              variant="ghost"
              size="sm"
              icon="content_paste"
              onClick={() => {
                setInputFile(EXAMPLE_JSONL);
                setError("");
              }}
            >
              Load example
            </Button>
            {lineCount > 0 && (
              <Badge variant="success" size="sm">
                {lineCount} record{lineCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          <textarea
            value={inputFile}
            onChange={(e) => {
              setInputFile(e.target.value);
              setError("");
            }}
            placeholder={EXAMPLE_JSONL}
            rows={6}
            className={cn(
              "w-full p-3 text-sm font-mono text-text-main bg-surface-2 rounded-[10px]",
              "border border-transparent placeholder-text-muted/50",
              "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
              "transition-all duration-150 resize-y min-h-[120px] custom-scrollbar",
              "text-[14px]"
            )}
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-[var(--radius-brand)] bg-red-500/8 border border-red-500/20">
            <span className="material-symbols-outlined text-[16px] text-red-500">
              error
            </span>
            <p className="text-xs text-red-500">{error}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Batch Detail Modal ────────────────────────────────────────── */

function BatchDetailModal({ isOpen, onClose, batch }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [resultData, setResultData] = useState(null);
  const [errorData, setErrorData] = useState(null);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);

  const prevDetailOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !prevDetailOpen.current) {
      setActiveTab("overview");
      setResultData(null);
      setErrorData(null);
    }
    prevDetailOpen.current = isOpen;
  }, [isOpen]);

  const loadArtifact = useCallback(async (type) => {
    if (!batch) return;
    setLoadingArtifacts(true);
    try {
      const res = await fetch(`${BATCH_API}/${batch.id}/${type}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to load ${type}`);
      }
      const text = await res.text();
      if (type === "results") setResultData(text);
      else setErrorData(text);
    } catch (err) {
      if (type === "results") setResultData(`Error: ${err.message}`);
      else setErrorData(`Error: ${err.message}`);
    } finally {
      setLoadingArtifacts(false);
    }
  }, [batch]);

  if (!batch) return null;

  const tabs = [
    { value: "overview", label: "Overview", icon: "info" },
    { value: "results", label: "Results", icon: "check_circle" },
    { value: "errors", label: "Errors", icon: "error" },
  ];

  const isTerminal = ["completed", "failed", "canceled"].includes(batch.status);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Batch: ${batch.id.slice(0, 16)}…`} size="full">
      <div className="space-y-5">
        {/* Status banner */}
        <div
          className={cn(
            "flex items-center gap-3 p-3 rounded-[var(--radius-brand)] border",
            batch.status === "completed" && "bg-green-500/8 border-green-500/20",
            batch.status === "failed" && "bg-red-500/8 border-red-500/20",
            batch.status === "running" && "bg-blue-500/8 border-blue-500/20",
            batch.status === "queued" && "bg-yellow-500/8 border-yellow-500/20",
            batch.status === "canceled" && "bg-surface-2 border-border-subtle"
          )}
        >
          <span className={cn(
            "material-symbols-outlined text-[20px]",
            batch.status === "running" && "animate-spin"
          )}>
            {STATUS_ICON[batch.status]}
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <StatusBadge status={batch.status} />
              {batch.error && (
                <span className="text-xs text-red-500 font-mono">{batch.error}</span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-1">
              {batch.status === "running" && "Batch is being processed…"}
              {batch.status === "queued" && "Queued — waiting for execution slot."}
              {batch.status === "completed" && `Finished at ${formatDate(batch.completedAt)}`}
              {batch.status === "failed" && (batch.error || "Batch failed during processing.")}
              {batch.status === "canceled" && "Batch was canceled."}
            </p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Records", value: batch.recordCount ?? batch.totalRequests ?? "—" },
            { label: "Input Size", value: formatBytes(batch.inputBytes) },
            { label: "Attempts", value: batch.attempts ?? 0 },
            { label: "Provider", value: batch.provider || "—" },
          ].map((s) => (
            <div
              key={s.label}
              className="p-3 rounded-[var(--radius-brand)] bg-bg border border-border-subtle"
            >
              <p className="text-[11px] text-text-muted uppercase tracking-wider">
                {s.label}
              </p>
              <p className="text-lg font-semibold text-text-main mt-0.5">
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-subtle border border-border-subtle w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setActiveTab(tab.value);
                if (tab.value === "results" && resultData === null && isTerminal) loadArtifact("results");
                if (tab.value === "errors" && errorData === null && isTerminal) loadArtifact("errors");
              }}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5",
                activeTab === tab.value
                  ? "bg-surface text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[14px]">
                {tab.icon}
              </span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "overview" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Batch ID", value: batch.id },
                { label: "Provider", value: batch.provider },
                { label: "Created", value: formatDate(batch.createdAt) },
                { label: "Started", value: formatDate(batch.startedAt) },
                { label: "Completed", value: formatDate(batch.completedAt) },
                { label: "Updated", value: formatDate(batch.updatedAt) },
              ].map((field) => (
                <div key={field.label} className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-text-muted uppercase tracking-wider">
                    {field.label}
                  </span>
                  <span className="text-sm text-text-main font-mono break-all">
                    {field.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "results" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Result File (JSONL)
              </h4>
              {isTerminal && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="download"
                  onClick={() => window.open(`${BATCH_API}/${batch.id}/results`, "_blank")}
                >
                  Download
                </Button>
              )}
            </div>
            {!isTerminal ? (
              <p className="text-sm text-text-muted">Results available after batch completes.</p>
            ) : loadingArtifacts ? (
              <div className="p-4 text-sm text-text-muted">Loading…</div>
            ) : resultData ? (
              <pre className="p-4 bg-bg rounded-[var(--radius-brand)] border border-border-subtle text-xs font-mono text-text-main overflow-auto max-h-[400px] custom-scrollbar whitespace-pre-wrap break-all">
                {resultData}
              </pre>
            ) : (
              <p className="text-sm text-text-muted">No results generated.</p>
            )}
          </div>
        )}

        {activeTab === "errors" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Error File (JSONL)
              </h4>
              {isTerminal && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="download"
                  onClick={() => window.open(`${BATCH_API}/${batch.id}/errors`, "_blank")}
                >
                  Download
                </Button>
              )}
            </div>
            {!isTerminal ? (
              <p className="text-sm text-text-muted">Error log available after batch completes.</p>
            ) : loadingArtifacts ? (
              <div className="p-4 text-sm text-text-muted">Loading…</div>
            ) : errorData ? (
              <pre className="p-4 bg-bg rounded-[var(--radius-brand)] border border-border-subtle text-xs font-mono text-text-main overflow-auto max-h-[400px] custom-scrollbar whitespace-pre-wrap break-all">
                {errorData}
              </pre>
            ) : (
              <p className="text-sm text-text-muted">No errors recorded.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Batch Row ─────────────────────────────────────────────────── */

function BatchRow({ batch, onView, onCancel, onRetry, onDelete }) {
  const isTerminal = ["completed", "failed", "canceled"].includes(batch.status);
  const canCancel = batch.status === "queued" || batch.status === "running";
  const canRetry = batch.status === "failed";

  return (
    <div
      className={cn(
        "group flex items-center gap-4 p-4 -mx-1 px-1",
        "border-b border-border-subtle last:border-b-0",
        "hover:bg-surface-2/50 transition-colors"
      )}
    >
      {/* Status icon */}
      <div
        className={cn(
          "size-9 rounded-lg flex items-center justify-center shrink-0",
          batch.status === "completed" && "bg-green-500/10 text-green-600",
          batch.status === "running" && "bg-blue-500/10 text-blue-500",
          batch.status === "queued" && "bg-yellow-500/10 text-yellow-600",
          batch.status === "failed" && "bg-red-500/10 text-red-500",
          batch.status === "canceled" && "bg-surface-3 text-text-muted"
        )}
      >
        <span
          className={cn(
            "material-symbols-outlined text-[18px]",
            batch.status === "running" && "animate-spin"
          )}
        >
          {STATUS_ICON[batch.status]}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-text-main font-mono truncate">
            {batch.id.slice(0, 20)}…
          </h3>
          <StatusBadge status={batch.status} />
          <span className="text-[11px] text-text-muted">
            {batch.provider}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <ProgressIndicator batch={batch} />
          <span className="text-[11px] text-text-muted shrink-0">
            {batch.recordCount ?? batch.totalRequests ?? 0} records
            {batch.inputBytes ? ` · ${formatBytes(batch.inputBytes)}` : ""}
            {batch.attempts > 0 ? ` · ${batch.attempts} attempt${batch.attempts !== 1 ? "s" : ""}` : ""}
            {" · "}
            {timeAgo(batch.createdAt)}
          </span>
          {batch.error && (
            <span className="text-[11px] text-red-500 truncate max-w-[200px]" title={batch.error}>
              {batch.error}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          icon="visibility"
          onClick={() => onView(batch)}
          aria-label="View details"
        />
        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            icon="cancel"
            onClick={() => onCancel(batch)}
            aria-label="Cancel batch"
            className="text-amber-600 hover:text-amber-700"
          />
        )}
        {canRetry && (
          <Button
            variant="ghost"
            size="sm"
            icon="replay"
            onClick={() => onRetry(batch)}
            aria-label="Retry batch"
            className="text-blue-500 hover:text-blue-600"
          />
        )}
        {isTerminal && (
          <Button
            variant="ghost"
            size="sm"
            icon="delete"
            onClick={() => onDelete(batch)}
            aria-label="Delete batch"
            className="text-red-500 hover:text-red-600"
          />
        )}
      </div>
    </div>
  );
}

/* ── Empty State ───────────────────────────────────────────────── */

function EmptyState({ onNewBatch, hasProviders }) {
  return (
    <Card padding="lg">
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="size-16 rounded-full bg-surface-2 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-[32px] text-text-muted/50">
            batch_prediction
          </span>
        </div>
        <h3 className="text-base font-semibold text-text-main mb-1.5">
          No batch jobs yet
        </h3>
        <p className="text-sm text-text-muted max-w-sm mb-5">
          {hasProviders
            ? "Submit batch requests to process multiple LLM prompts at once. Upload a JSONL file or paste your input data directly."
            : "Batch processing requires a provider with a registered batch executor. Once available, you can submit batch jobs here."}
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={onNewBatch}
          icon="add"
          disabled={!hasProviders}
        >
          {hasProviders ? "Create Your First Batch Job" : "New Batch Job"}
        </Button>
      </div>
    </Card>
  );
}

/* ── Main Page Component ───────────────────────────────────────── */

export default function BatchPageClient() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [detailBatch, setDetailBatch] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [registeredProviders, setRegisteredProviders] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(BATCH_API, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setBatches(data.batches || []);
      setRegisteredProviders(Array.isArray(data.providers) ? data.providers : []);
    } catch (err) {
      setError(err.message || "Failed to load batch jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll for updates when there are active jobs
  useEffect(() => {
    const hasActive = batches.some(
      (b) => b.status === "queued" || b.status === "running"
    );
    if (!hasActive) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [batches, load]);

  const handleCreateBatch = async ({ provider, input }) => {
    const res = await fetch(BATCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, input }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const code = body.code;
      if (code === "UNSUPPORTED_PROVIDER") {
        throw new Error(
          `${body.error || "Provider not supported"}. This provider does not have a batch executor registered.`
        );
      }
      if (code === "QUEUE_FULL") {
        throw new Error("Batch queue is full. Wait for active jobs to complete.");
      }
      if (code === "INPUT_TOO_LARGE") {
        throw new Error("Input exceeds the 5 MB limit.");
      }
      if (code === "TOO_MANY_RECORDS") {
        throw new Error("Input exceeds the 10,000 record limit.");
      }
      if (code === "INVALID_JSONL") {
        throw new Error(body.error || "Invalid JSONL format.");
      }
      throw new Error(body.error || `Failed (${res.status})`);
    }
    setShowNewBatch(false);
    await load();
  };

  const handleCancel = async (batch) => {
    try {
      const res = await fetch(`${BATCH_API}/${batch.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      setConfirmAction(null);
      await load();
    } catch (err) {
      setError(err.message || "Failed to cancel batch");
    }
  };

  const handleRetry = async (batch) => {
    try {
      const res = await fetch(`${BATCH_API}/${batch.id}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err.message || "Failed to retry batch");
    }
  };

  const handleDelete = async (batch) => {
    try {
      const res = await fetch(`${BATCH_API}/${batch.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      setConfirmAction(null);
      await load();
    } catch (err) {
      setError(err.message || "Failed to delete batch");
    }
  };

  const filterOptions = [
    { value: "all", label: `All (${batches.length})` },
    ...["queued", "running", "completed", "failed", "canceled"].map(
      (s) => ({
        value: s,
        label: `${s.charAt(0).toUpperCase() + s.slice(1)} (${
          batches.filter((b) => b.status === s).length
        })`,
      })
    ),
  ];

  const [filter, setFilter] = useState("all");
  const filtered =
    filter === "all" ? batches : batches.filter((b) => b.status === filter);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      <PageHeader
        loading={loading}
        refresh={load}
        onNewBatch={() => setShowNewBatch(true)}
        hasProviders={registeredProviders.length > 0}
      />

      {error && (
        <Card className="border-red-500/30 text-sm text-red-500" padding="sm">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError("")}
              className="p-1 rounded hover:bg-surface-2 transition-colors cursor-pointer"
              aria-label="Dismiss"
            >
              <span className="material-symbols-outlined text-[16px]">
                close
              </span>
            </button>
          </div>
        </Card>
      )}

      <SummaryCards batches={batches} loading={loading} />

      {/* Filter + list header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-text-main flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">
            list
          </span>
          Batch Jobs
        </h2>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-subtle border border-border-subtle overflow-x-auto">
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer shrink-0",
                filter === opt.value
                  ? "bg-surface text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Batch list */}
      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : batches.length === 0 ? (
        <EmptyState
          onNewBatch={() => setShowNewBatch(true)}
          hasProviders={registeredProviders.length > 0}
        />
      ) : filtered.length === 0 ? (
        <Card padding="lg">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="material-symbols-outlined text-[40px] text-text-muted/40 mb-3">
              filter_list_off
            </span>
            <p className="text-sm text-text-muted">
              No {filter} jobs found.
            </p>
          </div>
        </Card>
      ) : (
        <Card padding="sm">
          {filtered.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              onView={setDetailBatch}
              onCancel={(b) =>
                setConfirmAction({ type: "cancel", batch: b })
              }
              onRetry={handleRetry}
              onDelete={(b) =>
                setConfirmAction({ type: "delete", batch: b })
              }
            />
          ))}
        </Card>
      )}

      {/* Info footer */}
      <Card padding="sm" className="border-border-subtle/50">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[16px] text-text-muted mt-0.5">
            info
          </span>
          <div className="text-xs text-text-muted space-y-1">
            <p>
              <strong className="text-text-main">Input format:</strong>{" "}
              JSONL (JSON Lines) — one request object per line. Each record needs
              a <code className="font-mono bg-surface-2 px-1 py-0.5 rounded">custom_id</code>{" "}
              field. Max 10,000 records, 5 MB per batch.
            </p>
            <p>
              <strong className="text-text-main">Provider support:</strong>{" "}
               Batch processing requires a provider with a registered batch executor.
            </p>
            <p>
              <strong className="text-text-main">Polling:</strong> The page
              auto-refreshes every 5 seconds while jobs are active. Results and
              error logs can be downloaded from the detail view after completion.
            </p>
          </div>
        </div>
      </Card>

      {/* Modals */}
      <NewBatchModal
        isOpen={showNewBatch}
        onClose={() => setShowNewBatch(false)}
        onSubmit={handleCreateBatch}
        registeredProviders={registeredProviders}
      />

      <BatchDetailModal
        isOpen={!!detailBatch}
        onClose={() => setDetailBatch(null)}
        batch={detailBatch}
      />

      <ConfirmModal
        isOpen={confirmAction?.type === "cancel"}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => handleCancel(confirmAction?.batch)}
        title="Cancel Batch Job"
        message={`Cancel batch ${confirmAction?.batch?.id?.slice(0, 16) || ""}…? Active records will stop processing.`}
        confirmText="Cancel Batch"
        variant="warning"
      />

      <ConfirmModal
        isOpen={confirmAction?.type === "delete"}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => handleDelete(confirmAction?.batch)}
        title="Delete Batch Job"
        message={`Permanently delete batch ${confirmAction?.batch?.id?.slice(0, 16) || ""}…? This removes all stored artifacts.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
