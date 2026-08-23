import { NextResponse } from "next/server";
import { getConsoleLogs } from "@/lib/consoleLogBuffer";
import { EVENT_NAMES, EVENT_TYPES, subscribe } from "@/lib/eventBus";

export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 25000;

// Unified SSE stream. Protected from the outside by dashboardGuard's
// deny-by-default `/api/*` rule. `?type=stats` streams usage notifications,
// `?type=console` streams console log lines/clear, `?type=cache` streams
// prompt-cache orchestration events, `?type=saver` streams token-saver
// telemetry; anything else → 400.
export async function GET(request) {
  const type = request.nextUrl.searchParams.get("type");
  if (type !== EVENT_TYPES.STATS && type !== EVENT_TYPES.CONSOLE && type !== EVENT_TYPES.CACHE && type !== EVENT_TYPES.SAVER) {
    return NextResponse.json({ error: `Unsupported event type: ${type || "(none)"}` }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const state = { closed: false, unsubs: null, keepalive: null };

  // Idempotent: safe to call from request.signal abort, cancel(), or enqueue failure.
  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.unsubs) state.unsubs();
    if (state.keepalive) clearInterval(state.keepalive);
  };

  // request.signal fires reliably on client disconnect; ReadableStream.cancel()
  // is not always invoked in Next.js, so this prevents listener accumulation.
  request.signal?.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Initial state snapshot so clients can render without a separate fetch.
      if (type === EVENT_TYPES.STATS) {
        try {
          const { getActiveRequests } = await import("@/lib/usageDb");
          send({ type: "init", data: await getActiveRequests() });
        } catch { /* initial state is best-effort */ }
      } else if (type === EVENT_TYPES.CONSOLE) {
        send({ type: "init", logs: getConsoleLogs() });
      } else if (type === EVENT_TYPES.CACHE || type === EVENT_TYPES.SAVER) {
        controller.enqueue(encoder.encode(": connected\n\n"));
      }

      // Wire only the requested event type.
      const unsubs = [];
      if (type === EVENT_TYPES.STATS) {
        unsubs.push(subscribe(EVENT_NAMES.STATS_UPDATE, () => send({ type: "stats", subtype: "update" })));
        unsubs.push(subscribe(EVENT_NAMES.STATS_PENDING, () => send({ type: "stats", subtype: "pending" })));
      } else if (type === EVENT_TYPES.CACHE) {
        unsubs.push(subscribe(EVENT_NAMES.CACHE_STATS_UPDATE, () => {
          send({ type: "cache", subtype: "stats:update" });
        }));
        unsubs.push(subscribe(EVENT_NAMES.CACHE_PROBE, (event) => {
          if (event && typeof event === "object") {
            const safeEvent = { ...event };
            delete safeEvent.cacheKey;
            delete safeEvent.key;
            send({ type: "cache", event: safeEvent });
          }
        }));
      } else if (type === EVENT_TYPES.SAVER) {
        unsubs.push(subscribe(EVENT_NAMES.TOKEN_SAVER, (event) => {
          if (event && typeof event === "object") send({ type: "saver", event });
        }));
      } else {
        unsubs.push(subscribe(EVENT_NAMES.CONSOLE_LINES, (lines) => {
          if (Array.isArray(lines) && lines.length) send({ type: "lines", lines });
        }));
        unsubs.push(subscribe(EVENT_NAMES.CONSOLE_CLEAR, () => send({ type: "clear" })));
      }
      state.unsubs = () => { for (const unsub of unsubs) unsub(); };

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, KEEPALIVE_MS);
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
