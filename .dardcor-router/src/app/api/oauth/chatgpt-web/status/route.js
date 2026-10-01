import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db";
import fs from "fs";
import path from "path";
import os from "os";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * GET /api/oauth/chatgpt-web/status
 * Returns current status of ChatGPT Web connections.
 * Used by the modal to poll while listening for background imports (e.g. from bookmarklet or external tab).
 */
export async function GET() {
  try {
    const connections = await getProviderConnections({ provider: "chatgpt-web" });
    const active = connections.filter((c) => c.isActive && c.testStatus !== "unavailable");

    return NextResponse.json(
      {
        total: connections.length,
        activeCount: active.length,
        latestConnection: connections[0]
          ? {
              id: connections[0].id,
              name: connections[0].name,
              email: connections[0].email,
              testStatus: connections[0].testStatus,
              updatedAt: connections[0].updatedAt,
            }
          : null,
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
