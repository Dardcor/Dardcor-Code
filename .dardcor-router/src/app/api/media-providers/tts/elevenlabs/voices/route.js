import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { fetchElevenLabsVoices } from "open-sse/handlers/ttsCore.js";

const langNames = new Intl.DisplayNames(["en"], { type: "language" });

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const langFilter = searchParams.get("lang");

    const connections = await getProviderConnections({ provider: "elevenlabs", isActive: true });
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) {
      return NextResponse.json({ error: "No ElevenLabs connection found" }, { status: 400 });
    }

    const voices = await fetchElevenLabsVoices(apiKey);

    const byLang = {};
    const addToLang = (code, voice) => {
      if (!byLang[code]) {
        byLang[code] = {
          code,
          name: (() => { try { return langNames.of(code); } catch { return code; } })(),
          voices: [],
        };
      }
      if (!byLang[code].voices.find((v) => v.id === voice.voice_id)) {
        byLang[code].voices.push({
          id: voice.voice_id,
          name: voice.name,
          gender: voice.labels?.gender || "",
          lang: code,
          free_users_allowed: voice.category === "premade" || voice.is_owner === true
        });
      }
    };
    for (const v of voices) {
      const primaryLang = v.labels?.language || "en";
      addToLang(primaryLang, v);
      for (const vl of v.verified_languages || []) {
        if (vl.language && vl.language !== primaryLang) {
          addToLang(vl.language, v);
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
