import { NextResponse } from "next/server";
import { killAppProcesses } from "@/lib/appUpdater";

export async function POST() {
  try {
    await killAppProcesses();
  } catch { }

  const response = NextResponse.json({ success: true, message: "Shutting down for manual update..." });

  setTimeout(() => process.exit(0), 500);

  return response;
}
