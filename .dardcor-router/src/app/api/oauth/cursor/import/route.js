import { NextResponse } from "next/server";
import { CursorService } from "@/lib/oauth/services/cursor";
import { createProviderConnection } from "@/models";

export async function POST(request) {
  try {
    const { accessToken, machineId } = await request.json();

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json(
        { error: "Access token is required" },
        { status: 400 }
      );
    }

    if (!machineId || typeof machineId !== "string") {
      return NextResponse.json(
        { error: "Machine ID is required" },
        { status: 400 }
      );
    }

    const cursorService = new CursorService();

    const tokenData = await cursorService.validateImportToken(
      accessToken.trim(),
      machineId.trim()
    );

    const userInfo = cursorService.extractUserInfo(tokenData.accessToken);

    const connection = await createProviderConnection({
      provider: "cursor",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: null,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: userInfo?.email || null,
      providerSpecificData: {
        machineId: tokenData.machineId,
        authMethod: "imported",
        provider: "Imported",
        userId: userInfo?.userId,
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Cursor import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  const cursorService = new CursorService();
  const instructions = cursorService.getTokenStorageInstructions();

  return NextResponse.json({
    provider: "cursor",
    method: "import_token",
    instructions,
    requiredFields: [
      {
        name: "accessToken",
        label: "Access Token",
        description: "From cursorAuth/accessToken in state.vscdb",
        type: "textarea",
      },
      {
        name: "machineId",
        label: "Machine ID",
        description: "From storage.serviceMachineId in state.vscdb",
        type: "text",
      },
    ],
  });
}
