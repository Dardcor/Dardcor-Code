import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

export async function POST(request) {
  try {
    const { apiKey, uid, baseUrl, mimoPassToken, mimoUserId, mimoCUserId } = await request.json();

    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 },
      );
    }

    const key = apiKey.trim();
    if (!key.startsWith("sk-")) {
      return NextResponse.json(
        { error: "Invalid key format — expected sk- prefix" },
        { status: 400 },
      );
    }

    const effectiveBaseUrl = (baseUrl || "https://api.xiaomimimo.com/v1").replace(/\/+$/, "");

    let validated = false;
    let modelCount = 0;
    try {
      const resp = await fetch(`${effectiveBaseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          "X-Mimo-Source": "mimocode-cli",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        modelCount = Array.isArray(data?.data) ? data.data.length : 0;
        validated = true;
      }
    } catch {
    }

    if (!validated) {
      console.log("[xiaomi-mimo] key validation failed, storing as untested");
    }

    const { getProviderConnections, updateProviderConnection } = await import("@/models");
    const existing = (await getProviderConnections()).find(
      (c) => c.provider === "xiaomi-mimo" && (
        (uid && c.email === `${uid}@xiaomi`) ||
        c.accessToken === key
      ),
    );
    if (existing) {
      const updated = await updateProviderConnection(existing.id, {
        accessToken: key,
        providerSpecificData: {
          ...existing.providerSpecificData,
          uid: uid || existing.providerSpecificData?.uid || null,
          baseUrl: effectiveBaseUrl,
          mimoPassToken: mimoPassToken || existing.providerSpecificData?.mimoPassToken || null,
          mimoUserId: mimoUserId || existing.providerSpecificData?.mimoUserId || null,
          mimoCUserId: mimoCUserId || existing.providerSpecificData?.mimoCUserId || null,
          modelCount,
        },
        testStatus: validated ? "active" : existing.testStatus,
      });
      return NextResponse.json({
        success: true,
        validated,
        modelCount,
        updated: true,
        connection: {
          id: existing.id,
          provider: existing.provider,
          email: existing.email,
          displayName: existing.displayName,
        },
      });
    }

    const connection = await createProviderConnection({
      provider: "xiaomi-mimo",
      authType: "api_key",
      accessToken: key,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      email: uid ? `${uid}@xiaomi` : null,
      displayName: uid ? `Xiaomi ${uid}` : "Xiaomi MiMo",
      providerSpecificData: {
        uid: uid || null,
        baseUrl: effectiveBaseUrl,
        authMethod: "api_key",
        provider: "API Key",
        modelCount,
        mimoPassToken: mimoPassToken || null,
        mimoUserId: mimoUserId || null,
        mimoCUserId: mimoCUserId || null,
      },
      testStatus: validated ? "active" : "untested",
    });

    return NextResponse.json({
      success: true,
      validated,
      modelCount,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        displayName: connection.displayName,
      },
    });
  } catch (error) {
    console.log("Xiaomi MiMo API key import error:", error);
    return NextResponse.json(
      { error: "API key import failed" },
      { status: 500 },
    );
  }
}
