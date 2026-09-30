import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";
import fs from "fs";
import path from "path";
import os from "os";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * POST /api/oauth/chatgpt-web/import-token
 * Import a ChatGPT Web access token or session JSON from https://chatgpt.com/api/auth/session
 * Supports CORS so bookmarklets, user-scripts, or external tabs on chatgpt.com can POST directly.
 *
 * Body: { accessToken?: string, sessionJson?: string, token?: string, name?: string }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    let rawInput = (body.accessToken || body.token || body.sessionJson || "").trim();

    if (!rawInput) {
      return NextResponse.json(
        { error: "Access token or session JSON is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    let token = rawInput;
    let extractedEmail = null;
    let extractedAccountId = null;
    let extractedPlanType = null;

    // Check if input is a JSON string from https://chatgpt.com/api/auth/session
    if (rawInput.startsWith("{") && rawInput.endsWith("}")) {
      try {
        const parsed = JSON.parse(rawInput);
        if (parsed.accessToken) {
          token = parsed.accessToken;
        }
        if (parsed.user?.email) {
          extractedEmail = parsed.user.email;
        }
        if (parsed.account?.id) {
          extractedAccountId = parsed.account.id;
        }
        if (parsed.account?.planType) {
          extractedPlanType = parsed.account.planType;
        }
      } catch {
        // Not valid JSON, treat as raw token
      }
    }

    // Check if input is a cookie string
    if (token.includes("__Secure-next-auth.session-token=")) {
      const match = token.match(/__Secure-next-auth\.session-token=([^;]+)/);
      if (match && match[1]) {
        token = match[1].trim();
      }
    }

    // Extract account info from the JWT (email, workspace/account, plan)
    let email = extractedEmail;
    let providerSpecificData = {
      authMethod: "access_token",
      source: "chatgpt.com",
    };

    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const missingPadding = (4 - (base64.length % 4)) % 4;
        const padded = base64 + "=".repeat(missingPadding);
        const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));

        const auth = payload["https://api.openai.com/auth"] || {};
        const profile = payload["https://api.openai.com/profile"] || {};
        email = email || profile.email || payload.email || payload.preferred_username || null;

        if (auth.chatgpt_account_id) {
          providerSpecificData.chatgptAccountId = auth.chatgpt_account_id;
        }
        if (auth.chatgpt_plan_type) {
          providerSpecificData.chatgptPlanType = auth.chatgpt_plan_type;
        }
        if (payload.exp) {
          providerSpecificData.jwtExp = payload.exp;
        }
      }
    } catch {
      // Allow raw token
    }

    if (!email) {
      const info = extractCodexAccountInfo(token);
      if (info.email) email = info.email;
      if (info.chatgptAccountId) providerSpecificData.chatgptAccountId = info.chatgptAccountId;
      if (info.chatgptPlanType) providerSpecificData.chatgptPlanType = info.chatgptPlanType;
    }

    if (extractedAccountId && !providerSpecificData.chatgptAccountId) {
      providerSpecificData.chatgptAccountId = extractedAccountId;
    }
    if (extractedPlanType && !providerSpecificData.chatgptPlanType) {
      providerSpecificData.chatgptPlanType = extractedPlanType;
    }

    const planLabel = providerSpecificData.chatgptPlanType
      ? providerSpecificData.chatgptPlanType.charAt(0).toUpperCase() + providerSpecificData.chatgptPlanType.slice(1)
      : "Free";

    const connectionName = body.name || (email ? `${email} (${planLabel})` : "ChatGPT Web Session");

    const connection = await createProviderConnection({
      provider: "chatgpt-web",
      authType: "access_token",
      accessToken: token,
      name: connectionName,
      email: email,
      providerSpecificData,
      testStatus: "active",
    });

    // Also synchronize directly to disk in case memory store needs it immediately
    try {
      const cgwDir = path.join(os.homedir(), ".dardcor", "provider", "provider", "Chatgpt-Web");
      let existingList = [];
      if (fs.existsSync(cgwPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(cgwPath, "utf8"));
          if (Array.isArray(raw)) existingList = raw;
        } catch {
          existingList = [];
        }
      }

      const existingIndex = existingList.findIndex(
        (c) => (email && c.email === email) || c.id === connection.id
      );

      const cgwConn = {
        id: connection.id || (existingIndex >= 0 ? existingList[existingIndex].id : "09920927-9e4d-429d-94a9-f39244ca39d3"),
        provider: "chatgpt-web",
        authType: "access_token",
        accessToken: token,
        name: connectionName,
        email: email,
        priority: 1,
        isActive: true,
        testStatus: "active",
        providerSpecificData,
        createdAt: existingIndex >= 0 ? existingList[existingIndex].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        existingList[existingIndex] = cgwConn;
      } else {
        existingList.push(cgwConn);
      }

      fs.writeFileSync(cgwPath, JSON.stringify(existingList, null, 2), "utf8");
    } catch (diskErr) {
      console.warn("[chatgpt-web/import-token] Disk sync warning:", diskErr.message);
    }

    return NextResponse.json(
      {
        success: true,
        connection: {
          id: connection.id,
          provider: connection.provider,
          email: connection.email,
          name: connection.name,
          workspace: providerSpecificData.chatgptAccountId || null,
          plan: providerSpecificData.chatgptPlanType || null,
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("ChatGPT Web access token import error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
