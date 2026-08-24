import { NextResponse } from "next/server";
import { isRunning } from "@/lib/mcp/stdioSseBridge";
import { LOCAL_STDIO_PLUGINS, DEFAULT_PLUGINS } from "@/shared/constants/coworkPlugins";
import { canAccessLocalOnlyRoute } from "@/dashboardGuard";

const G_KEY = "__dardcor-codeMcpHealth";

function getHealthStore() {
  if (!globalThis[G_KEY]) {
    globalThis[G_KEY] = {
      // Ring buffer of recent invocation events per plugin
      invocations: new Map(),
      maxPerPlugin: 50,
    };
  }
  return globalThis[G_KEY];
}

/**
  * Record whether a tool call was forwarded to a plugin child process.
  * This is transport acceptance telemetry, not plugin execution health.
 */
export function recordInvocation(plugin, ok) {
  const store = getHealthStore();
  if (!store.invocations.has(plugin)) store.invocations.set(plugin, []);
  const arr = store.invocations.get(plugin);
  arr.push({ ts: Date.now(), ok: !!ok });
  // Trim ring buffer
  while (arr.length > store.maxPerPlugin) arr.shift();
}

function getRecentHealth(plugin) {
  const store = getHealthStore();
  const events = store.invocations.get(plugin) || [];
  if (events.length === 0) return { total: 0, ok: 0, fail: 0, lastTs: null };
  const ok = events.filter((e) => e.ok).length;
  return {
    total: events.length,
    ok,
    fail: events.length - ok,
    lastTs: events[events.length - 1].ts,
  };
}

export async function GET(request) {
  if (!(await canAccessLocalOnlyRoute(request))) {
    return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
  }
  try {
    // Aggregate all known plugins: local stdio + remote defaults
    const localPlugins = LOCAL_STDIO_PLUGINS.map((p) => {
      const running = isRunning(p.name);
      const health = getRecentHealth(p.name);
      return {
        name: p.name,
        title: p.title,
        description: p.description,
        transport: "stdio",
        running,
        tools: (p.toolNames || []).map((t) => ({ name: t })),
        health,
        type: "local",
      };
    });

    const remotePlugins = DEFAULT_PLUGINS.map((p) => {
      const health = getRecentHealth(p.name);
      return {
        name: p.name,
        title: p.title,
        description: p.description,
        transport: p.transport || "http",
        oauth: !!p.oauth,
        url: p.url,
        tools: (p.toolNames || []).map((t) => ({ name: t })),
        health,
        type: "remote",
      };
    });

    // Deduplicate: remote plugins that also appear as local (by name) are merged
    const localNames = new Set(localPlugins.map((p) => p.name));
    const uniqueRemote = remotePlugins.filter((p) => !localNames.has(p.name));

    const allPlugins = [...localPlugins, ...uniqueRemote];
    const totalRunning = localPlugins.filter((p) => p.running).length;
    const totalTools = allPlugins.reduce((sum, p) => sum + p.tools.length, 0);

    return NextResponse.json({
      api: { responding: true, state: "responding" },
      bridge: {
        localCount: localPlugins.length,
        remoteCount: uniqueRemote.length,
        runningCount: totalRunning,
        totalTools,
      },
      plugins: allPlugins,
    });
  } catch (error) {
    console.log("[mcp/status] error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
