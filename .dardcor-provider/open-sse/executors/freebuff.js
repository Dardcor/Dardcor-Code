import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const MODEL_TO_AGENT = {
  "mimo/mimo-v2.5": "base3-free-mimo",
  "deepseek/deepseek-v4-flash": "base3-free-deepseek-flash",
  "deepseek/deepseek-v4-pro": "base3-free-deepseek",
  "minimax/minimax-m3": "base3-free-minimax-m3",
  "openai/gpt-5.6-luna": "base3-free-luna",
  "gpt-5.6-luna": "base3-free-luna",
  "z-ai/glm-5.2": "base3-free-glm",
  "crof/kimi-k3-eco": "base3-free-kimi-k3-eco",
  "kimi/kimi-k3": "base3-free-kimi-k3-eco",
};

const MIAWCODE_PROMPT = "You are DardcorCode (Dardcor AI), an expert AI coding assistant and intelligent pair programmer built into DardcorCode IDE.";

// Cache session per token to avoid spamming session endpoint
const sessionCache = new Map();

export class FreebuffExecutor extends BaseExecutor {
  constructor() {
    super("freebuff", PROVIDERS["freebuff"] || {
      baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
      headers: {
        "User-Agent": "Freebuff-CLI/0.0.105",
        "HTTP-Referer": "https://freebuff.com",
        "X-Title": "Freebuff Proxy",
      }
    });
  }

  buildUrl() {
    return "https://www.codebuff.com/api/v1/chat/completions";
  }

  buildHeaders(credentials, stream = true) {
    const token = credentials?.accessToken || credentials?.apiKey || "";
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "Freebuff-CLI/0.0.105",
      "HTTP-Referer": "https://freebuff.com",
      "X-Title": "Freebuff Proxy",
      "Authorization": `Bearer ${token}`
    };
    if (stream) {
      headers["Accept"] = "text/event-stream";
    }
    return headers;
  }

  async ensureSession(token, model, proxyOptions, forceRefresh = false) {
    const cached = sessionCache.get(token);
    const now = Date.now();
    if (!forceRefresh && cached && cached.expiresAt > now + 30000) {
      return cached;
    }

    try {
      const res = await proxyAwareFetch("https://www.codebuff.com/api/v1/freebuff/session", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": "Freebuff-CLI/0.0.105",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(model ? { model } : {})
      }, proxyOptions);

      if (res.ok) {
        const data = await res.json();
        const info = {
          instanceId: data.instanceId || data.id,
          accessTier: data.accessTier || "full",
          model: data.model || model,
          expiresAt: data.expiresAt ? new Date(data.expiresAt).getTime() : (now + 3600000),
          rateLimitsByModel: data.rateLimitsByModel || {}
        };
        sessionCache.set(token, info);
        return info;
      }
    } catch (e) {
      console.warn("[Freebuff] ensureSession error:", e.message);
    }
    return cached || { instanceId: "", accessTier: "full", model };
  }

  async startRun(token, agentId, proxyOptions) {
    try {
      const res = await proxyAwareFetch("https://www.codebuff.com/api/v1/agent-runs", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": "Freebuff-CLI/0.0.105",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "START",
          agentId
        })
      }, proxyOptions);
      if (res.ok) {
        const data = await res.json();
        return data.runId || data.id;
      }
    } catch (e) {
      console.warn("[Freebuff] startRun error:", e.message);
    }
    return crypto.randomUUID();
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const token = credentials?.accessToken || credentials?.apiKey || "";
    let cleanModel = (model || body?.model || "").replace(/^freebuff\//, "");

    // 1. Ensure session to know server admission & tier
    const sessionInfo = await this.ensureSession(token, cleanModel, proxyOptions);

    let effectiveModel = cleanModel;
    if (cleanModel === "gpt-5.6-luna") effectiveModel = "openai/gpt-5.6-luna";
    if (cleanModel === "kimi/kimi-k3") effectiveModel = "crof/kimi-k3-eco";

    if (sessionInfo?.accessTier === "limited" && sessionInfo?.model && sessionInfo?.model !== cleanModel) {
      log?.info?.("FREEBUFF", `Limited tier substituted model ${cleanModel} -> ${sessionInfo.model}`);
      effectiveModel = sessionInfo.model;
    }

    // 2. Start agent run matching the effective model
    const agentId = MODEL_TO_AGENT[effectiveModel] || MODEL_TO_AGENT[cleanModel] || "base3-free-mimo";
    const runId = await this.startRun(token, agentId, proxyOptions);

    // Ensure DardcorCode system prompt is present
    const rawMessages = Array.isArray(body?.messages) ? [...body.messages] : [];
    let hasDardcorSystem = false;
    for (const msg of rawMessages) {
      if (msg.role === "system") {
        if (typeof msg.content === "string" && (msg.content.includes("DardcorCode") || msg.content.includes("Dardcor AI"))) {
          hasDardcorSystem = true;
          break;
        }
      }
    }

    const messages = rawMessages.map(m => ({ ...m }));
    if (!hasDardcorSystem) {
      const existingSys = messages.find(m => m.role === "system");
      if (existingSys) {
        existingSys.content = `${MIAWCODE_PROMPT}\n${existingSys.content}`;
      } else {
        messages.unshift({ role: "system", content: MIAWCODE_PROMPT });
      }
    }

    const clientId = crypto.createHash("sha256").update(token).digest("hex").slice(0, 13);
    const transformedBody = {
      ...body,
      model: effectiveModel,
      messages,
      codebuff_metadata: {
        run_id: runId,
        cost_mode: "free",
        client_id: clientId,
        freebuff_instance_id: sessionInfo?.instanceId || ""
      }
    };

    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials, stream);

    let response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal
    }, proxyOptions);

    // If 409 (superseded/mismatch) or 403, recover and retry
    if (response.status === 409 || response.status === 403) {
      let errText = "";
      try {
        errText = await response.clone().text();
      } catch {}

      log?.warn?.("FREEBUFF", `Upstream returned ${response.status}: ${errText.slice(0, 120)}`);

      if (errText.includes("session_superseded") || errText.includes("session_model_mismatch") || (sessionInfo?.model && effectiveModel !== sessionInfo.model)) {
        sessionCache.delete(token);

        const match = errText.match(/reset after (\d+)s/);
        const waitSeconds = match ? parseInt(match[1], 10) : 0;
        if (waitSeconds > 0 && waitSeconds <= 35) {
          log?.info?.("FREEBUFF", `Waiting ${waitSeconds}s for session reset cooldown...`);
          await new Promise(r => setTimeout(r, (waitSeconds + 1) * 1000));
        }

        const freshSession = await this.ensureSession(token, cleanModel, proxyOptions, true);
        const targetModel = (freshSession?.accessTier === "limited" && freshSession?.model) ? freshSession.model : effectiveModel;
        const targetAgent = MODEL_TO_AGENT[targetModel] || MODEL_TO_AGENT[cleanModel] || "base3-free-mimo";
        const freshRunId = await this.startRun(token, targetAgent, proxyOptions);

        transformedBody.model = targetModel;
        transformedBody.codebuff_metadata.run_id = freshRunId;
        transformedBody.codebuff_metadata.freebuff_instance_id = freshSession?.instanceId || "";

        response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal
        }, proxyOptions);
      }
    }

    return { response, url, headers, transformedBody };
  }
}

export default FreebuffExecutor;
