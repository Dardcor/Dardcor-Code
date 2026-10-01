import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import os from "os";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const DEEPSEEK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

async function verifyToken(token) {
  try {
    const res = await fetch("https://chat.deepseek.com/api/v0/users/current", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": DEEPSEEK_UA,
        Origin: "https://chat.deepseek.com",
        Referer: "https://chat.deepseek.com/",
      },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const biz = body.data?.biz_data;
    if (!biz) return null;
    return {
      email: biz.email || biz.id_profile?.email || null,
      name: biz.id_profile?.name || null,
      userId: biz.id || null,
    };
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    let rawInput = (body.userToken || body.accessToken || body.token || body.sessionJson || "").trim();

    if (!rawInput) {
      return NextResponse.json(
        { error: "DeepSeek userToken is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    let token = rawInput;
    let email = body.email || null;
    let name = body.name || null;

    if (rawInput.startsWith("{") && rawInput.endsWith("}")) {
      try {
        const parsed = JSON.parse(rawInput);
        token = parsed.userToken || parsed.token || parsed.value || parsed.accessToken || token;
        email = email || parsed.email || parsed.user?.email || null;
        name = name || parsed.name || null;
      } catch {}
    }

    if (token.startsWith("Bearer ")) {
      token = token.slice(7).trim();
    }

    const verified = await verifyToken(token);
    if (verified) {
      if (!email && verified.email) email = verified.email;
      if (!name && verified.name) name = verified.name;
    }

    const finalEmail = email || "DeepSeek User";
    const connectionName = name || `${finalEmail} (DeepSeek Web)`;

    const providerSpecificData = {
      authMethod: "user_token",
      source: "chat.deepseek.com",
      userId: verified?.userId || null,
    };

    const dswDir = path.join(os.homedir(), ".dardcor", "provider", "provider", "Deepseek-Web");
    const dswPath = path.join(dswDir, "Deepseek-Web.json");
    if (!fs.existsSync(dswDir)) fs.mkdirSync(dswDir, { recursive: true });

    let existing = [];
    if (fs.existsSync(dswPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(dswPath, "utf8"));
        if (Array.isArray(parsed)) existing = parsed;
      } catch {}
    }

    existing = existing.filter((item) => !String(item.accessToken || "").startsWith("sample_"));

    const existingIdx = existing.findIndex(
      (c) => c.accessToken === token || (finalEmail !== "DeepSeek User" && c.email === finalEmail)
    );

    const priority = existingIdx !== -1 ? existing[existingIdx].priority : existing.length + 1;

    let savedConn;
    try {
      savedConn = await createProviderConnection({
        provider: "deepseek-web",
        authType: "access_token",
        accessToken: token,
        name: connectionName,
        email: finalEmail,
        priority,
        isActive: true,
        testStatus: "active",
        providerSpecificData,
      });
    } catch {}

    const connectionId = savedConn?.id || (existingIdx !== -1 ? existing[existingIdx].id : uuidv4());

    const dswConn = {
      id: connectionId,
      provider: "deepseek-web",
      authType: "access_token",
      accessToken: token,
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
      existing[existingIdx] = dswConn;
    } else {
      existing.push(dswConn);
    }

    fs.writeFileSync(dswPath, JSON.stringify(existing, null, 2), "utf8");

    return NextResponse.json(
      {
        success: true,
        connection: {
          id: dswConn.id,
          provider: dswConn.provider,
          email: dswConn.email,
          name: dswConn.name,
          priority: dswConn.priority,
        },
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
