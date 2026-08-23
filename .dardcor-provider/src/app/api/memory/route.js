import { NextResponse } from "next/server";
import { createMemory, listMemories } from "@/lib/db/repos/memoryRepo.js";
import { contentFrom, errorResponse, integerFrom, metadataFrom, scopeFrom } from "./_validation.js";

export async function GET(request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const scope = scopeFrom(params);
    const limit = integerFrom(params.limit, "limit", 50, 100);
    const offset = integerFrom(params.offset, "offset", 0, 1_000_000);
    return NextResponse.json({ memories: await listMemories({ ...scope, limit, offset }) });
  } catch (error) { return errorResponse(error, "Failed to list memories"); }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const scope = scopeFrom(body);
    const content = contentFrom(body.content);
    const metadata = metadataFrom(body.metadata) ?? {};
    return NextResponse.json({ memory: await createMemory({ ...scope, content, metadata }) }, { status: 201 });
  } catch (error) { return errorResponse(error, "Failed to create memory"); }
}
