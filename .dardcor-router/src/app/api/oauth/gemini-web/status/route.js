import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db";

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

export async function GET() {
  try {
    const connections = await getProviderConnections({ provider: "gemini-web" });
    const active = connections.filter((c) => c.isActive && c.testStatus !== "unavailable");

    const accounts = connections.map((c) => ({
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
        total: connections.length,
        activeCount: active.length,
        accounts,
        latestConnection: accounts[0] || null,
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
