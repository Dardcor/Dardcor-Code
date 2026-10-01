import { NextResponse } from "next/server";
import { getProviderStatus, setProviderStatus } from "@/models";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { providerId } = await params;
    const enabled = await getProviderStatus(providerId);
    return NextResponse.json({ success: true, provider: providerId, enabled });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to get provider status" },
      { status: 500 }
    );
  }
}

export async function PUT(request, { params }) {
  try {
    const { providerId } = await params;
    const body = await request.json();
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Field 'enabled' (boolean) is required." },
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

export async function POST(request, context) {
  return PUT(request, context);
}
