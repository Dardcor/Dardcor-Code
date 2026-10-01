"use client";

import { Input } from "@/shared/components";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 w-full">
      <span className={`text-[11px] sm:text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[68px] sm:min-w-[88px] text-center ${
          (badge === "CF" || badge === "TS") ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
        }`}>{label}</span>
      <Input value={url} readOnly className="flex-1 min-w-0 font-mono text-xs sm:text-sm" />
      <button
        type="button"
        onClick={() => onCopy(url, copyId)}
        className="p-1.5 sm:p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0 cursor-pointer"
        aria-label="Copy endpoint URL"
      >
        <span className="material-symbols-outlined text-[16px] sm:text-[18px]">{copied === copyId ? "check" : "content_copy"}</span>
      </button>
      {actions}
    </div>
  );
}
