import { NextResponse } from "next/server";

export async function POST() {
  try {
    const res = await fetch("https://freebuff.llm.pm/api/code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Dardcor Code-Freebuff-Client/1.0",
      },
    });

    if (!res.ok) {
      throw new Error(`Freebuff session generator responded with status ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json({
      success: true,
      loginUrl: data.loginUrl,
      fingerprintId: data.fingerprintId,
      fingerprintHash: data.fingerprintHash,
      expiresAt: data.expiresAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to create Freebuff session" },
      { status: 500 }
    );
  }
}
