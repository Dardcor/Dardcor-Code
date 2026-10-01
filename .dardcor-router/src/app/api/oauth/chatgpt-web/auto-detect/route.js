import { NextResponse } from "next/server";
import { createProviderConnection, getProviderConnections } from "@/lib/db";
import fs from "fs";
import path from "path";
import os from "os";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function findLocalSession() {
  const baseDir = path.join(os.homedir(), ".dardcor", "provider", "provider");
  const candidates = [
    path.join(baseDir, "Chatgpt-Web", "Chatgpt-Web.json"),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!Array.isArray(data) || data.length === 0) continue;
      for (const item of data) {
        const token = item.accessToken || item.token;
        if (!token || typeof token !== "string" || token.length < 200) continue;

        const parts = token.split(".");
        if (parts.length !== 3) continue;

        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const missingPadding = (4 - (base64.length % 4)) % 4;
        const payload = JSON.parse(
          Buffer.from(base64 + "=".repeat(missingPadding), "base64").toString("utf8")
        );

        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) continue; // expired

        const auth = payload["https://api.openai.com/auth"] || {};
        const profile = payload["https://api.openai.com/profile"] || {};
        const email =
          item.email ||
          profile.email ||
          payload.email ||
          auth.chatgpt_user_id ||
          "Unknown Account";
        const accountId =
          auth.chatgpt_account_id ||
          item.providerSpecificData?.chatgptAccountId ||
          null;
        const planType =
          auth.chatgpt_plan_type ||
          item.providerSpecificData?.chatgptPlanType ||
          "free";

        return {
          found: true,
          email,
          accountId,
          planType,
          accessToken: token,
          sourceFile: path.basename(path.dirname(filePath)),
          exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        };
      }
    } catch {
      // ignore parse error and try next
    }
  }

  return { found: false };
}

/**
 * GET /api/oauth/chatgpt-web/auto-detect
 * Scans local system for existing valid ChatGPT sessions.
 */
export async function GET() {
  const result = findLocalSession();
  if (!result.found) {
    return NextResponse.json({ found: false }, { headers: CORS_HEADERS });
  }

  return NextResponse.json(
    {
      found: true,
      email: result.email,
      accountId: result.accountId,
      planType: result.planType,
      source: result.sourceFile,
      exp: result.exp,
    },
    { headers: CORS_HEADERS }
  );
}

/**
 * POST /api/oauth/chatgpt-web/auto-detect
 * Automatically imports and activates the detected local ChatGPT session.
 */
export async function POST() {
  const result = findLocalSession();
  if (!result.found || !result.accessToken) {
    return NextResponse.json(
      { error: "No active ChatGPT session detected on local system." },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  try {
    const planLabel = result.planType
      ? result.planType.charAt(0).toUpperCase() + result.planType.slice(1)
      : "Free";

    const connectionName = `${result.email} (ChatGPT Web - Auto-Detected)`;

    // Write directly to Chatgpt-Web.json or create connection
    const cgwDir = path.join(os.homedir(), ".dardcor", "provider", "provider", "Chatgpt-Web");
    const cgwPath = path.join(cgwDir, "Chatgpt-Web.json");
    if (!fs.existsSync(cgwDir)) fs.mkdirSync(cgwDir, { recursive: true });

    const cgwConn = {
      id: "09920927-9e4d-429d-94a9-f39244ca39d3",
      provider: "chatgpt-web",
      authType: "access_token",
      accessToken: result.accessToken,
      name: connectionName,
      email: result.email,
      priority: 1,
      isActive: true,
      testStatus: "active",
      providerSpecificData: {
        chatgptAccountId: result.accountId || "3423da0d-6904-4e8c-a112-efb9bf0c7f4f",
        chatgptPlanType: result.planType || "free",
        authMethod: "access_token",
        source: "chatgpt.com (auto-detect)",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(cgwPath, JSON.stringify([cgwConn], null, 2), "utf8");

    return NextResponse.json(
      {
        success: true,
        connection: {
          id: cgwConn.id,
          name: cgwConn.name,
          email: cgwConn.email,
          plan: result.planType,
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
