import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";

const RESET_HINT = "Forgot password? Use MiawRouter CLI: Settings > Clear Dashboard Password, then set a new one from the local machine.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const MIN_SETUP_PASSWORD_LENGTH = 8;

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const { password, isSetup } = await request.json();
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    const storedHash = settings.password;

    if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
      return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
    }

    // Auth state machine:
    // 1. stored hash  -> bcrypt compare (normal credential; failures hit the limiter)
    // 2. no hash -> bootstrap is local-only: explicit INITIAL_PASSWORD exact match
    //    (first success persists the hash) or isSetup:true with password >= 8 chars;
    //    remote attempts are rejected without consuming limiter state
    let isValid = false;
    let persistFirstPassword = false;

    if (storedHash) {
      isValid = typeof password === "string" && (await bcrypt.compare(password, storedHash));
    } else if (isLocalRequest(request)) {
      if (process.env.INITIAL_PASSWORD) {
        isValid = password === process.env.INITIAL_PASSWORD;
        persistFirstPassword = isValid;
      } else if (isSetup === true) {
        persistFirstPassword = typeof password === "string" && password.length >= MIN_SETUP_PASSWORD_LENGTH;
        isValid = persistFirstPassword;
        if (!isValid) {
          return NextResponse.json(
            { error: `Password setup requires a new password of at least ${MIN_SETUP_PASSWORD_LENGTH} characters.` },
            { status: 400, headers: NO_STORE_HEADERS }
          );
        }
      } else {
        return NextResponse.json(
          { error: `No dashboard password is set. Provide isSetup:true with a password of at least ${MIN_SETUP_PASSWORD_LENGTH} characters.` },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Dashboard password setup is only allowed from localhost." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    if (isValid) {
      // First session from env/setup: bcrypt-persist before issuing any cookie.
      if (persistFirstPassword) {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        await updateSettings({ password: hash });
      }
      recordSuccess(ip);
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);
      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
