import { NextResponse } from "next/server";
import {
  getActiveSessions,
  getActiveSessionCount,
  getAllActiveSessionCountsByKey,
} from "@dardcorCode/open-sse/services/sessionManager.ts";
import { sanitizeErrorMessage } from "@dardcorCode/open-sse/utils/error";

export async function GET() {
  try {
    const sessions = getActiveSessions();
    const count = getActiveSessionCount();
    const byApiKey = getAllActiveSessionCountsByKey();
    return NextResponse.json({ count, sessions, byApiKey });
  } catch (error) {
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}
