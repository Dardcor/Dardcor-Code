import { NextResponse } from "next/server";

// In-memory transient store for OAuth callbacks (keyed by state or code)
const callbackStore = new Map();

// Periodic cleanup of stale callbacks older than 5 minutes
function cleanupOldCallbacks() {
  const now = Date.now();
  for (const [key, val] of callbackStore.entries()) {
    if (now - val.timestamp > 300000) {
      callbackStore.delete(key);
    }
  }
}

// POST /api/oauth/callback-relay - Callback page posts its received code/state here
export async function POST(request) {
  try {
    const data = await request.json();
    const { state, code, token, error, errorDescription, fullUrl } = data || {};

    cleanupOldCallbacks();

    const entry = {
      code,
      token,
      state,
      error,
      errorDescription,
      fullUrl,
      timestamp: Date.now(),
    };

    if (state) {
      callbackStore.set(state, entry);
    }
    if (code) {
      callbackStore.set(code, entry);
    }
    // Also store by special latest key for fallback
    callbackStore.set("__latest__", entry);

    return NextResponse.json({ success: true, stored: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// GET /api/oauth/callback-relay?state=... - Modal polls this to get callback data
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state");

    cleanupOldCallbacks();

    let data = null;
    if (state && callbackStore.has(state)) {
      data = callbackStore.get(state);
      callbackStore.delete(state);
    } else if (state && callbackStore.has("__latest__")) {
      const latest = callbackStore.get("__latest__");
      if (latest && Date.now() - latest.timestamp < 60000) {
        if (!latest.state || latest.state === state) {
          data = latest;
        }
      }
    }

    if (data) {
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ status: "waiting" });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
