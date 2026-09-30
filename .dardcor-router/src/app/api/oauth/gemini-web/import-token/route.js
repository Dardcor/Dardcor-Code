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

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function parseInputPayload(raw) {
  let cookies = "";
  let snlm0e = "";
  let email = null;
  let name = null;

  if (typeof raw === "object" && raw !== null) {
    cookies = raw.cookies || raw.cookie || raw.token || raw.accessToken || raw.sessionJson || "";
    snlm0e = raw.snlm0e || raw.at || "";
    email = raw.email || null;
    name = raw.name || null;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        cookies = parsed.cookies || parsed.cookie || parsed.token || parsed.accessToken || "";
        snlm0e = parsed.snlm0e || parsed.at || "";
        email = parsed.email || null;
        name = parsed.name || null;
      } catch {
        cookies = trimmed;
      }
    } else {
      cookies = trimmed;
    }
  }

  // Parse cURL command format
  if (cookies.includes("curl ") || cookies.includes("-H ")) {
    const cookieHeaderMatch =
      cookies.match(/-H\s+['"][Cc]ookie:\s*([^'"]+)['"]/i) ||
      cookies.match(/--header\s+['"][Cc]ookie:\s*([^'"]+)['"]/i);
    if (cookieHeaderMatch) {
      cookies = cookieHeaderMatch[1].trim();
    }
    const atMatch = cookies.match(/[?&]at=([^&'"]+)/) || cookies.match(/['"]at['"]\s*:\s*['"]([^'"]+)['"]/);
    if (atMatch && !snlm0e) {
      snlm0e = atMatch[1];
    }
  }

  // Parse raw HTTP headers format
  if (cookies.includes("Cookie:") || cookies.includes("cookie:")) {
    const lineMatch = cookies.match(/^[Cc]ookie:\s*(.+)$/m);
    if (lineMatch) {
      cookies = lineMatch[1].trim();
    }
  }

  // Format bare token as __Secure-1PSID if no key prefix
  if (cookies && !cookies.includes("=")) {
    cookies = `__Secure-1PSID=${cookies}`;
  }

  return { cookies, snlm0e, email, name };
}

async function verifyAndExtractGeminiSession(cookies) {
  try {
    const res = await fetch("https://gemini.google.com/app", {
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: cookies,
      },
      redirect: "manual",
    });

    const status = res.status;
    const location = res.headers.get("location") || "";
    if (status === 302 || status === 301 || location.includes("accounts.google.com")) {
      return {
        isValid: false,
        error: "Session redirected to Google login. Cookies may be invalid or missing __Secure-1PSIDTS.",
      };
    }

    const html = await res.text();
    const isLoginPage =
      html.includes("ServiceLogin") ||
      html.includes("identifierId") ||
      (html.includes("Sign in") && !html.includes("WIZ_global_data"));

    if (isLoginPage) {
      return {
        isValid: false,
        error: "Google Gemini rejected the session. Ensure __Secure-1PSIDTS is included alongside __Secure-1PSID.",
      };
    }

    const snMatch = html.match(/"SNlM0e":"([^"]+)"/) || html.match(/\["SNlM0e",\[\],\[\],"([^"]+)"\]/);
    const snlm0e = snMatch ? snMatch[1] : null;

    const emailMatch =
      html.match(/"userEmail":"([^"]+)"/) ||
      html.match(/["']([a-zA-Z0-9._%+-]+@(?:gmail\.com|google\.com|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))["']/);
    const detectedEmail = emailMatch ? emailMatch[1] : null;

    return {
      isValid: true,
      snlm0e,
      detectedEmail,
      hasPsid: cookies.includes("__Secure-1PSID="),
      hasPsidts: cookies.includes("__Secure-1PSIDTS="),
    };
  } catch (err) {
    return {
      isValid: true,
      snlm0e: null,
      detectedEmail: null,
      warning: err.message,
    };
  }
}

export async function POST(request) {
  try {
    const rawBody = await request.json().catch(() => ({}));
    const parsed = parseInputPayload(rawBody);

    if (!parsed.cookies) {
      return NextResponse.json(
        { error: "Gemini cookies or session token is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const verification = await verifyAndExtractGeminiSession(parsed.cookies);

    const snlm0e = parsed.snlm0e || verification.snlm0e || null;
    const finalEmail = parsed.email || verification.detectedEmail || null;
    const finalName =
      parsed.name ||
      (finalEmail ? `${finalEmail} (Gemini Web)` : `Gemini Web Session`);

    const providerSpecificData = {
      authMethod: "cookie",
      source: "gemini.google.com",
      snlm0e,
      cookies: parsed.cookies,
      hasPsid: parsed.cookies.includes("__Secure-1PSID="),
      hasPsidts: parsed.cookies.includes("__Secure-1PSIDTS="),
      verifiedAt: new Date().toISOString(),
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
        c.accessToken === parsed.cookies
    );

    const priority = existingIdx !== -1 ? existing[existingIdx].priority : existing.length + 1;

    let savedConn;
    try {
      savedConn = await createProviderConnection({
        provider: "gemini-web",
        authType: "cookie",
        accessToken: parsed.cookies,
        name: finalName,
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
      accessToken: parsed.cookies,
      name: finalName,
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
          hasSnlm0e: Boolean(snlm0e),
        },
        warning: verification.isValid ? undefined : verification.error,
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
