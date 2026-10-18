"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getDroidDir = () => path.join(os.homedir(), ".factory");
const getDroidSettingsPath = () => path.join(getDroidDir(), "settings.json");

const checkDroidInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where droid" : "which droid";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getDroidSettingsPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readSettings = async () => {
  try {
    const settingsPath = getDroidSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch (error) {
    return null;
  }
};

const hasDardcorCodeConfig = (settings) => {
  if (!settings || !settings.customModels) return false;
  return settings.customModels.some(m => m.id?.startsWith("custom:DardcorRouter") || m.id?.startsWith("custom:DRouter"));
};

export async function GET() {
  try {
    const isInstalled = await checkDroidInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Factory Droid CLI is not installed",
      });
    }

    const settings = await readSettings();

    return NextResponse.json({
      installed: true,
      settings,
      hasDardcorCode: hasDardcorCodeConfig(settings),
      settingsPath: getDroidSettingsPath(),
    });
  } catch (error) {
    console.log("Error checking droid settings:", error);
    return NextResponse.json({ error: "Failed to check droid settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel } = await request.json();
    
    const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);
    
    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const droidDir = getDroidDir();
    const settingsPath = getDroidSettingsPath();

    await fs.mkdir(droidDir, { recursive: true });

    let settings = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings);
    } catch { }

    if (!settings.customModels) {
      settings.customModels = [];
    }

    settings.customModels = settings.customModels.filter(m => !m.id?.startsWith("custom:DardcorRouter") && !m.id?.startsWith("custom:DRouter"));

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "your_api_key";

    let defaultIndex = 0;
    if (typeof activeModel === "string") {
      if (activeModel === "") {
        defaultIndex = -1;
      } else {
        const idx = modelsArray.indexOf(activeModel);
        defaultIndex = idx >= 0 ? idx : 0;
      }
    }

    for (let i = 0; i < modelsArray.length; i++) {
      const m = modelsArray[i];
      if (!m || typeof m !== "string") continue;
      settings.customModels.push({
        model: m,
        id: `custom:DardcorRouter-${i}`,
        index: i,
        baseUrl: normalizedBaseUrl,
        apiKey: keyToUse,
        displayName: m,
        maxOutputTokens: 131072,
        noImageSupport: false,
        provider: "openai",
      });
    }

    if (defaultIndex >= 0 && settings.customModels[defaultIndex]) {
      const [defaultEntry] = settings.customModels.splice(defaultIndex, 1);
      settings.customModels.unshift({ ...defaultEntry, index: 0 });
      settings.customModels.forEach((m, i) => { m.index = i; });
    }

    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Factory Droid settings applied successfully!",
      settingsPath,
    });
  } catch (error) {
    console.log("Error updating droid settings:", error);
    return NextResponse.json({ error: "Failed to update droid settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const settingsPath = getDroidSettingsPath();

    let settings = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No settings file to reset",
        });
      }
      throw error;
    }

    if (settings.customModels) {
      settings.customModels = settings.customModels.filter(m => !m.id?.startsWith("custom:DardcorRouter") && !m.id?.startsWith("custom:DRouter"));
      
      if (settings.customModels.length === 0) {
        delete settings.customModels;
      }
    }

    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Dardcor Router settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting droid settings:", error);
    return NextResponse.json({ error: "Failed to reset droid settings" }, { status: 500 });
  }
}