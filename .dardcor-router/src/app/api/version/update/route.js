import { NextResponse } from "next/server";
import { killAppProcesses, spawnUpdaterAndExit } from "@/lib/appUpdater";

export async function POST() {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "Update is only available in production build (dardcor-code CLI)" },
      { status: 403 }
    );
  }

  try {
    await killAppProcesses();
  } catch { }

  spawnUpdaterAndExit();

  return NextResponse.json({ success: true, message: "Updater started. This app will exit shortly." });
}
