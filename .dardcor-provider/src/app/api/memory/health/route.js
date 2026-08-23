import { NextResponse } from "next/server";
import { getMemoryHealth } from "@/lib/db/repos/memoryRepo.js";
import { errorResponse } from "../_validation.js";

export async function GET() {
  try {
    const health = await getMemoryHealth();
    return NextResponse.json(health, { status: health.ok ? 200 : 503 });
  } catch (error) { return errorResponse(error, "Memory FTS5 unavailable"); }
}
