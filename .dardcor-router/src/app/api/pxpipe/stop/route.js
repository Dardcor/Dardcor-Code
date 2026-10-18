import { NextResponse } from "next/server";
import { unloadPxpipe } from "@/lib/pxpipe/loader.js";
import { getPxpipeStatus } from "@/lib/pxpipe/service.js";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const wasLoaded = unloadPxpipe();
    return NextResponse.json({ stopped: wasLoaded, ...getPxpipeStatus() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
