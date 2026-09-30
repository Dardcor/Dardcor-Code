"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

function parseRawInput(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;

  let cookies = trimmed;
  let snlm0e = "";
  let isCurl = false;

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      cookies = parsed.cookies || parsed.cookie || parsed.token || cookies;
      snlm0e = parsed.snlm0e || parsed.at || "";
    } catch {}
  }

  if (cookies.includes("curl ") || cookies.includes("-H ")) {
    isCurl = true;
    const cookieHeaderMatch =
      cookies.match(/-H\s+['"][Cc]ookie:\s*([^'"]+)['"]/i) ||
      cookies.match(/--header\s+['"][Cc]ookie:\s*([^'"]+)['"]/i);
    if (cookieHeaderMatch) {
      cookies = cookieHeaderMatch[1].trim();
    }
    const atMatch = cookies.match(/[?&]at=([^&'"]+)/) || cookies.match(/['"]at['"]\s*:\s*['"]([^'"]+)['"]/);
    if (atMatch) {
      snlm0e = atMatch[1];
    }
  }

  if (cookies.includes("Cookie:") || cookies.includes("cookie:")) {
    const lineMatch = cookies.match(/^[Cc]ookie:\s*(.+)$/m);
    if (lineMatch) {
      cookies = lineMatch[1].trim();
    }
  }

  const hasPsid = cookies.includes("__Secure-1PSID=") || (!cookies.includes("=") && cookies.length > 50);
  const hasPsidts = cookies.includes("__Secure-1PSIDTS=");
  const hasSnlm0e = Boolean(snlm0e);

  return {
    isCurl,
    hasPsid,
    hasPsidts,
    hasSnlm0e,
    parsedCookies: cookies,
    snlm0e,
  };
}

export default function GeminiWebAuthModal({ isOpen, onSuccess, onClose }) {
  const [inputValue, setInputValue] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [activeTab, setActiveTab] = useState("smart");

  const { copied: copiedExtPath, copy: copyExtPath } = useCopyToClipboard();
  const initialConnectionCountRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/gemini-web/status");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.accounts)) {
        setConnectedAccounts(data.accounts);
      }
      if (typeof data.total === "number" && initialConnectionCountRef.current === null) {
        initialConnectionCountRef.current = data.total;
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setIsListening(false);
      setSyncSuccess(false);
      setInputValue("");
      setError(null);
      initialConnectionCountRef.current = null;
      return;
    }

    fetchStatus();
    setIsListening(true);
  }, [isOpen, fetchStatus]);

  const parsedInfo = useMemo(() => parseRawInput(inputValue), [inputValue]);

  const executeImport = useCallback(
    async (payload) => {
      setImporting(true);
      setError(null);

      try {
        const res = await fetch("/api/oauth/gemini-web/import-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Gagal mengimpor koneksi Gemini Web");
        }

        setSyncSuccess(true);
        setIsListening(false);
        await fetchStatus();
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 900);
      } catch (err) {
        setError(err.message || "Gagal mengimpor cookie/token");
      } finally {
        setImporting(false);
      }
    },
    [onSuccess, onClose, fetchStatus]
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
          (trimmed.includes("__Secure-1PSID") ||
            trimmed.includes("curl ") ||
            trimmed.includes("gemini.google.com") ||
            trimmed.includes('"cookies"'))
        ) {
          setInputValue(trimmed);
        }
      } catch {}
    };

    window.addEventListener("focus", checkClipboardOnFocus);
    return () => {
      window.removeEventListener("focus", checkClipboardOnFocus);
    };
  }, [isListening]);

  useEffect(() => {
    if (!isListening) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/oauth/gemini-web/status");
        if (!res.ok) return;
        const data = await res.json();
        if (
          initialConnectionCountRef.current !== null &&
          typeof data.total === "number" &&
          data.total > initialConnectionCountRef.current
        ) {
          setSyncSuccess(true);
          setIsListening(false);
          await fetchStatus();
          setTimeout(() => {
            onSuccess?.();
            onClose();
          }, 800);
        }
      } catch {}
    }, 1500);

    return () => clearInterval(interval);
  }, [isListening, onSuccess, onClose, fetchStatus]);

  const handleOpenPage = () => {
    setIsListening(true);
    window.open("https://gemini.google.com/app", "_blank", "noopener,noreferrer");
  };

  const extensionLocalPath = "extensions/gemini-web-sync";

  return (
    <Modal isOpen={isOpen} title="Hubungkan Gemini Web (Multi-Akun Dinamis)" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {syncSuccess && (
          <div className="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center gap-3 animate-pulse">
            <span className="material-symbols-outlined text-2xl">check_circle</span>
            <div>
              <div className="font-bold text-sm">Berhasil Tersinkronisasi!</div>
              <div className="text-xs text-text-muted">Akun Gemini Web baru telah ditambahkan dan siap digunakan.</div>
            </div>
          </div>
        )}

        {connectedAccounts.length > 0 && (
          <div className="p-3 rounded-xl bg-surface-secondary/70 border border-border/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-400"></span>
                {connectedAccounts.length} Akun Terhubung di Router:
              </span>
              <span className="text-[11px] text-text-muted">Bisa tambah akun sebanyak-banyaknya</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {connectedAccounts.map((acc, idx) => (
                <div
                  key={acc.id || idx}
                  className="px-2.5 py-1 rounded-lg bg-surface border border-border/60 text-xs flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm text-[#1A73E8]">account_circle</span>
                  <span className="font-medium text-text-primary">{acc.email || acc.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">
                    #{acc.priority || idx + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex border-b border-border text-xs font-medium">
          <button
            type="button"
            className={`pb-2 px-3 border-b-2 transition-colors ${
              activeTab === "smart"
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
            onClick={() => setActiveTab("smart")}
          >
            Metode Cepat (cURL / Cookies)
          </button>
          <button
            type="button"
            className={`pb-2 px-3 border-b-2 transition-colors ${
              activeTab === "extension"
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
            onClick={() => setActiveTab("extension")}
          >
            Ekstensi Mini (1-Klik Otomatis)
          </button>
        </div>

        {activeTab === "smart" ? (
          <>
            <div className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="size-9 rounded-lg bg-[#1A73E8]/20 text-[#1A73E8] flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-xl">travel_explore</span>
                </div>
                <div className="flex-1 text-sm">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className="font-semibold text-text-primary">Panduan 2 Langkah Mengambil Sesi Gemini</h4>
                    {isListening && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 flex items-center gap-1 animate-pulse">
                        <span className="size-1.5 rounded-full bg-emerald-400"></span>
                        Radar Aktif
                      </span>
                    )}
                  </div>
                  <ol className="text-xs text-text-muted space-y-1 mb-3 list-decimal list-inside">
                    <li>
                      Buka <span className="text-text-primary font-medium">gemini.google.com/app</span> di Chrome, tekan <code className="bg-black/20 px-1 rounded">F12</code> → tab <strong>Network</strong>.
                    </li>
                    <li>
                      Ketik prompt di Gemini atau refresh halaman, klik kanan request <strong>StreamGenerate</strong> (atau <code className="bg-black/20 px-1 rounded">app</code>) → <strong>Copy</strong> → <strong>Copy as cURL</strong>.
                    </li>
                    <li>
                      Kembali ke sini: Radar otomatis mengisi form di bawah, lalu klik <strong>Hubungkan Akun</strong>.
                    </li>
                  </ol>

                  <Button size="sm" variant="primary" icon="open_in_new" onClick={handleOpenPage}>
                    Buka gemini.google.com/app &amp; Aktifkan Radar
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-secondary flex items-center justify-between">
                <span>Tempel cURL, Header, atau Cookie (__Secure-1PSID &amp; __Secure-1PSIDTS)</span>
                <span className="text-[11px] text-text-muted font-normal">Mendukung format cURL, JSON, atau teks cookie</span>
              </label>
              <textarea
                className="w-full h-28 p-3 rounded-xl border border-border bg-surface text-text-primary text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Paste perintah cURL dari DevTools atau cookie string (__Secure-1PSID=...; __Secure-1PSIDTS=...)..."
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (error) setError(null);
                }}
              />
            </div>

            {parsedInfo && (
              <div className="p-3 rounded-xl border bg-surface-secondary/50 border-border text-xs space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {parsedInfo.isCurl && (
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-semibold flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">terminal</span> Perintah cURL Terdeteksi
                    </span>
                  )}
                  {parsedInfo.hasPsid && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">check</span> __Secure-1PSID Ada
                    </span>
                  )}
                  {parsedInfo.hasPsidts && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">verified</span> __Secure-1PSIDTS Ada (Optimal)
                    </span>
                  )}
                  {parsedInfo.hasSnlm0e && (
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-semibold flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">token</span> Token SNlM0e Ada
                    </span>
                  )}
                </div>
                {!parsedInfo.hasPsidts && parsedInfo.hasPsid && (
                  <div className="text-[11px] text-amber-400/90 pt-1">
                    Tips: Menyertakan <code className="bg-black/20 px-1 rounded">__Secure-1PSIDTS</code> (dengan Copy as cURL dari Network tab) memastikan sesi login tidak ditolak oleh Google.
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="p-4 rounded-xl bg-surface-secondary/60 border border-border text-xs space-y-3">
            <div className="flex items-center gap-2 font-semibold text-text-primary text-sm">
              <span className="material-symbols-outlined text-[#1A73E8]">extension</span>
              Ekstensi Mini: Dardcor Gemini Web Sync
            </div>
            <p className="text-text-muted leading-relaxed">
              Ekstensi ini membaca cookie sesi Google Anda secara langsung via browser API (termasuk HttpOnly cookies) dan menyinkronkannya ke router dengan 1 klik tanpa perlu membuka DevTools.
            </p>
            <div className="bg-surface p-3 rounded-lg border border-border/80 font-mono text-[11px] text-text-secondary space-y-1">
              <div className="text-text-muted font-sans font-medium">Lokasi Folder Ekstensi di Komputer Anda:</div>
              <div className="text-primary break-all select-all font-bold">{extensionLocalPath}</div>
            </div>
            <div className="space-y-1 text-text-muted leading-relaxed">
              <div><strong>Cara Pasang (Hanya 10 Detik):</strong></div>
              <div>1. Buka Chrome/Edge, masuk ke <code className="bg-black/20 px-1 rounded">chrome://extensions</code></div>
              <div>2. Nyalakan toggle <strong>Developer mode</strong> di kanan atas</div>
              <div>3. Klik tombol <strong>Load unpacked</strong> dan pilih folder di atas</div>
              <div>4. Buka tab <strong>gemini.google.com/app</strong>, klik ikon ekstensi lalu klik <strong>Sync Akun ke Router</strong></div>
            </div>
            <div className="pt-1">
              <Button
                size="sm"
                variant="secondary"
                icon={copiedExtPath ? "check" : "content_copy"}
                onClick={() => copyExtPath(extensionLocalPath)}
              >
                {copiedExtPath ? "✓ Path Tersalin" : "Salin Path Folder Ekstensi"}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-base shrink-0">error</span>
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <Button variant="secondary" onClick={onClose} disabled={importing}>
            Tutup
          </Button>
          {activeTab === "smart" && (
            <Button
              variant="primary"
              onClick={() =>
                executeImport({
                  cookies: parsedInfo?.parsedCookies || inputValue.trim(),
                  snlm0e: parsedInfo?.snlm0e || undefined,
                })
              }
              disabled={!inputValue.trim() || importing}
              icon={importing ? "progress_activity" : "add_link"}
            >
              {importing ? "Menyambungkan..." : "Hubungkan Akun"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

GeminiWebAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
