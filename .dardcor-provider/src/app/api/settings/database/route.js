import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { hasValidCliToken } from "@/dashboardGuard";

// Legacy x-9r-password still read so an already-saved dashboard export flow keeps working.
const PASSWORD_HEADER = "x-dardcor-password";
const LEGACY_PASSWORD_HEADER = "x-9r-password";

export async function GET(request) {
  try {
    const passwordHeader = request.headers.get(PASSWORD_HEADER) || request.headers.get(LEGACY_PASSWORD_HEADER);
    if (!(await hasValidCliToken(request)) && !(await verifyDashboardPassword(passwordHeader))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const payload = await exportDb();
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    // Header password wins: the migrate CLI sends it out-of-band (x-dardcor-password)
    // so the dashboard password never rides inside the DB payload body. The body
    // `password` field is still accepted for legacy callers (dashboard import).
    // The password value is never logged, echoed, or stored.
    const body = await request.json();
    const { password: bodyPassword, ...payload } = body;
    const headerPassword = request.headers.get(PASSWORD_HEADER) || request.headers.get(LEGACY_PASSWORD_HEADER);
    const password = headerPassword || bodyPassword;
    if (!(await hasValidCliToken(request)) && !(await verifyDashboardPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    await importDb(payload);

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}
