import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

export async function POST(request) {
  try {
    const { fingerprintId, fingerprintHash, expiresAt } = await request.json();

    if (!fingerprintId || !fingerprintHash) {
      return NextResponse.json(
        { error: "fingerprintId and fingerprintHash are required" },
        { status: 400 }
      );
    }

    const res = await fetch("https://freebuff.llm.pm/api/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Dardcor Code-Freebuff-Client/1.0",
      },
      body: JSON.stringify({
        fingerprintId,
        fingerprintHash,
        expiresAt,
      }),
    });

    if (!res.ok) {
      throw new Error(`Status check failed (${res.status})`);
    }

    const data = await res.json();

    if (data.pending) {
      return NextResponse.json({ pending: true });
    }

    if (data.user && data.user.authToken) {
      const user = data.user;
      const connName = user.name || user.email || "Freebuff Account";

      const connection = await createProviderConnection({
        provider: "freebuff",
        authType: "oauth",
        name: connName,
        accessToken: user.authToken,
        refreshToken: null,
        email: user.email || null,
        isActive: true,
        expiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
        providerSpecificData: {
          authMethod: "freebuff_oauth",
          id: user.id || null,
          name: user.name || null,
          email: user.email || null,
          fingerprintId: user.fingerprintId || fingerprintId,
          importedAt: new Date().toISOString(),
        },
      });

      return NextResponse.json({
        pending: false,
        success: true,
        user,
        connection,
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to check Freebuff status" },
      { status: 500 }
    );
  }
}
