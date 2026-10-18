import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { getInstallInfo, installPxpipe } from "@/lib/pxpipe/install.js";
import { loadPxpipe } from "@/lib/pxpipe/loader.js";
import { getPxpipeStatus } from "@/lib/pxpipe/service.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    if (!getInstallInfo().installed) {
      const settings = await getSettings();
      if (!settings.pxpipeAutoInstall) {
        return NextResponse.json({ error: "PXPIPE is not installed", code: "NOT_INSTALLED" }, { status: 409 });
      }
      await installPxpipe();
    }
    await loadPxpipe();
    return NextResponse.json(getPxpipeStatus());
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
