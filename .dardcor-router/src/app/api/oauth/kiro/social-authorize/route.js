import { NextResponse } from "next/server";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { KiroService } from "@/lib/oauth/services/kiro";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Use 'google' or 'github'" },
        { status: 400 }
      );
    }

    const { codeVerifier, codeChallenge, state } = generatePKCE();

    const kiroService = new KiroService();
    const authUrl = kiroService.buildSocialLoginUrl(
      provider,
      codeChallenge,
      state
    );

    return NextResponse.json({
      authUrl,
      state,
      codeVerifier,
      codeChallenge,
      provider,
    });
  } catch (error) {
    console.log("Kiro social authorize error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
