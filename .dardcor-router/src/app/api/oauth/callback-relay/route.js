import { NextResponse } from "next/server";

const callbackStore = new Map();

function cleanupOldCallbacks() {
  const now = Date.now();
  for (const [key, val] of callbackStore.entries()) {
    if (now - val.timestamp > 300000) {
      callbackStore.delete(key);
    }
  }
}

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
    callbackStore.set("__latest__", entry);

    return NextResponse.json({ success: true, stored: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

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
