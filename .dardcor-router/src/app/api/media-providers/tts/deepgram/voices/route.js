import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";

const langNames = new Intl.DisplayNames(["en"], { type: "language" });

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const langFilter = searchParams.get("lang");

    const connections = await getProviderConnections({ provider: "deepgram", isActive: true });
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) return NextResponse.json({ error: "No Deepgram connection found" }, { status: 400 });

    const res = await fetch("https://api.deepgram.com/v1/models", {
      headers: { "Authorization": `Token ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Deepgram API ${res.status}: ${text || "Failed"}` }, { status: 502 });
    }
    const data = await res.json();
    const ttsModels = data.tts || [];

    const byLang = {};
    for (const m of ttsModels) {
      const langs = Array.isArray(m.languages) && m.languages.length
        ? m.languages
        : [m.canonical_name?.split("-").pop() || "en"];
      for (const code of langs) {
        if (!byLang[code]) {
          byLang[code] = {
            code,
            name: (() => { try { return langNames.of(code); } catch { return code; } })(),
            voices: [],
          };
        }
        const voiceId = m.canonical_name || m.name;
        if (!byLang[code].voices.find((x) => x.id === voiceId)) {
          byLang[code].voices.push({
            id: voiceId,
            name: m.name || voiceId,
            gender: m.metadata?.tags?.find((t) => t === "masculine" || t === "feminine") || "",
            lang: code,
          });
        }
      }
    }

    const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));

    if (langFilter) {
      return NextResponse.json({ voices: byLang[langFilter]?.voices || [] });
    }
    return NextResponse.json({ languages, byLang });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to fetch voices" }, { status: 502 });
  }
}
