"use client";

import { useMemo, useState, useEffect, useCallback, useRef, memo } from "react";
import PropTypes from "prop-types";
import {
  ReactFlow,
  Handle,
  Position,
  Controls,
  BaseEdge,
  getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";

// Force-stop FE animation if a provider stays active longer than this
const FE_ACTIVE_TIMEOUT_MS = 60000;

// Provider alias mapping so active requests for aliases illuminate correct node
const PROVIDER_ALIAS_GROUPS = [
  ["opencode", "oc", "opencode-free"],
  ["opencode-zen", "ocz"],
  ["opencode-go", "ocg"],
  ["antigravity", "ag"],
  ["codex", "openai", "openai-codex"],
  ["claude", "anthropic"],
  ["gemini", "google", "gemini-cli"],
];

function matchesProvider(set, providerId) {
  if (!set || set.size === 0 || !providerId) return false;
  const target = providerId.toLowerCase().trim();
  if (set.has(target)) return true;
  for (const group of PROVIDER_ALIAS_GROUPS) {
    if (group.includes(target)) {
      for (const alias of group) {
        if (set.has(alias)) return true;
      }
    }
  }
  return false;
}

function extractProviderId(p) {
  if (!p) return null;
  if (typeof p === "string") return p.toLowerCase().trim();
  const id = p.provider || p.id;
  return id ? String(id).toLowerCase().trim() : null;
}

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { color: "#6b7280", name: providerId };
}

function getProviderImageUrl(providerId) {
  return getProviderIconSrc(providerId);
}

// Custom provider node - memoized to prevent re-rendering when other nodes change
const ProviderNode = memo(function ProviderNode({ data }) {
  const { label, color, imageUrl, textIcon, active } = data;
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 transition-all duration-300 bg-bg"
      style={{
        borderColor: active ? color : "var(--color-border)",
        boxShadow: active ? `0 0 16px ${color}40` : "none",
        minWidth: "150px",
      }}
    >
      <Handle type="target" position={Position.Top} id="top" className="!opacity-0 !pointer-events-none" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!opacity-0 !pointer-events-none" />
      <Handle type="target" position={Position.Left} id="left" className="!opacity-0 !pointer-events-none" />
      <Handle type="target" position={Position.Right} id="right" className="!opacity-0 !pointer-events-none" />

      {/* Provider icon */}
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        {imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={label}
            className="w-6 h-6 rounded-sm object-contain"
            loading="lazy"
            decoding="async"
            onError={() => {
              const m = imageUrl?.match(/^\/providers\/([^/]+)\.png$/i);
              if (m) markProviderIconMissing(m[1]);
              setImgError(true);
            }}
          />
        ) : (
          <span className="text-sm font-bold" style={{ color }}>{textIcon}</span>
        )}
      </div>

      {/* Provider name */}
      <span
        className="text-base font-medium truncate"
        style={{ color: active ? color : "var(--color-text)" }}
      >
        {label}
      </span>

      {/* Active indicator */}
      {active && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
        </span>
      )}
    </div>
  );
});

ProviderNode.propTypes = {
  data: PropTypes.object.isRequired,
};

// Center Dardcor Router node - memoized
const RouterNode = memo(function RouterNode({ data }) {
  const powering = (data.activeCount || 0) > 0;
  return (
    <div
      className={`relative z-[1] flex items-center justify-center px-5 py-3 rounded-xl border-2 min-w-[130px] ${
        powering
          ? "topology-router-core border-yellow-300 bg-gradient-to-br from-primary/30 via-yellow-400/20 to-cyan-400/25"
          : "border-primary bg-primary/5 shadow-md"
      }`}
    >
      <Handle type="source" position={Position.Top} id="top" className="!opacity-0 !pointer-events-none" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!opacity-0 !pointer-events-none" />
      <Handle type="source" position={Position.Left} id="left" className="!opacity-0 !pointer-events-none" />
      <Handle type="source" position={Position.Right} id="right" className="!opacity-0 !pointer-events-none" />

      <img
        src="/apple-icon.png"
        alt="Dardcor Router"
        className={`w-6 h-6 mr-2 ${powering ? "topology-router-icon" : ""}`}
        loading="lazy"
        decoding="async"
      />
      <span className={`text-sm font-bold ${powering ? "topology-router-label text-yellow-300" : "text-primary"}`}>
        Dardcor Router
      </span>
      {data.activeCount > 0 && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-yellow-400 text-black text-xs font-bold topology-router-badge">
          {data.activeCount}
        </span>
      )}
    </div>
  );
});

RouterNode.propTypes = {
  data: PropTypes.object.isRequired,
};

// GPU-accelerated Kame / Electric cable edge - memoized
const TopologyEdge = memo(function TopologyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
}) {
  if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    return null;
  }

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const active = !!data?.active;
  const stroke = style.stroke || "var(--color-border)";

  if (!active) {
    return <BaseEdge id={id} path={edgePath} style={{ ...style, stroke }} />;
  }

  return (
    <g className="topology-edge-electric">
      {/* Outer electric halo (GPU-accelerated CSS flicker) */}
      <path
        d={edgePath}
        fill="none"
        stroke="#22d3ee"
        strokeWidth={9}
        strokeOpacity={0.35}
        strokeLinecap="round"
        className="topology-edge-halo"
      />
      {/* Mid plasma (GPU-accelerated CSS dash + flicker) */}
      <path
        d={edgePath}
        fill="none"
        stroke="#4ade80"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeLinecap="round"
        className="topology-edge-plasma"
      />
      {/* Hot white core */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: "#f8fafc", strokeWidth: 2.2, opacity: 1 }}
        className="topology-edge-kame"
      />
      {/* Smooth flowing Kame energy orbs */}
      <circle r={3.8} fill="#fde047" opacity={0.95}>
        <animateMotion dur="0.8s" repeatCount="indefinite" path={edgePath} />
      </circle>
      <circle r={2.6} fill="#67e8f9" opacity={0.9}>
        <animateMotion dur="0.6s" repeatCount="indefinite" path={edgePath} begin="0.25s" />
      </circle>
      <circle r={3.2} fill="#ffffff" opacity={0.95}>
        <animateMotion dur="1.0s" repeatCount="indefinite" path={edgePath} begin="0.5s" />
      </circle>
    </g>
  );
});

TopologyEdge.propTypes = {
  id: PropTypes.string,
  sourceX: PropTypes.number,
  sourceY: PropTypes.number,
  targetX: PropTypes.number,
  targetY: PropTypes.number,
  sourcePosition: PropTypes.string,
  targetPosition: PropTypes.string,
  style: PropTypes.object,
  data: PropTypes.object,
};

const nodeTypes = { provider: ProviderNode, router: RouterNode };
const edgeTypes = { topology: TopologyEdge };

// Place N nodes evenly along an ellipse around the router center
function buildLayout(uniqueProviders, activeSet, lastSet, errorSet) {
  const nodeW = 180;
  const nodeH = 44;
  const routerW = 140;
  const routerH = 48;
  const nodeGap = 28;

  const count = uniqueProviders.length;

  if (count === 0) {
    return {
      nodes: [
        {
          id: "router",
          type: "router",
          position: { x: -routerW / 2, y: -routerH / 2 },
          width: routerW,
          height: routerH,
          data: { activeCount: 0 },
          draggable: false,
        },
      ],
      edges: [],
    };
  }

  // Safe radius calculation with guaranteed lower bounds
  const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const rx = Math.max(count === 1 ? 260 : 320, minRx);
  const ry = Math.max(count === 1 ? 160 : 200, rx * 0.55);

  const nodes = [];
  const edges = [];

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    width: routerW,
    height: routerH,
    data: { activeCount: activeSet.size },
    draggable: false,
  });

  const edgeStyle = (active, last, error) => {
    if (error) return { stroke: "#ef4444", strokeWidth: 2.5, opacity: 0.9 };
    if (active) return { stroke: "#22d3ee", strokeWidth: 3.5, opacity: 1 };
    if (last) return { stroke: "#f59e0b", strokeWidth: 2, opacity: 0.7 };
    return { stroke: "var(--color-border)", strokeWidth: 1, opacity: 0.35 };
  };

  uniqueProviders.forEach((p, i) => {
    const providerId = p.provider;
    const config = getProviderConfig(providerId);
    const active = matchesProvider(activeSet, providerId);
    const last = !active && matchesProvider(lastSet, providerId);
    const error = !active && matchesProvider(errorSet, providerId);
    const nodeId = `provider-${providerId}`;

    const data = {
      label: (config.name !== providerId ? config.name : null) || p.nodeName || p.name || providerId,
      color: config.color || "#6b7280",
      imageUrl: getProviderImageUrl(providerId),
      textIcon: config.textIcon || (providerId || "?").slice(0, 2).toUpperCase(),
      active,
    };

    // Calculate angle: count === 1 placed at top (-PI/2), otherwise distributed evenly
    const angle = count === 1 ? -Math.PI / 2 : -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    // Pick handles based on normalized quadrant angle
    const norm = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let sourceHandle, targetHandle;

    if (Math.abs(norm - (3 * Math.PI) / 2) < Math.PI / 4) {
      sourceHandle = "top";
      targetHandle = "bottom";
    } else if (Math.abs(norm - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom";
      targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right";
      targetHandle = "left";
    } else {
      sourceHandle = "left";
      targetHandle = "right";
    }

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      width: nodeW,
      height: nodeH,
      data,
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      type: "topology",
      source: "router",
      sourceHandle,
      target: nodeId,
      targetHandle,
      animated: false,
      data: { active },
      style: edgeStyle(active, last, error),
    });
  });

  return { nodes, edges };
}

export default function ProviderTopology({
  providers = [],
  activeRequests = [],
  lastProvider = "",
  errorProvider = "",
}) {
  // Deduplicate and normalize providers securely (prevents duplicate key collisions)
  const uniqueProviders = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const p of providers || []) {
      const id = extractProviderId(p);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push({
        ...p,
        provider: id,
      });
    }
    return result;
  }, [providers]);

  // Stable string keys for active/recent states
  const activeKey = useMemo(
    () => activeRequests.map((r) => r.provider?.toLowerCase()).filter(Boolean).sort().join(","),
    [activeRequests]
  );
  const lastKey = lastProvider?.toLowerCase().trim() || "";
  const errorKey = errorProvider?.toLowerCase().trim() || "";

  const rawActiveSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);

  // Handle provider active timeouts (> 60s) via targeted timeouts (Zero 1-sec tick re-render lag)
  const [timedOutProviders, setTimedOutProviders] = useState(() => new Set());
  const activeTimersRef = useRef(new Map());

  useEffect(() => {
    const currentTimers = activeTimersRef.current;

    for (const p of rawActiveSet) {
      if (!currentTimers.has(p)) {
        const timerId = setTimeout(() => {
          setTimedOutProviders((prev) => new Set(prev).add(p));
        }, FE_ACTIVE_TIMEOUT_MS);
        currentTimers.set(p, timerId);
      }
    }

    for (const [p, timerId] of currentTimers.entries()) {
      if (!rawActiveSet.has(p)) {
        clearTimeout(timerId);
        currentTimers.delete(p);
        setTimedOutProviders((prev) => {
          if (!prev.has(p)) return prev;
          const next = new Set(prev);
          next.delete(p);
          return next;
        });
      }
    }
  }, [rawActiveSet]);

  useEffect(() => {
    const timers = activeTimersRef.current;
    return () => {
      for (const timerId of timers.values()) {
        clearTimeout(timerId);
      }
      timers.clear();
    };
  }, []);

  const activeSet = useMemo(() => {
    const filtered = new Set();
    for (const p of rawActiveSet) {
      if (!timedOutProviders.has(p)) {
        filtered.add(p);
      }
    }
    return filtered;
  }, [rawActiveSet, timedOutProviders]);

  const { nodes, edges } = useMemo(
    () => buildLayout(uniqueProviders, activeSet, lastSet, errorSet),
    [uniqueProviders, activeSet, lastSet, errorSet]
  );

  const rfInstance = useRef(null);
  const containerRef = useRef(null);
  const initialFitDone = useRef(false);
  const prevCountRef = useRef(0);
  const fitOpts = { padding: 0.25, duration: 250 };

  const onInit = useCallback((instance) => {
    rfInstance.current = instance;
    setTimeout(() => {
      instance.fitView({ padding: 0.25, duration: 200 });
      initialFitDone.current = true;
    }, 50);
  }, []);

  // Re-fit view ONLY when provider count actually changes (e.g. initial load 0 -> N)
  useEffect(() => {
    if (!rfInstance.current || uniqueProviders.length === 0) return;

    if (prevCountRef.current !== uniqueProviders.length) {
      prevCountRef.current = uniqueProviders.length;
      const timer = setTimeout(() => {
        rfInstance.current?.fitView(fitOpts);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [uniqueProviders.length]);

  // ResizeObserver: Only perform initial fit when container gets non-zero dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let resizeTimer;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && !initialFitDone.current && rfInstance.current) {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            rfInstance.current?.fitView({ padding: 0.25, duration: 0 });
            initialFitDone.current = true;
          }, 50);
        }
      }
    });

    ro.observe(el);
    return () => {
      clearTimeout(resizeTimer);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-[320px] w-full min-w-0 rounded-lg border border-border bg-bg-subtle/30 sm:h-[480px]"
    >
      {uniqueProviders.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          No providers connected
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={fitOpts}
          minZoom={0.1}
          maxZoom={2}
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} className="react-flow-controls-custom" />
        </ReactFlow>
      )}
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      provider: PropTypes.string,
      name: PropTypes.string,
    })
  ),
  activeRequests: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string,
      model: PropTypes.string,
      account: PropTypes.string,
    })
  ),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};
