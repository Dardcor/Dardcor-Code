import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

export async function POST(request) {
  try {
    const { authToken, email, name, connectionName } = await request.json();

    if (!authToken || typeof authToken !== "string") {
      return NextResponse.json(
        { error: "Auth token is required" },
        { status: 400 }
      );
    }

    const token = authToken.trim();
    const connName = connectionName?.trim() || name?.trim() || email?.trim() || "Freebuff Account";

    const connection = await createProviderConnection({
      provider: "freebuff",
      authType: "oauth",
      name: connName,
      accessToken: token,
      refreshToken: null,
      email: email || null,
      isActive: true,
      expiresAt: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
      providerSpecificData: {
        authMethod: "imported_token",
        importedAt: new Date().toISOString(),
        email: email || null,
        name: name || null,
      },
    });

    return NextResponse.json({
      success: true,
      connection,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to import Freebuff token" },
      { status: 500 }
    );
  }
}
