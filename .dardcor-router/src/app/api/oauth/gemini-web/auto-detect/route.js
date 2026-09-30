import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db";
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

function getStoredConnections() {
  const gmwPath = path.join(os.homedir(), ".dardcor", "provider", "provider", "Gemini-Web", "Gemini-Web.json");
  if (!fs.existsSync(gmwPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(gmwPath, "utf8"));
    if (Array.isArray(data)) {
      return data.filter((item) => !String(item.accessToken || "").startsWith("sample_"));
    }
  } catch {}
  return [];
}

export async function GET() {
  try {
    const dbConns = await getProviderConnections({ provider: "gemini-web" }).catch(() => []);
    const fileConns = getStoredConnections();

    const mergedMap = new Map();
    for (const c of [...fileConns, ...dbConns]) {
      if (c && c.id) mergedMap.set(c.id, c);
    }
    const all = Array.from(mergedMap.values());

    const connectedAccounts = all.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      priority: c.priority,
      isActive: c.isActive,
      testStatus: c.testStatus,
      updatedAt: c.updatedAt,
      hasSnlm0e: Boolean(c.providerSpecificData?.snlm0e),
    }));

    return NextResponse.json(
      {
        found: false,
        newAccounts: [],
        connectedAccounts,
        total: connectedAccounts.length,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err.message, found: false, connectedAccounts: [] },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.cookies || body.token) {
      const importUrl = new URL("/api/oauth/gemini-web/import-token", request.url);
      const res = await fetch(importUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status, headers: CORS_HEADERS });
    }

    return NextResponse.json(
      { error: "No payload provided for Gemini Web connection" },
      { status: 400, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}
