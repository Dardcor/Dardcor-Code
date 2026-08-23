export const FEATURE_FLAGS = [
  {
    key: "cacheL2Enabled",
    name: "Semantic response cache",
    description: "Reuse responses for semantically similar requests. Requires a configured embedding model.",
  },
  {
    key: "cacheL3Enabled",
    name: "Content deduplication",
    description: "Replace repeated large request content with references before routing.",
  },
  {
    key: "headroomEnabled",
    name: "Headroom proxy",
    description: "Route supported chat requests through the configured Headroom service.",
  },
  {
    key: "pxpipeEnabled",
    name: "PXPipe transform",
    description: "Apply the configured PXPipe transform to supported chat requests.",
  },
];

export const GUARDRAILS = [
  {
    id: "dashboard-auth",
    name: "Dashboard authentication",
    description: "Protected dashboard APIs require a signed dashboard session when login is enabled.",
    settingKey: "requireLogin",
  },
  {
    id: "llm-api-key",
    name: "LLM API key authentication",
    description: "LLM handlers validate configured API keys when this setting is enabled. Remote API access is authenticated independently at the routing boundary.",
    settingKey: "requireApiKey",
  },
  {
    id: "api-default-deny",
    name: "Dashboard API default deny",
    description: "API routes outside the public allow-list require dashboard-session or machine CLI authentication.",
    enforced: true,
  },
  {
    id: "local-sensitive-routes",
    name: "Local-only sensitive actions",
    description: "Host-secret and process-control routes require a local authenticated browser or machine CLI token.",
    enforced: true,
  },
  {
    id: "ssrf-target-checks",
    name: "Server-side fetch target checks",
    description: "The web-fetch endpoint and provider-node validation reject loopback, private, link-local, and internal host targets.",
    enforced: true,
  },
];
