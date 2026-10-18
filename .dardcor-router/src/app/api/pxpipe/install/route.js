import { NextResponse } from "next/server";
import { installPxpipe } from "@/lib/pxpipe/install.js";
import { unloadPxpipe } from "@/lib/pxpipe/loader.js";
import { runHealthCheck } from "@/lib/pxpipe/service.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const info = await installPxpipe();
    unloadPxpipe();
    const health = await runHealthCheck();
    return NextResponse.json({ ...info, health });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
