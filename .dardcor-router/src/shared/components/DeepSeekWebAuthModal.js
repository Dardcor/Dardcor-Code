"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const DIRECT_PUSH_SNIPPET = `javascript:(async()=>{try{const r=localStorage.getItem('userToken');if(!r)return alert('Silakan login di chat.deepseek.com terlebih dahulu');const t=JSON.parse(r).value||r;const res=await fetch('http://localhost:25128/api/oauth/deepseek-web/import-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userToken:t})});if(res.ok){alert('Akun DeepSeek Web berhasil langsung otomatis tersambung ke router!');}else{const e=await res.json().catch(()=>({}));alert('Gagal: '+(e.error||res.status));}}catch(e){alert('Error: '+e.message);}})();`;

function isCandidateToken(str) {
  if (!str || typeof str !== "string") return false;
  const trimmed = str.trim();
  if (trimmed.includes('"userToken"') || trimmed.includes('"value"')) return true;
  if (trimmed.startsWith("eyJh") && trimmed.split(".").length === 3) return true;
  if (/^[A-Za-z0-9+/=_-]{40,120}$/.test(trimmed)) return true;
  return false;
}

export default function DeepSeekWebAuthModal({ isOpen, onSuccess, onClose }) {
  const [inputValue, setInputValue] = useState("");
  const [importing, setImporting] = useState(false);
  const [importStatusText, setImportStatusText] = useState("");
  const [error, setError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [autoDetected, setAutoDetected] = useState(null);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [syncedAccountName, setSyncedAccountName] = useState("");

  const { copied: copiedSnippet, copy: copySnippet } = useCopyToClipboard();
  const initialConnectionCountRef = useRef(null);
  const importingRef = useRef(false);

  const executeImport = useCallback(
    async (tokenOrJson, email = null, name = null) => {
      if (importingRef.current) return;
      importingRef.current = true;
      setImporting(true);
      setError(null);
      setImportStatusText(`Menyambungkan ${name || email || "akun"}...`);

      try {
        const res = await fetch("/api/oauth/deepseek-web/import-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userToken: tokenOrJson,
            email,
            name,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Gagal mengimpor koneksi DeepSeek Web");
        }

        setSyncedAccountName(data.connection?.name || name || email || "DeepSeek Web");
        setSyncSuccess(true);
        setIsListening(false);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 900);
      } catch (err) {
        setError(err.message || "Gagal mengimpor token sesi DeepSeek");
      } finally {
        importingRef.current = false;
        setImporting(false);
        setImportStatusText("");
      }
    },
    [onSuccess, onClose]
  );

  const pollAutoDetect = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/deepseek-web/auto-detect");
      if (!res.ok) return;
      const data = await res.json();
      setAutoDetected(data);

      if (data?.found && data?.newAccounts?.length > 0 && !importingRef.current) {
        const target = data.newAccounts[0];
        setImportStatusText(`Mendeteksi sesi baru: ${target.name || target.email}...`);
        await executeImport(target.token, target.email, target.name);
      }
    } catch {}
  }, [executeImport]);

  useEffect(() => {
    if (!isOpen) {
      setIsListening(false);
      setSyncSuccess(false);
      setError(null);
      setInputValue("");
      setAutoDetected(null);
      setSyncedAccountName("");
      return;
    }

    let isMounted = true;
    pollAutoDetect();

    fetch("/api/oauth/deepseek-web/status")
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
  }, [isOpen, pollAutoDetect]);

  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      pollAutoDetect();

      fetch("/api/oauth/deepseek-web/status")
        .then((res) => res.json())
        .then((data) => {
          if (
            initialConnectionCountRef.current !== null &&
            typeof data.total === "number" &&
            data.total > initialConnectionCountRef.current &&
            !syncSuccess
          ) {
            setSyncSuccess(true);
            setTimeout(() => {
              onSuccess?.();
              onClose();
            }, 800);
          }
        })
        .catch(() => {});
    }, 1200);

    return () => clearInterval(interval);
  }, [isOpen, pollAutoDetect, syncSuccess, onSuccess, onClose]);

  const parsedInfo = useMemo(() => {
    const raw = inputValue.trim();
    if (!raw) return null;

    let token = raw;
    if (raw.startsWith("{") && raw.endsWith("}")) {
      try {
        const parsed = JSON.parse(raw);
        token = parsed.value || parsed.userToken || parsed.token || token;
      } catch {}
    }

    if (token.startsWith("Bearer ")) {
      token = token.slice(7).trim();
    }

    const isValid = isCandidateToken(token);
    return {
      isValid,
      rawToken: token,
    };
  }, [inputValue]);

  useEffect(() => {
    if (!isListening) return;

    const checkClipboardOnFocus = async () => {
      pollAutoDetect();
      try {
        if (!navigator.clipboard?.readText) return;
        const text = await navigator.clipboard.readText();
        const trimmed = (text || "").trim();

        if (isCandidateToken(trimmed)) {
          setInputValue(trimmed);
          executeImport(trimmed);
        }
      } catch {}
    };

    const handleWindowMessage = (event) => {
      try {
        const data = event.data;
        if (!data) return;
        let token = null;
        if (typeof data === "string" && isCandidateToken(data)) {
          token = data;
        } else if (typeof data === "object" && (data.userToken || data.token || data.value)) {
          token = data.userToken || data.token || data.value;
        }
        if (token) {
          setInputValue(typeof token === "string" ? token : JSON.stringify(token));
          executeImport(token);
        }
      } catch {}
    };

    const handlePasteEvent = (event) => {
      try {
        const text = event.clipboardData?.getData("text") || "";
        const trimmed = text.trim();
        if (isCandidateToken(trimmed)) {
          event.preventDefault();
          setInputValue(trimmed);
          executeImport(trimmed);
        }
      } catch {}
    };

    window.addEventListener("focus", checkClipboardOnFocus);
    window.addEventListener("message", handleWindowMessage);
    window.addEventListener("paste", handlePasteEvent);

    return () => {
      window.removeEventListener("focus", checkClipboardOnFocus);
      window.removeEventListener("message", handleWindowMessage);
      window.removeEventListener("paste", handlePasteEvent);
    };
  }, [isListening, executeImport, pollAutoDetect]);

  const handleConnect = () => {
    setIsListening(true);
    setError(null);
    pollAutoDetect();
    window.open("https://chat.deepseek.com/", "dsw_session", "width=740,height=780,menubar=no,toolbar=no");
  };

  const handleReadClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        setError("Browser tidak mengizinkan akses clipboard otomatis. Silakan tempel manual di kotak input.");
        return;
      }
      const text = await navigator.clipboard.readText();
      const trimmed = (text || "").trim();
      if (isCandidateToken(trimmed)) {
        setInputValue(trimmed);
        executeImport(trimmed);
      } else {
        setError("Clipboard belum berisi token DeepSeek. Silakan salin token terlebih dahulu.");
      }
    } catch {
      setError("Izin clipboard diblokir browser. Silakan tempel manual di kotak input.");
    }
  };

  const newAccounts = autoDetected?.newAccounts || [];
  const connectedAccounts = autoDetected?.connectedAccounts || [];

  return (
    <Modal isOpen={isOpen} title="Connect DeepSeek Web" onClose={onClose} size="md">
      <div className="flex flex-col gap-4">
        {syncSuccess && (
          <div className="p-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center gap-3 animate-pulse">
            <span className="material-symbols-outlined text-2xl">check_circle</span>
            <div>
              <div className="font-bold text-sm">
                Berhasil Tersimpan Otomatis! {syncedAccountName && `(${syncedAccountName})`}
              </div>
              <div className="text-xs text-text-muted">Koneksi DeepSeek Web telah aktif dan siap digunakan.</div>
            </div>
          </div>
        )}

        {newAccounts.length > 0 && !syncSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-emerald-500 animate-spin">sync</span>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Sesi Baru Terdeteksi Langsung ({newAccounts.length} Akun)
              </span>
            </div>
            {newAccounts.map((acc, idx) => (
              <div
                key={acc.token || idx}
                className="flex items-center justify-between p-2 rounded-lg bg-surface/80 border border-border/40 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="size-6 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center font-bold text-[10px] shrink-0">
                    {acc.name ? acc.name.charAt(0).toUpperCase() : "D"}
                  </span>
                  <div className="truncate">
                    <div className="font-medium text-text-primary truncate">{acc.name || acc.email}</div>
                    <div className="text-[11px] text-text-muted truncate">
                      {acc.email} • <span className="opacity-75">{acc.source}</span>
                    </div>
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="primary"
                  onClick={() => executeImport(acc.token, acc.email, acc.name)}
                  disabled={importing}
                  icon={importing ? "progress_activity" : "bolt"}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  {importing ? "Menyimpan..." : "Sambungkan"}
                </Button>
              </div>
            ))}
          </div>
        )}

        {newAccounts.length === 0 && connectedAccounts.length > 0 && !syncSuccess && (
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/25 flex flex-col gap-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-blue-500">info</span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">
                  Sesi Browser Aktif Sudah Terhubung ({connectedAccounts.length} Akun)
                </span>
              </div>
            </div>
            <div className="space-y-1.5 pt-0.5">
              {connectedAccounts.map((acc, idx) => (
                <div
                  key={acc.token || idx}
                  className="flex items-center justify-between p-2 rounded-lg bg-surface/60 border border-border/30"
                >
                  <div className="truncate min-w-0 pr-2">
                    <div className="font-medium text-text-primary truncate">{acc.name || acc.email}</div>
                    <div className="text-[11px] text-text-muted truncate">
                      {acc.email} • {acc.source} <span className="text-emerald-500 font-semibold">(Aktif)</span>
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => executeImport(acc.token, acc.email, acc.name)}
                    disabled={importing}
                    icon="refresh"
                  >
                    Perbarui
                  </Button>
                </div>
              ))}
              <div className="text-[11px] text-text-muted pt-1">
                Untuk menambah akun baru ke-4 dst., silakan login dengan akun berbeda di browser, atau ganti profil browser. Radar otomatis akan langsung menariknya begitu terdeteksi.
              </div>
            </div>
          </div>
        )}

        <div className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl p-5 text-center flex flex-col items-center gap-3">
          <div className="size-12 rounded-2xl bg-[#4D6BFE]/20 text-[#4D6BFE] flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl">psychology</span>
          </div>

          <div className="space-y-1">
            <h4 className="font-semibold text-text-primary text-base">
              Deteksi Otomatis DeepSeek Web
            </h4>
            <p className="text-text-muted text-xs max-w-sm mx-auto leading-relaxed">
              Buka chat.deepseek.com pada jendela browser. Radar router akan langsung mendeteksi dan menarik sesi akun secara otomatis begitu Anda login.
            </p>
          </div>

          <Button
            size="lg"
            variant="primary"
            icon={importing ? "progress_activity" : isListening ? "radar" : "bolt"}
            onClick={handleConnect}
            disabled={importing}
            className="w-full max-w-xs mt-1 shadow-lg shadow-primary/20 bg-[#4D6BFE] hover:bg-[#3D5BEE] text-white"
          >
            {importing ? "Menyimpan Sesi..." : isListening ? "Buka Kembali Sesi" : "Buka chat.deepseek.com"}
          </Button>

          {isListening && (
            <div className="w-full flex flex-col gap-2.5 p-3.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-[#4D6BFE]/30 text-left mt-2 animate-fadeIn">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#4D6BFE]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4D6BFE] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4D6BFE]"></span>
                </span>
                <span>Radar Aktif — Menunggu Sesi Akun Baru dari Browser</span>
              </div>

              <div className="text-xs text-text-secondary space-y-1.5 leading-relaxed bg-surface/60 p-2.5 rounded-lg border border-border/40">
                <p><strong>Jika membuka di tab/browser terpisah:</strong></p>
                <div className="flex items-center gap-2 pt-0.5">
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={copiedSnippet ? "check" : "bolt"}
                    onClick={() => copySnippet(DIRECT_PUSH_SNIPPET)}
                  >
                    {copiedSnippet ? "Kode Tersalin!" : "Salin Kode 1-Klik"}
                  </Button>
                  <span className="text-[11px] text-text-muted">Jalankan di Console / Address bar DeepSeek</span>
                </div>
                <p className="text-[11px] text-text-muted pt-1">
                  Atau salin nilai <code>userToken</code> lalu klik tombol di bawah:
                </p>
              </div>

              <Button
                size="md"
                variant="secondary"
                icon={importing ? "progress_activity" : "content_paste"}
                onClick={handleReadClipboard}
                disabled={importing}
                className="w-full"
              >
                {importing ? "Menyimpan Sesi..." : "Tempel dari Clipboard & Simpan"}
              </Button>
            </div>
          )}

          {importStatusText && (
            <div className="text-xs text-[#4D6BFE] font-medium flex items-center gap-1.5 animate-pulse">
              <span className="material-symbols-outlined text-sm">hourglass_top</span>
              <span>{importStatusText}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-text-primary flex items-center justify-between">
            <span>Input Token / JSON Sesi (Opsional / Manual)</span>
            <span className="text-[11px] text-text-muted font-normal">Dapat menampung akun sebanyak-banyaknya</span>
          </label>

          <textarea
            className="w-full h-16 p-2.5 rounded-xl border border-border bg-surface text-text-primary text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#4D6BFE]/40"
            placeholder="Tempel userToken dari chat.deepseek.com jika radar otomatis tidak aktif..."
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (error) setError(null);
            }}
          />

          {parsedInfo && parsedInfo.isValid && (
            <div className="p-2.5 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100 text-xs">
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                <span className="material-symbols-outlined text-base">verified</span>
                Format Token Valid
              </div>
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
          <Button
            variant="primary"
            onClick={() => executeImport(parsedInfo?.rawToken || inputValue.trim())}
            disabled={!inputValue.trim() || importing}
            icon={importing ? "progress_activity" : "check"}
            className="bg-[#4D6BFE] hover:bg-[#3D5BEE] text-white"
          >
            {importing ? "Menyimpan..." : "Simpan Akun"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

DeepSeekWebAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
