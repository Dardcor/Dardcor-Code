import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import os from "os";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const DEEPSEEK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const tokenCache = new Map();

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function extractTokensFromBuffer(buf) {
  const tokens = [];
  const str = buf.toString("latin1");
  let idx = 0;

  while ((idx = str.indexOf("userToken", idx)) !== -1) {
    const chunk = str.slice(idx, idx + 300);
    const jsonMatch = chunk.match(/"value"\s*:\s*"([A-Za-z0-9+/=_-]{30,120})"/);
    if (jsonMatch) {
      tokens.push(jsonMatch[1]);
    } else {
      const nearMatch = chunk.slice(0, 150).match(/"([A-Za-z0-9+/=_-]{40,120})"/);
      if (nearMatch) {
        tokens.push(nearMatch[1]);
      }
    }
    idx += 9;
  }

  return tokens;
}

function scanLevelDbDir(lsDir, sourceName, candidates) {
  let files = [];
  try {
    files = fs.readdirSync(lsDir).filter((f) => f.endsWith(".ldb") || f.endsWith(".log"));
  } catch {
    return;
  }

  for (const file of files) {
    try {
      const buf = fs.readFileSync(path.join(lsDir, file));
      const tokens = extractTokensFromBuffer(buf);
      for (const token of tokens) {
        candidates.push({
          token,
          source: sourceName,
        });
      }
    } catch {}
  }
}

function scanBrowserProfiles() {
  const browserRoots = [
    { name: "Chrome", dir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data") },
    { name: "Chrome Beta", dir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome Beta", "User Data") },
    { name: "Edge", dir: path.join(os.homedir(), "AppData", "Local", "Microsoft", "Edge", "User Data") },
    { name: "Brave", dir: path.join(os.homedir(), "AppData", "Local", "BraveSoftware", "Brave-Browser", "User Data") },
    { name: "Opera", dir: path.join(os.homedir(), "AppData", "Roaming", "Opera Software", "Opera Stable") },
    { name: "Opera GX", dir: path.join(os.homedir(), "AppData", "Roaming", "Opera Software", "Opera GX Stable") },
    { name: "Vivaldi", dir: path.join(os.homedir(), "AppData", "Local", "Vivaldi", "User Data") },
  ];

  const candidates = [];

  for (const b of browserRoots) {
    if (!fs.existsSync(b.dir)) continue;

    const directLs = path.join(b.dir, "Local Storage", "leveldb");
    if (fs.existsSync(directLs)) {
      scanLevelDbDir(directLs, b.name, candidates);
    }

    let entries = [];
    try {
      entries = fs.readdirSync(b.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const profiles = entries
      .filter((e) => e.isDirectory() && (e.name === "Default" || e.name.startsWith("Profile ")))
      .map((e) => e.name);

    for (const profile of profiles) {
      const lsDir = path.join(b.dir, profile, "Local Storage", "leveldb");
      if (fs.existsSync(lsDir)) {
        scanLevelDbDir(lsDir, `${b.name} (${profile})`, candidates);
      }
    }
  }

  return candidates;
}

function getExistingTokensAndEmails() {
  const existingTokens = new Set();
  const existingEmails = new Set();
  const dswPath = path.join(os.homedir(), ".dardcor", "provider", "provider", "Deepseek-Web", "Deepseek-Web.json");
  if (fs.existsSync(dswPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(dswPath, "utf8"));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.accessToken) existingTokens.add(item.accessToken.trim());
          if (item.email && item.email !== "DeepSeek User") existingEmails.add(item.email.trim().toLowerCase());
        }
      }
    } catch {}
  }
  return { existingTokens, existingEmails };
}

async function verifyDeepSeekToken(token) {
  if (!token) return null;
  const cached = tokenCache.get(token);
  if (cached && Date.now() - cached.timestamp < 300000) {
    return cached.data;
  }

  try {
    const res = await fetch("https://chat.deepseek.com/api/v0/users/current", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": DEEPSEEK_UA,
        Origin: "https://chat.deepseek.com",
        Referer: "https://chat.deepseek.com/",
      },
    });

    if (!res.ok) {
      tokenCache.set(token, { data: null, timestamp: Date.now() });
      return null;
    }
    const body = await res.json();
    const biz = body.data?.biz_data;
    if (!biz) {
      tokenCache.set(token, { data: null, timestamp: Date.now() });
      return null;
    }

    const email = biz.email || biz.id_profile?.email || "DeepSeek User";
    const name = biz.id_profile?.name || email;
    const userId = biz.id || null;
    const avatar = biz.id_profile?.picture || null;

    const result = {
      isValid: true,
      email,
      name,
      userId,
      avatar,
    };
    tokenCache.set(token, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return null;
  }
}

async function getDetectedAccounts() {
  const { existingTokens, existingEmails } = getExistingTokensAndEmails();
  const candidates = scanBrowserProfiles();
  const seenTokens = new Set();
  const newAccounts = [];
  const connectedAccounts = [];

  for (const c of candidates) {
    if (!c.token || seenTokens.has(c.token)) continue;
    seenTokens.add(c.token);

    const isTokenConnected = existingTokens.has(c.token.trim());

    const verification = await verifyDeepSeekToken(c.token);
    if (verification?.isValid) {
      const isEmailConnected =
        verification.email &&
        verification.email !== "DeepSeek User" &&
        existingEmails.has(verification.email.trim().toLowerCase());

      const accData = {
        token: c.token,
        email: verification.email,
        name: verification.name,
        userId: verification.userId,
        avatar: verification.avatar,
        source: c.source,
      };

      if (isTokenConnected || isEmailConnected) {
        connectedAccounts.push({
          ...accData,
          alreadyConnected: true,
        });
      } else {
        newAccounts.push({
          ...accData,
          alreadyConnected: false,
        });
      }
    }
  }

  return {
    newAccounts,
    connectedAccounts,
    allDetected: [...newAccounts, ...connectedAccounts],
  };
}

export async function GET() {
  const { newAccounts, connectedAccounts, allDetected } = await getDetectedAccounts();

  const found = newAccounts.length > 0;
  const primary = newAccounts[0] || connectedAccounts[0] || null;

  return NextResponse.json(
    {
      found,
      hasConnected: connectedAccounts.length > 0,
      accounts: newAccounts,
      newAccounts,
      connectedAccounts,
      allDetected,
      primary,
      token: primary?.token || null,
      email: primary?.email || null,
      name: primary?.name || null,
      source: primary?.source || null,
    },
    { headers: CORS_HEADERS }
  );
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {}

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

  let targetAccounts = [];

  if (body.token) {
    const verification = await verifyDeepSeekToken(body.token);
    const email = body.email || verification?.email || "DeepSeek User";
    const name = body.name || verification?.name || `${email} (DeepSeek Web)`;
    targetAccounts.push({
      token: body.token,
      email,
      name,
      userId: verification?.userId || null,
      source: "Manual / Radar",
    });
  } else {
    const { newAccounts, connectedAccounts } = await getDetectedAccounts();
    targetAccounts = newAccounts.length > 0 ? newAccounts : connectedAccounts;
  }

  if (targetAccounts.length === 0) {
    return NextResponse.json(
      { error: "No active DeepSeek session found in browser or local storage." },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  const updatedConnections = [...existing];

  for (const acc of targetAccounts) {
    const existingIdx = updatedConnections.findIndex(
      (c) => c.accessToken === acc.token || (acc.email && c.email === acc.email)
    );

    let savedConn;
    try {
      savedConn = await createProviderConnection({
        provider: "deepseek-web",
        authType: "access_token",
        accessToken: acc.token,
        name: `${acc.email} (DeepSeek Web)`,
        email: acc.email,
        priority: existingIdx !== -1 ? updatedConnections[existingIdx].priority : updatedConnections.length + 1,
        isActive: true,
        testStatus: "active",
        providerSpecificData: {
          authMethod: "user_token",
          source: acc.source,
          userId: acc.userId,
        },
      });
    } catch {}

    const connData = {
      id: savedConn?.id || (existingIdx !== -1 ? updatedConnections[existingIdx].id : uuidv4()),
      provider: "deepseek-web",
      authType: "access_token",
      accessToken: acc.token,
      name: `${acc.email} (DeepSeek Web)`,
      email: acc.email,
      priority: existingIdx !== -1 ? updatedConnections[existingIdx].priority : updatedConnections.length + 1,
      isActive: true,
      testStatus: "active",
      providerSpecificData: {
        authMethod: "user_token",
        source: acc.source,
        userId: acc.userId,
      },
      createdAt: existingIdx !== -1 ? updatedConnections[existingIdx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx !== -1) {
      updatedConnections[existingIdx] = connData;
    } else {
      updatedConnections.push(connData);
    }
  }

  fs.writeFileSync(dswPath, JSON.stringify(updatedConnections, null, 2), "utf8");

  return NextResponse.json(
    {
      success: true,
      importedCount: targetAccounts.length,
      connections: updatedConnections.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        priority: c.priority,
      })),
    },
    { headers: CORS_HEADERS }
  );
}
