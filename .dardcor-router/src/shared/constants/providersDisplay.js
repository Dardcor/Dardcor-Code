import REGISTRY from "open-sse/providers/registry/index.js";

export const RISK_NOTICE = "⚠️ Risk Notice: This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk.";

const resolveDisplay = (d) =>
  d.deprecationNotice === "RISK_NOTICE" ? { ...d, deprecationNotice: RISK_NOTICE } : d;

export const PROVIDER_DISPLAY = Object.fromEntries(
  REGISTRY.filter((r) => r.display).map((r) => [r.id, resolveDisplay(r.display)]),
);
