"use client";

import { useState } from "react";
import { Modal, Button, Input } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

export default function WebhookFormModal({
  isOpen,
  webhook,
  onClose,
  onSave,
  supportedEvents,
}) {
  const isEdit = !!webhook;
  const [name, setName] = useState(webhook?.name || "");
  const [url, setUrl] = useState(webhook?.url || "");
  const [events, setEvents] = useState(webhook?.events || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [urlError, setUrlError] = useState("");

  const validate = () => {
    let ok = true;
    if (!name.trim()) {
      setNameError("Name is required");
      ok = false;
    } else {
      setNameError("");
    }
    if (!url.trim()) {
      setUrlError("URL is required");
      ok = false;
    } else {
      try {
        new URL(url);
        setUrlError("");
      } catch {
        setUrlError("Enter a valid URL");
        ok = false;
      }
    }
    return ok;
  };

  const toggleEvent = (evt) => {
    setEvents((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]
    );
  };

  const handleSave = async () => {
    if (!validate()) return;
    if (events.length === 0) {
      setError("Select at least one event");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({ name: name.trim(), url: url.trim(), events });
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Group events by prefix (request.*, provider.*, quota.*)
  const groups = {};
  (supportedEvents.length ? supportedEvents : []).forEach((evt) => {
    const prefix = evt.split(".")[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(evt);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? "Edit Webhook" : "Create Webhook"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={!name.trim() || !url.trim() || events.length === 0}
          >
            {isEdit ? "Save Changes" : "Create Webhook"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error}
          </div>
        )}

        <Input
          label="Webhook Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError("");
          }}
          placeholder="e.g. Slack notifications"
          error={nameError}
          required
        />

        <Input
          label="Endpoint URL"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (urlError) setUrlError("");
          }}
          placeholder="https://example.com/webhook"
          error={urlError}
          hint="HTTP and HTTPS are supported. Private/reserved IPs are blocked."
          required
        />

        {/* Event selector */}
        <div>
          <label className="text-sm font-medium text-text-main mb-2 block">
            Events <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-text-muted mb-3">
            Choose which events trigger this webhook.
          </p>

          {Object.keys(groups).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(groups).map(([prefix, evts]) => (
                <div key={prefix}>
                  <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    {prefix}
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {evts.map((evt) => {
                      const selected = events.includes(evt);
                      return (
                        <button
                          key={evt}
                          type="button"
                          onClick={() => toggleEvent(evt)}
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono transition-all cursor-pointer border",
                            selected
                              ? "bg-brand-500/10 text-brand-600 border-brand-500/30 dark:text-brand-300"
                              : "bg-surface-2 text-text-muted border-transparent hover:border-border"
                          )}
                        >
                          {selected && (
                            <span className="material-symbols-outlined text-[12px]">
                              check
                            </span>
                          )}
                          {evt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              Loading event types…
            </p>
          )}

          {events.length === 0 && (
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">
                warning
              </span>
              Select at least one event
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
