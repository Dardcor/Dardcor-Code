import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/localDb";

// Clear the stored dashboard password back into setup-required state.
// Local-only (enforced by dashboardGuard).
export async function POST() {
  try {
    const settings = await updateSettings({ password: null });
    const setupRequired = !settings.password && !process.env.INITIAL_PASSWORD;
    return NextResponse.json({ success: true, setupRequired });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
