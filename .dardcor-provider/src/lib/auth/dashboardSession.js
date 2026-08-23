import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { getSettings } from "@/lib/localDb";
import { loadOrCreateSecretFile } from "@/shared/utils/secretFile.js";
import { WEAK_JWT_SECRETS } from "@/shared/utils/secretPolicy.js";

const SECRET = new TextEncoder().encode(
  loadOrCreateSecretFile("jwt-secret", "JWT_SECRET", WEAK_JWT_SECRETS),
);

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  const settings = await getSettings();
  const sessionVersion = Number(settings?.sessionVersion) || 0;
  return new SignJWT({ authenticated: true, ...claims, sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const settings = await getSettings();
    const currentVersion = Number(settings?.sessionVersion) || 0;
    const tokenVersion = Number(payload.sessionVersion) || 0;
    return tokenVersion === currentVersion;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const settings = await getSettings();
    const currentVersion = Number(settings?.sessionVersion) || 0;
    const tokenVersion = Number(payload.sessionVersion) || 0;
    if (tokenVersion !== currentVersion) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD;
  if (!initialPassword) return false;
  return password === initialPassword;
}
