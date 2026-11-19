import { NextResponse } from "next/server";
import { getAllProviderStatuses, setProviderStatus } from "@/models";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const statuses = await getAllProviderStatuses();
    return NextResponse.json({ success: true, statuses });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to get provider statuses" },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const providerId = body.providerId || body.provider;
    if (!providerId || typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Invalid payload. 'providerId' (string) and 'enabled' (boolean) are required." },
        { status: 400 }
      );
    }
    const result = await setProviderStatus(providerId, body.enabled);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to update provider status" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  return PUT(request);
}
