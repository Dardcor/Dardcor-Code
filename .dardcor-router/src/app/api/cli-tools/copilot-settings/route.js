"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

const getConfigPath = () => {
  const home = os.homedir();
  const platform = os.platform();
  if (platform === "win32") {
    return path.join(process.env.APPDATA || home, "Code", "User", "chatLanguageModels.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", "chatLanguageModels.json");
  }
  return path.join(home, ".config", "Code", "User", "chatLanguageModels.json");
};

const readConfig = async () => {
  try {
    const content = await fs.readFile(getConfigPath(), "utf-8");
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch {
    return null;
  }
};

const hasDardcorConfig = (config) => {
  if (!Array.isArray(config)) return false;
  return config.some((entry) => entry.name === "Dardcor Code");
};

const getDardcorEntry = (config) => {
  if (!Array.isArray(config)) return null;
  return config.find((entry) => entry.name === "Dardcor Code") || null;
};

export async function GET() {
  try {
    const config = await readConfig();
    const entry = getDardcorEntry(config);

    return NextResponse.json({
      installed: true,
      config,
      hasDardcorCode: hasDardcorConfig(config),
      configPath: getConfigPath(),
      currentModel: entry?.models?.[0]?.id || null,
      currentUrl: entry?.models?.[0]?.url || null,
    });
  } catch (error) {
    console.error("Error checking copilot settings:", error);
    return NextResponse.json({ error: "Failed to check copilot settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, models } = await request.json();

    if (!baseUrl || !models?.length) {
      return NextResponse.json({ error: "baseUrl and models are required" }, { status: 400 });
    }

    const configPath = getConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    let config = [];
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(existing);
      config = Array.isArray(parsed) ? parsed : [];
    } catch {}

    const endpointUrl = `${baseUrl}/chat/completions#models.ai.azure.com`;
    const keyToUse = apiKey || "sk_dardcor";

    const newEntry = {
      name: "Dardcor Code",
      vendor: "azure",
      apiKey: keyToUse,
      models: models.map((id) => ({
        id,
        name: id,
        url: endpointUrl,
        toolCalling: true,
        vision: false,
        maxInputTokens: 128000,
        maxOutputTokens: 16000,
      })),
    };

    const idx = config.findIndex((e) => e.name === "Dardcor Code");
    if (idx >= 0) {
      config[idx] = newEntry;
    } else {
      config.push(newEntry);
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "Copilot settings applied! Reload VS Code to take effect.",
      configPath,
    });
  } catch (error) {
    console.error("Error updating copilot settings:", error);
    return NextResponse.json({ error: "Failed to update copilot settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getConfigPath();

    let config = [];
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(existing);
      config = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }

    config = config.filter((e) => e.name !== "Dardcor Code");
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "Dardcor Code removed from Copilot config",
    });
  } catch (error) {
    console.error("Error resetting copilot settings:", error);
    return NextResponse.json({ error: "Failed to reset copilot settings" }, { status: 500 });
  }
}
