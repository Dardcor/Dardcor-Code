import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createProviderConnection, getProviderConnections, updateProviderConnection } from "@/models";

async function getOfficialAntigravityCredentials() {
  const home = homedir();
  const oauthCredsPath = join(home, ".gemini", "oauth_creds.json");
  const googleAccountsPath = join(home, ".gemini", "google_accounts.json");
  const cliTokenPath = join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token");

  let creds = null;
  let email = null;

  try {
    const credsRaw = await readFile(oauthCredsPath, "utf8");
    creds = JSON.parse(credsRaw);
  } catch {
    try {
      const cliRaw = await readFile(cliTokenPath, "utf8");
      const parsed = JSON.parse(cliRaw);
      if (parsed?.token?.access_token) {
        creds = {
          access_token: parsed.token.access_token,
          refresh_token: parsed.token.refresh_token,
          expiry_date: parsed.token.expiry ? new Date(parsed.token.expiry).getTime() : undefined,
          id_token: parsed.id_token,
        };
      }
    } catch {}
  }

  if (!creds?.access_token) {
    return { found: false };
  }

  try {
    const acctsRaw = await readFile(googleAccountsPath, "utf8");
    const accts = JSON.parse(acctsRaw);
    email = accts.active || null;
  } catch {}

  if (!email && creds.id_token) {
    try {
      const payloadBase64 = creds.id_token.split(".")[1];
      if (payloadBase64) {
        const decoded = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf8"));
        email = decoded.email || null;
      }
    } catch {}
  }

  return {
    found: true,
    creds,
    email: email || "antigravity-user@gmail.com",
    hasRefreshToken: !!creds.refresh_token,
    expiresAt: creds.expiry_date ? new Date(creds.expiry_date).toISOString() : null,
  };
}

export async function GET() {
  try {
    const info = await getOfficialAntigravityCredentials();
    if (!info.found) {
      return NextResponse.json({
        found: false,
        error: "No official Antigravity credentials found (~/.gemini/oauth_creds.json). Run 'agy' in terminal to log in officially.",
      });
    }

    return NextResponse.json({
      found: true,
      email: info.email,
      hasRefreshToken: info.hasRefreshToken,
      expiresAt: info.expiresAt,
    });
  } catch (error) {
    return NextResponse.json({ found: false, error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const info = await getOfficialAntigravityCredentials();
    if (!info.found) {
      return NextResponse.json(
        { error: "No official Antigravity credentials found. Run 'agy' in terminal to log in." },
        { status: 404 }
      );
    }

    const { creds, email } = info;
    const existing = await getProviderConnections("antigravity");
    const match = existing.find(c => c.email === email || c.name === email);

    const expiresAt = creds.expiry_date
      ? new Date(creds.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString();

    const cleanScope = (creds.scope || "")
      .split(" ")
      .filter(s => s && !s.includes("cclog") && !s.includes("experimentsandconfigs"))
      .join(" ") || "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid";

    if (match) {
      const updated = await updateProviderConnection(match.id, {
        accessToken: creds.access_token,
        refreshToken: creds.refresh_token || match.refreshToken,
        expiresAt,
        scope: cleanScope,
        projectId: "default-cli-project",
        testStatus: "available",
        lastError: null,
        errorCode: null,
        lastErrorAt: null,
        backoffLevel: 0,
        isActive: true,
      });
      return NextResponse.json({
        success: true,
        action: "updated",
        connection: updated,
      });
    }

    const created = await createProviderConnection({
      provider: "antigravity",
      authType: "oauth",
      accessToken: creds.access_token,
      refreshToken: creds.refresh_token || null,
      expiresAt,
      scope: cleanScope,
      name: email,
      email,
      projectId: "default-cli-project",
      testStatus: "available",
      priority: 1,
      isActive: true,
    });

    return NextResponse.json({
      success: true,
      action: "created",
      connection: created,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
