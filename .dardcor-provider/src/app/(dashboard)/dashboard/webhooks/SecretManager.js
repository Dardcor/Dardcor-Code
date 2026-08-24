"use client";

import { useState } from "react";
import { Modal, Button, Badge } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

export default function SecretManager({ webhook, onClose, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [oneTimeSecret, setOneTimeSecret] = useState(webhook.oneTimeSecret || "");
  const notify = useNotificationStore((s) => s);

  const hasSecret = webhook.secretConfigured;
  const secretPreview = webhook.secretPreview;

  const copySecret = async () => {
    await navigator.clipboard.writeText(oneTimeSecret);
    notify.success("Signing secret copied");
  };

  const handleRotate = async () => {
    setLoading(true);
    try {
      // Generate a random 64-char hex string (within 16-256 chars).
      // The backend stores and uses this for HMAC signing; only a masked
      // preview is returned on subsequent GETs.
      const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const res = await fetch(`/api/webhooks/${webhook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: raw }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to set secret");
      }
      setOneTimeSecret(raw);
      notify.success("Signing secret rotated");
      onUpdate?.();
      setConfirmRotate(false);
    } catch (err) {
      notify.error(err.message || "Failed to update secret");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Signing Secret" size="md">
      <div className="flex flex-col gap-4">
        {oneTimeSecret && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
            <p className="text-sm font-medium text-text-main mb-1">Copy this secret now</p>
            <p className="text-xs text-text-muted mb-3">For security, the full signing secret will not be shown again after this dialog closes.</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-bg px-3 py-2 text-xs text-text-main">{oneTimeSecret}</code>
              <Button variant="secondary" size="sm" icon="content_copy" onClick={copySecret}>Copy Secret</Button>
            </div>
          </div>
        )}

        {/* Current state */}
        <div className="rounded-lg bg-bg border border-border-subtle p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-[18px] text-text-muted">
              key
            </span>
            <h3 className="text-sm font-medium text-text-main">
              Current Status
            </h3>
          </div>
          {hasSecret ? (
            <div className="flex items-center gap-2">
              <Badge variant="success" size="sm" dot>
                Active
              </Badge>
              {secretPreview && <span className="text-xs font-mono text-text-muted">{secretPreview}</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="default" size="sm">
                No secret
              </Badge>
              <span className="text-xs text-text-muted">
                Payloads are not signed
              </span>
            </div>
          )}
        </div>

        {/* How verification works */}
        <div className="text-xs text-text-muted space-y-2">
          <p>
            <strong className="text-text-main">How it works:</strong> Each
            delivery includes an{" "}
            <code className="bg-surface-2 px-1 rounded text-[11px]">
              x-dardcor-signature
            </code>{" "}
            header with the HMAC-SHA256 digest of{" "}
            <code className="bg-surface-2 px-1 rounded text-[11px]">
              timestamp.body
            </code>, keyed with your secret.
          </p>
          <div className="rounded-lg bg-bg border border-border-subtle p-3">
            <p className="font-mono text-[11px]">
              signature = HMAC-SHA256(secret, timestamp + &quot;.&quot; + body)
            </p>
            <p className="font-mono text-[11px] mt-1">
              x-dardcor-signature: sha256=&#123;hex_digest&#125;
            </p>
            <p className="font-mono text-[11px] mt-1">
              x-dardcor-timestamp: &#123;unix_seconds&#125;
            </p>
          </div>
          <p>
            Verify by computing the same HMAC and comparing with
            timing-safe equality. Reject deliveries with timestamps older
            than 5 minutes to prevent replay attacks.
          </p>
        </div>

        {/* Security note */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[16px] text-amber-600 mt-0.5">
              warning
            </span>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              The full secret is returned only at creation and remains stored server-side. Only a
              masked preview is returned later. Rotation immediately replaces the
              current secret, so update your receiving endpoint as soon as you copy the new value.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2 border-t border-border-subtle">
          {!confirmRotate ? (
            <Button
              variant="primary"
              size="sm"
              icon="key"
              loading={loading}
              onClick={() => setConfirmRotate(true)}
              fullWidth
            >
              Rotate Secret
            </Button>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                This immediately replaces the current signing secret. The new secret will be shown once after rotation; copy it and update your receiving endpoint promptly.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRotate(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={loading}
                  onClick={handleRotate}
                >
                  Confirm Rotate
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
