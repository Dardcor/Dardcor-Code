"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getConfigDir = () => path.join(os.homedir(), ".config", "opencode");
const getConfigPath = () => path.join(getConfigDir(), "opencode.json");

const checkOpenCodeInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where opencode" : "which opencode";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfig = async () => {
  try {
    const content = await fs.readFile(getConfigPath(), "utf-8");
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
};

const hasDardcorCodeConfig = (config) => {
  if (!config?.provider) return false;
  return !!config.provider["dardcor-code"];
};

export async function GET() {
  try {
    const isInstalled = await checkOpenCodeInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "OpenCode CLI is not installed",
      });
    }

    const config = await readConfig();
    const providerConfig = config?.provider?.["dardcor-code"];
    const modelMap = providerConfig?.models || {};

    return NextResponse.json({
      installed: true,
      config,
      hasDardcorCode: hasDardcorCodeConfig(config),
      configPath: getConfigPath(),
        opencode: {
          models: Object.keys(modelMap),
          activeModel: config?.model?.startsWith("dardcor-code/") ? config.model.replace(/^dardcor-code\//, "") : null,
          baseURL: providerConfig?.options?.baseURL || null,
        },
    });
  } catch (error) {
    console.log("Error checking opencode settings:", error);
    return NextResponse.json({ error: "Failed to check opencode settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel, subagentModel } = await request.json();

    const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const configDir = getConfigDir();
    const configPath = getConfigPath();

    await fs.mkdir(configDir, { recursive: true });

    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch { }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_dardcor-code";
    const effectiveSubagentModel = subagentModel || modelsArray[0];

    if (!config.provider) config.provider = {};

    const existingProvider = config.provider["dardcor-code"] || { npm: "@ai-sdk/openai-compatible", options: {}, models: {} };

    existingProvider.options = {
      ...existingProvider.options,
      baseURL: normalizedBaseUrl,
      apiKey: keyToUse,
    };

    existingProvider.models = existingProvider.models || {};

    for (const m of modelsArray) {
      if (!m || typeof m !== "string") continue;
      existingProvider.models[m] = { name: m, modalities: { input: ["text", "image"], output: ["text"] } };
    }

    config.provider["dardcor-code"] = existingProvider;

    if (activeModel === "") {
      config.model = "";
    } else {
      const finalActive = activeModel || modelsArray[0];
      if (finalActive) {
        config.model = `dardcor-code/${finalActive}`;
      }
    }

    if (!config.agent) config.agent = {};
    config.agent.explorer = {
      description: "Fast explorer subagent for codebase exploration",
      mode: "subagent",
      model: `dardcor-code/${effectiveSubagentModel}`,
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "OpenCode settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error applying opencode settings:", error);
    return NextResponse.json({ error: "Failed to apply settings" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { clearActiveModel } = await request.json();
    const configPath = getConfigPath();

    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file found" });
      }
      throw error;
    }

    if (clearActiveModel === true) {
      if (config.model?.startsWith("dardcor-code/")) {
        config.model = "";
      }
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "Settings updated",
    });
  } catch (error) {
    console.log("Error patching opencode settings:", error);
    return NextResponse.json({ error: "Failed to patch settings" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");
    const configPath = getConfigPath();

    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }

    if (modelToRemove && config.provider?.["dardcor-code"]?.models) {
      delete config.provider["dardcor-code"].models[modelToRemove];
      
      if (Object.keys(config.provider["dardcor-code"].models).length === 0) {
        delete config.provider["dardcor-code"];
        if (config.model?.startsWith("dardcor-code/")) delete config.model;
      } else if (config.model === `dardcor-code/${modelToRemove}`) {
        const remainingModels = Object.keys(config.provider["dardcor-code"].models);
        config.model = `dardcor-code/${remainingModels[0]}`;
      }
    } else {
      if (config.provider) delete config.provider["dardcor-code"];
      if (config.model?.startsWith("dardcor-code/")) delete config.model;
    }

    if (config.agent?.explorer?.model?.startsWith("dardcor-code/")) {
      delete config.agent.explorer;
      if (Object.keys(config.agent).length === 0) delete config.agent;
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "Dardcor Router settings removed from OpenCode",
    });
  } catch (error) {
    console.log("Error resetting opencode settings:", error);
    return NextResponse.json({ error: "Failed to reset opencode settings" }, { status: 500 });
  }
}
