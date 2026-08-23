import { NextResponse } from "next/server";
import { reindexMemories } from "@/lib/db/repos/memoryRepo.js";
import { errorResponse } from "../_validation.js";

export async function POST() {
  try { return NextResponse.json(await reindexMemories()); }
  catch (error) { return errorResponse(error, "Failed to reindex memories"); }
}
