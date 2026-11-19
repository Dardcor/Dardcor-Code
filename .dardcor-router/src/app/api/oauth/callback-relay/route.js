import { NextResponse } from "next/server";
import { getGenericOAuthSession, getCodexSessionStatus } from "@/lib/oauth/utils/server";
import { exchangeTokens } from "@/lib/oauth/providers";
import { createProviderConnection, setProviderStatus } from "@/models";

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

    if (error) {
      const session = state ? getGenericOAuthSession(state) : null;
      if (session) {
        session.status = "error";
        session.error = errorDescription || error;
      }
      return NextResponse.json({ success: false, error: errorDescription || error });
    }

    // Server-side auto-exchange:
    let session = state ? getGenericOAuthSession(state) : null;
    let providerToUse = session?.provider;
    let redirectUriToUse = session?.redirectUri;
    let codeVerifierToUse = session?.codeVerifier;

    // Smart fallback if session was lost/restarted: detect Google Antigravity from code & iss
    if (!providerToUse && code) {
      const isGoogle = (typeof fullUrl === "string" && fullUrl.includes("accounts.google.com")) ||
                       (typeof code === "string" && code.startsWith("4/0A"));
      if (isGoogle) {
        providerToUse = "antigravity";
        const urlObj = new URL(request.url);
        redirectUriToUse = `${urlObj.origin}/callback`;
      }
    }

    if (!providerToUse && state) {
      const codexSession = getCodexSessionStatus(state);
      if (codexSession) {
        providerToUse = "codex";
        redirectUriToUse = codexSession.redirectUri;
        codeVerifierToUse = codexSession.codeVerifier;
      }
    }

    if (providerToUse && (code || token)) {
      if (session && session.status === "done" && session.connection) {
        return NextResponse.json({
          success: true,
          stored: true,
          exchanged: true,
          connection: session.connection,
        });
      }

      try {
        const tokenData = await exchangeTokens(
          providerToUse,
          token || code,
          redirectUriToUse,
          codeVerifierToUse,
          state,
          session?.meta
        );

        const connection = await createProviderConnection({
          provider: providerToUse,
          authType: "oauth",
          ...tokenData,
          expiresAt: tokenData.expiresIn
            ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
            : null,
          testStatus: "active",
        });

        await setProviderStatus(providerToUse, true).catch(() => {});

        if (session) {
          session.status = "done";
          session.connection = connection;
        }

        return NextResponse.json({
          success: true,
          stored: true,
          exchanged: true,
          connection: {
            id: connection.id,
            provider: connection.provider,
            email: connection.email,
            name: connection.name,
          },
        });
      } catch (err) {
        console.error(`[callback-relay] Exchange error for ${providerToUse}:`, err.message);
        if (session) {
          session.status = "error";
          session.error = err.message;
        }
        return NextResponse.json({ error: err.message, status: "error" }, { status: 400 });
      }
    }

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
