import { NextResponse } from "next/server";
import { deleteMemory, getMemory, updateMemory } from "@/lib/db/repos/memoryRepo.js";
import { contentFrom, errorResponse, metadataFrom, scopeFrom } from "../_validation.js";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const scope = scopeFrom(Object.fromEntries(new URL(request.url).searchParams));
    const memory = await getMemory(id, scope);
    return memory ? NextResponse.json({ memory }) : NextResponse.json({ error: "Memory not found" }, { status: 404 });
  } catch (error) { return errorResponse(error, "Failed to get memory"); }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const scope = scopeFrom(body);
    const changes = {};
    if (body.content !== undefined) changes.content = contentFrom(body.content);
    if (body.metadata !== undefined) changes.metadata = metadataFrom(body.metadata);
    if (!Object.keys(changes).length) return NextResponse.json({ error: "content or metadata is required" }, { status: 400 });
    const memory = await updateMemory(id, scope, changes);
    return memory ? NextResponse.json({ memory }) : NextResponse.json({ error: "Memory not found" }, { status: 404 });
  } catch (error) { return errorResponse(error, "Failed to update memory"); }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const scope = scopeFrom(Object.fromEntries(new URL(request.url).searchParams));
    return await deleteMemory(id, scope)
      ? NextResponse.json({ deleted: true })
      : NextResponse.json({ error: "Memory not found" }, { status: 404 });
  } catch (error) { return errorResponse(error, "Failed to delete memory"); }
}
