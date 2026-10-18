import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/localDb";

export async function POST() {
  try {
    await updateSettings({ password: null });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
