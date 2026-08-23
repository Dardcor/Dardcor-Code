import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

function getCandidatePaths(platform) {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(home, ".config/manicode/credentials.json"),
      join(home, "Library/Application Support/manicode/credentials.json"),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "manicode", "credentials.json"),
      join(localAppData, "manicode", "credentials.json"),
      join(home, ".config", "manicode", "credentials.json"),
    ];
  }

  return [
    join(home, ".config/manicode/credentials.json"),
    join(home, ".manicode/credentials.json"),
  ];
}

export async function GET() {
  const platform = process.platform;
  const candidatePaths = getCandidatePaths(platform);

  for (const path of candidatePaths) {
    try {
      const content = await readFile(path, "utf-8");
      const json = JSON.parse(content);
      const entry = json.default || Object.values(json)[0] || json;
      const authToken = entry.authToken || entry.token || entry.accessToken;

      if (authToken) {
        return NextResponse.json({
          found: true,
          path,
          authToken,
          email: entry.email || null,
          name: entry.name || null,
          id: entry.id || null,
        });
      }
    } catch {
      // File not found or not readable, try next
    }
  }

  return NextResponse.json({
    found: false,
    error: `No Freebuff/manicode credentials.json found in candidate paths (${candidatePaths.join(", ")})`,
  });
}
