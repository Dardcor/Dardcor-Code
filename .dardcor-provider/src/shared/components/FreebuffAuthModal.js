"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

/**
 * Freebuff Auth Modal
 * Connect Freebuff via direct browser login flow (polling session),
 * auto-detect local credentials.json, or manual token input.
 */
export default function FreebuffAuthModal({ isOpen, onSuccess, onClose }) {
  const [authToken, setAuthToken] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);

  // OAuth polling state
  const [session, setSession] = useState(null);
  const [polling, setPolling] = useState(false);
  const [pollProgress, setPollProgress] = useState(0);
  const [loginUrl, setLoginUrl] = useState("");
  const abortControllerRef = useRef(null);

  const runAutoDetect = async () => {
    setAutoDetecting(true);
    setError(null);
    setAutoDetected(false);

    try {
      const res = await fetch("/api/oauth/freebuff/auto-import");
      const data = await res.json();

      if (data.found && data.authToken) {
        setAuthToken(data.authToken);
        if (data.name || data.email) {
          setConnectionName(data.name || data.email);
        }
        setAutoDetected(true);
      }
    } catch {
      // Ignore
    } finally {
      setAutoDetecting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setSession(null);
      setPolling(false);
      return;
    }
    runAutoDetect();
  }, [isOpen]);

  // Start Freebuff OAuth Session & Polling
  const startOAuthLogin = async () => {
    setError(null);
    setPolling(true);
    setPollProgress(0);

    try {
      const res = await fetch("/api/oauth/freebuff/session", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.loginUrl) {
        throw new Error(data.error || "Failed to generate Freebuff login URL");
      }

      setSession(data);
      setLoginUrl(data.loginUrl);

      // Open in browser
      window.open(data.loginUrl, "_blank", "noopener,noreferrer");

      // Begin polling
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      const maxAttempts = 30; // 30 x 2s = 60s

      let successUser = null;
      for (let i = 0; i < maxAttempts; i++) {
        if (signal.aborted) throw new Error("Login cancelled");
        setPollProgress(Math.min(((i + 1) / maxAttempts) * 100, 100));

        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (signal.aborted) throw new Error("Login cancelled");

        const statusRes = await fetch("/api/oauth/freebuff/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            fingerprintId: data.fingerprintId,
            fingerprintHash: data.fingerprintHash,
            expiresAt: data.expiresAt,
          }),
        });

        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();

        if (!statusData.pending && statusData.success) {
          successUser = statusData.user;
          break;
        }
      }

      if (!successUser) {
        throw new Error("Login timed out. Please try again or paste your token manually.");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      if (err.message !== "Login cancelled") {
        setError(err.message);
      }
      setPolling(false);
    }
  };

  const handleManualImport = async () => {
    if (!authToken.trim()) {
      setError("Please enter a Freebuff auth token");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/freebuff/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authToken: authToken.trim(),
          connectionName: connectionName.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Freebuff AI" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Auto-detecting state */}
        {autoDetecting && (
          <div className="text-center py-6">
            <div className="size-12 mx-auto mb-3 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <p className="text-sm font-medium">Scanning credentials.json...</p>
          </div>
        )}

        {!autoDetecting && (
          <>
            {/* Auto-detected notification */}
            {autoDetected && (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex gap-2 items-center">
                  <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    Freebuff credentials auto-detected from local file!
                  </p>
                </div>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <div className="flex gap-2 items-center">
                  <span className="material-symbols-outlined text-red-600 dark:text-red-400">error</span>
                  <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
                </div>
              </div>
            )}

            {/* OAuth Login Action Card */}
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <span>⚡ One-Click Login via Freebuff.com</span>
                  </h4>
                  <p className="text-xs text-text-muted mt-0.5">
                    Authenticate in your browser; Dardcor Code automatically captures the token.
                  </p>
                </div>
              </div>

              {polling ? (
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-primary font-medium">
                      <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                      Waiting for browser login...
                    </span>
                    {loginUrl && (
                      <a
                        href={loginUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        Re-open link ↗
                      </a>
                    )}
                  </div>
                  <div className="w-full bg-border h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-500 rounded-full"
                      style={{ width: `${pollProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <Button
                  onClick={startOAuthLogin}
                  variant="primary"
                  className="w-full justify-center"
                >
                  <span className="material-symbols-outlined text-sm mr-1.5">open_in_new</span>
                  Login at Freebuff.com
                </Button>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-muted font-medium uppercase">or enter manually</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Manual Token Input */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Freebuff Auth Token
              </label>
              <textarea
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="Paste authToken (e.g. fa82b5c1-e39d-4c7a-961f-...)"
                rows={2}
                className="w-full px-3 py-2 text-xs font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Connection Name */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Connection Name (Optional)
              </label>
              <Input
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
                placeholder="My Freebuff Account"
                className="text-sm"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button onClick={onClose} variant="ghost">
                Cancel
              </Button>
              <Button
                onClick={handleManualImport}
                disabled={importing || !authToken.trim() || polling}
                loading={importing}
              >
                Connect Freebuff
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

FreebuffAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
