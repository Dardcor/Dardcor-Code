import { NextResponse } from "next/server";
import { listSkills } from "@/lib/skillDiscovery/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/skill-discovery?query=&source=&installed=
 *
 * Returns { items, counts, sources, targets }. Local catalog is always
 * present; skills.sh is allowlisted and surfaced as unavailable on failure.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") || "";
    const source = searchParams.get("source") || "";
    const installed = searchParams.get("installed");
    const data = await listSkills({ query, source, installed });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API] skill-discovery list failed:", error);
    return NextResponse.json({ error: "Failed to list skills" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
