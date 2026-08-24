import { NextResponse } from "next/server";
import { getSkill } from "@/lib/skillDiscovery/service";
import { detectCliTargets, DARDCOR CODE_TARGET, getTargetLabel } from "@/lib/skillDiscovery/targets";

export const dynamic = "force-dynamic";

/**
 * GET /api/skill-discovery/[id]
 *
 * Returns { skill, targets } for one skill by slug or fully-qualified id.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const skill = await getSkill(decodeURIComponent(id));
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const targets = [
      { id: DARDCOR CODE_TARGET, label: getTargetLabel(DARDCOR CODE_TARGET), available: true },
      ...detectCliTargets().map((t) => ({ id: t.id, label: t.label, available: t.available })),
    ];
    return NextResponse.json({ skill, targets }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API] skill-discovery detail failed:", error);
    return NextResponse.json({ error: "Failed to load skill" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
