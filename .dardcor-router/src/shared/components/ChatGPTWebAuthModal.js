"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

function decodeJwt(token) {
  try {
    if (!token || typeof token !== "string") return null;
    const parts = token.trim().split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const missingPadding = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(missingPadding);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default function ChatGPTWebAuthModal({ isOpen, onSuccess, onClose }) {
  const [inputValue, setInputValue] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const initialConnectionCountRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setIsListening(false);
      setSyncSuccess(false);
      setError(null);
      setInputValue("");
      return;
    }

    let isMounted = true;
    fetch("/api/oauth/chatgpt-web/status")
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && typeof data.total === "number") {
          initialConnectionCountRef.current = data.total;
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  const parsedInfo = useMemo(() => {
    const raw = inputValue.trim();
    if (!raw) return null;

    let token = raw;
    let emailFromSession = null;
    let accountIdFromSession = null;
    let planTypeFromSession = null;

    if (raw.startsWith("{") && raw.endsWith("}")) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.accessToken) token = parsed.accessToken;
        if (parsed.user?.email) emailFromSession = parsed.user.email;
        if (parsed.account?.id) accountIdFromSession = parsed.account.id;
        if (parsed.account?.planType) planTypeFromSession = parsed.account.planType;
      } catch {
        // invalid json
      }
    }

    if (token.includes("__Secure-next-auth.session-token=")) {
      const match = token.match(/__Secure-next-auth\.session-token=([^;]+)/);
      if (match && match[1]) token = match[1].trim();
    }

    const payload = decodeJwt(token);
    if (!payload) {
      return {
        validJwt: false,
        rawToken: token,
      };
    }

    const auth = payload["https://api.openai.com/auth"] || {};
    const profile = payload["https://api.openai.com/profile"] || {};

    const email = emailFromSession || profile.email || payload.email || payload.preferred_username || "ChatGPT User";
    const accountId = auth.chatgpt_account_id || payload.account_id || accountIdFromSession || null;
    const planType = auth.chatgpt_plan_type || payload.plan_type || planTypeFromSession || "free";
    const exp = payload.exp ? new Date(payload.exp * 1000).toLocaleString() : null;

    return {
      validJwt: true,
      rawToken: token,
      email,
      accountId,
      planType,
      exp,
    };
  }, [inputValue]);

  const executeImport = useCallback(
    async (tokenOrJson) => {
      setImporting(true);
      setError(null);

      try {
        const res = await fetch("/api/oauth/chatgpt-web/import-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: tokenOrJson,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Gagal menghubungkan sesi ChatGPT Web");
        }

        setSyncSuccess(true);
        setIsListening(false);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 800);
      } catch (err) {
        setError(err.message || "Gagal mengimpor token sesi");
      } finally {
        setImporting(false);
      }
    },
    [onSuccess, onClose]
  );

  useEffect(() => {
    if (!isListening) return;

    const checkClipboardOnFocus = async () => {
      try {
        if (!navigator.clipboard?.readText) return;
        const text = await navigator.clipboard.readText();
        const trimmed = (text || "").trim();

        if (
          trimmed &&
          (trimmed.includes('"accessToken"') ||
            trimmed.includes("__Secure-next-auth") ||
            (trimmed.startsWith("eyJh") && trimmed.split(".").length === 3))
        ) {
          setInputValue(trimmed);
          executeImport(trimmed);
        }
      } catch {
        // clipboard access restricted
      }
    };

    const handleWindowMessage = (event) => {
      try {
        const data = event.data;
        if (!data) return;
        let token = null;
        if (typeof data === "string" && (data.includes("accessToken") || data.startsWith("eyJh"))) {
          token = data;
        } else if (typeof data === "object" && (data.accessToken || data.sessionJson)) {
          token = data.accessToken || data.sessionJson;
        }
        if (token) {
          setInputValue(typeof token === "string" ? token : JSON.stringify(token));
          executeImport(token);
        }
      } catch {
        // ignore message parse error
      }
    };

    const handlePasteEvent = (event) => {
      try {
        const text = event.clipboardData?.getData("text") || "";
        const trimmed = text.trim();
        if (
          trimmed &&
          (trimmed.includes('"accessToken"') ||
            trimmed.includes("__Secure-next-auth") ||
            (trimmed.startsWith("eyJh") && trimmed.split(".").length === 3))
        ) {
          event.preventDefault();
          setInputValue(trimmed);
          executeImport(trimmed);
        }
      } catch {
        // ignore paste error
      }
    };

    window.addEventListener("focus", checkClipboardOnFocus);
    window.addEventListener("message", handleWindowMessage);
    window.addEventListener("paste", handlePasteEvent);

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/oauth/chatgpt-web/status");
        if (!res.ok) return;
        const data = await res.json();
        if (
          initialConnectionCountRef.current !== null &&
          typeof data.total === "number" &&
          data.total > initialConnectionCountRef.current
        ) {
          setSyncSuccess(true);
          setIsListening(false);
          setTimeout(() => {
            onSuccess?.();
            onClose();
          }, 800);
        }
      } catch {
        // poll retry
      }
    }, 1500);

    return () => {
      window.removeEventListener("focus", checkClipboardOnFocus);
      window.removeEventListener("message", handleWindowMessage);
      window.removeEventListener("paste", handlePasteEvent);
      clearInterval(interval);
    };
  }, [isListening, executeImport, onSuccess, onClose]);

  const handleConnect = () => {
    setIsListening(true);
    setError(null);
    window.open("https://chatgpt.com/api/auth/session", "cgw_session", "width=650,height=700,menubar=no,toolbar=no");
  };

  const handleReadClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        setShowManual(true);
        setError("Browser tidak mengizinkan akses clipboard otomatis. Silakan paste manual di kotak input bawah.");
        return;
      }
      const text = await navigator.clipboard.readText();
      const trimmed = (text || "").trim();
      if (
        trimmed &&
        (trimmed.includes('"accessToken"') ||
          trimmed.includes("__Secure-next-auth") ||
          (trimmed.startsWith("eyJh") && trimmed.split(".").length === 3))
      ) {
        setInputValue(trimmed);
        executeImport(trimmed);
      } else {
        setShowManual(true);
        setError("Clipboard belum berisi data sesi ChatGPT. Silakan salin teks (Ctrl+A lalu Ctrl+C) pada jendela ChatGPT di samping terlebih dahulu.");
      }
    } catch {
      setShowManual(true);
      setError("Izin clipboard diblokir browser. Silakan tekan Ctrl+V atau tempel di kotak input manual di bawah.");
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect ChatGPT Web" onClose={onClose} size="md">
      <div className="flex flex-col gap-4">
        {syncSuccess && (
          <div className="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center gap-3 animate-pulse">
            <span className="material-symbols-outlined text-2xl">check_circle</span>
            <div>
              <div className="font-bold text-sm">Berhasil Tersinkronisasi!</div>
              <div className="text-xs text-text-muted">Koneksi ChatGPT Web Anda telah aktif dan siap digunakan.</div>
            </div>
          </div>
        )}

        <div className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl p-5 text-center flex flex-col items-center gap-3">
          <div className="size-12 rounded-2xl bg-[#10A37F]/20 text-[#10A37F] flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl">smart_toy</span>
          </div>

          <div className="space-y-1">
            <h4 className="font-semibold text-text-primary text-base">
              Sinkronisasi Akun ChatGPT Web
            </h4>
            <p className="text-text-muted text-xs max-w-sm mx-auto leading-relaxed">
              Klik tombol di bawah untuk membuka sesi ChatGPT. Sistem radar akan otomatis mendeteksi dan mengamankan koneksi akun Anda secara langsung.
            </p>
          </div>

          <Button
            size="lg"
            variant="primary"
            icon={importing ? "progress_activity" : isListening ? "radar" : "bolt"}
            onClick={handleConnect}
            disabled={importing}
            className="w-full max-w-xs mt-1 shadow-lg shadow-primary/20"
          >
            {importing ? "Menghubungkan..." : isListening ? "Buka Kembali Sesi" : "Connect"}
          </Button>

          {isListening && (
            <div className="w-full flex flex-col gap-2.5 p-3.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-emerald-500/30 text-left mt-2 animate-fadeIn">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-500 dark:text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Jendela Sesi Terbuka — Siap Sinkronisasi</span>
              </div>

              <div className="text-xs text-text-secondary space-y-1 leading-relaxed bg-surface/60 p-2.5 rounded-lg border border-border/40">
                <p><strong>1.</strong> Pada jendela <em>chatgpt.com/api/auth/session</em> di samping: tekan <strong>Ctrl + A</strong> lalu <strong>Ctrl + C</strong> (Salin Semua).</p>
                <p><strong>2.</strong> Klik tombol di bawah atau cukup tekan <strong>Ctrl + V</strong> di mana saja.</p>
              </div>

              <Button
                size="md"
                variant="primary"
                icon={importing ? "progress_activity" : "content_paste"}
                onClick={handleReadClipboard}
                disabled={importing}
                className="w-full shadow-md shadow-emerald-500/20 bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {importing ? "Menyimpan Sesi..." : "📋 Tempel dari Clipboard & Simpan"}
              </Button>
            </div>
          )}
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowManual((prev) => !prev)}
            className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">
              {showManual ? "expand_less" : "expand_more"}
            </span>
            <span>Input Manual (Opsional)</span>
          </button>

          {showManual && (
            <div className="mt-2.5 flex flex-col gap-2">
              <textarea
                className="w-full h-24 p-3 rounded-xl border border-border bg-surface text-text-primary text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Paste accessToken atau JSON session dari https://chatgpt.com/api/auth/session..."
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (error) setError(null);
                }}
              />

              {parsedInfo && (
                <div
                  className={`p-3 rounded-xl border text-xs ${
                    parsedInfo.validJwt
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100"
                  }`}
                >
                  {parsedInfo.validJwt ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <span className="material-symbols-outlined text-base">verified</span>
                          Token ChatGPT Terverifikasi
                        </span>
                        <span className="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                          {parsedInfo.planType} Plan
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-emerald-500/20 text-text-secondary">
                        <div>
                          <span className="text-text-muted">Akun:</span>{" "}
                          <span className="font-medium text-text-primary">{parsedInfo.email}</span>
                        </div>
                        {parsedInfo.exp && (
                          <div>
                            <span className="text-text-muted">Kadaluarsa:</span>{" "}
                            <span className="font-medium text-text-primary">{parsedInfo.exp}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <span className="material-symbols-outlined text-base">info</span>
                      <span>Format token akan disimpan langsung sebagai raw access token.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-base shrink-0">error</span>
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <Button variant="secondary" onClick={onClose} disabled={importing}>
            Tutup
          </Button>
          {showManual && (
            <Button
              variant="primary"
              onClick={() => executeImport(parsedInfo?.rawToken || inputValue.trim())}
              disabled={!inputValue.trim() || importing}
              icon={importing ? "progress_activity" : "check"}
            >
              {importing ? "Menyimpan..." : "Simpan Token"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

ChatGPTWebAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
