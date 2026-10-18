"use client";

import { CAPACITY_META } from "@/shared/constants/models";
import Tooltip from "./Tooltip";

export default function CapacityBadges({ caps, className = "", colorOverride, size = 16 }) {
  if (!caps) return null;
  const active = Object.keys(CAPACITY_META).filter((k) => caps[k]);
  if (active.length === 0) return null;

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {active.map((k) => (
        <Tooltip key={k} text={`${CAPACITY_META[k].label} — ${CAPACITY_META[k].desc}`}>
          <span
            className={`material-symbols-outlined leading-none cursor-help ${colorOverride || CAPACITY_META[k].color}`}
            style={{ fontSize: `${size}px` }}
          >
            {CAPACITY_META[k].icon}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
