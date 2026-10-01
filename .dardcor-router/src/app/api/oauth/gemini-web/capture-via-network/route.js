import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import os from "os";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie, X-Forwarded-Cookies",
  "Access-Control-Allow-Credentials": "true",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieHeader = request.headers.get("cookie") || request.headers.get("Cookie") || "";
    const forwardedCookies = request.headers.get("x-forwarded-cookies") || request.headers.get("X-Forwarded-Cookies") || "";
    const snlm0e = body.snlm0e || body.at || "";
    const email = body.email || body.userEmail || null;

    const allCookies = [body.cookies || "", forwardedCookies, cookieHeader].filter(Boolean).join("; ");

    const psidMatch = allCookies.match(/__Secure-1PSID=([^;]+)/);
    const psidtsMatch = allCookies.match(/__Secure-1PSIDTS=([^;]+)/);
    const sapisidMatch = allCookies.match(/SAPISID=([^;]+)/);

    const hasPsid = Boolean(psidMatch);
    const hasPsidts = Boolean(psidtsMatch);

    if (!hasPsid && !sapisidMatch && !snlm0e) {
      return NextResponse.json(
        {
          error: "No Gemini session cookies captured. Please paste cookies or cURL directly.",
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const finalEmail = email || null;
    const connectionName = body.name || (finalEmail ? `${finalEmail} (Gemini Web)` : "Gemini Web Session");

    const providerSpecificData = {
      authMethod: "cookie",
      source: "gemini.google.com (network-capture)",
      snlm0e: snlm0e || null,
      cookies: allCookies,
      capturedAt: new Date().toISOString(),
      hasPsid,
      hasPsidts,
    };

    const gmwDir = path.join(os.homedir(), ".dardcor", "provider", "provider", "Gemini-Web");
    const gmwPath = path.join(gmwDir, "Gemini-Web.json");
    if (!fs.existsSync(gmwDir)) fs.mkdirSync(gmwDir, { recursive: true });

    let existing = [];
    if (fs.existsSync(gmwPath)) {
      try {
        const fileContent = JSON.parse(fs.readFileSync(gmwPath, "utf8"));
        if (Array.isArray(fileContent)) existing = fileContent;
      } catch {}
    }

    existing = existing.filter((item) => !String(item.accessToken || "").startsWith("sample_"));

    const existingIdx = existing.findIndex(
      (c) =>
        (finalEmail && c.email && c.email.toLowerCase() === finalEmail.toLowerCase()) ||
        c.accessToken === allCookies
    );

    const priority = existingIdx !== -1 ? existing[existingIdx].priority : existing.length + 1;

    let savedConn;
    try {
      savedConn = await createProviderConnection({
        provider: "gemini-web",
        authType: "cookie",
        accessToken: allCookies,
        name: connectionName,
        email: finalEmail,
        priority,
        isActive: true,
        testStatus: "active",
        providerSpecificData,
      });
    } catch {}

    const connectionId =
      savedConn?.id || (existingIdx !== -1 ? existing[existingIdx].id : uuidv4());

    const gmwConn = {
      id: connectionId,
      provider: "gemini-web",
      authType: "cookie",
      accessToken: allCookies,
      name: connectionName,
      email: finalEmail,
      priority,
      isActive: true,
      testStatus: "active",
      providerSpecificData,
      createdAt: existingIdx !== -1 ? existing[existingIdx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx !== -1) {
      existing[existingIdx] = gmwConn;
    } else {
      existing.push(gmwConn);
    }

    fs.writeFileSync(gmwPath, JSON.stringify(existing, null, 2), "utf8");

    return NextResponse.json(
      {
        success: true,
        connection: {
          id: gmwConn.id,
          provider: gmwConn.provider,
          email: gmwConn.email,
          name: gmwConn.name,
          priority: gmwConn.priority,
        },
        totalConnections: existing.length,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
