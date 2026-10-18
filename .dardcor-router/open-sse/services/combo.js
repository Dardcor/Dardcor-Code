
import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { extractTextContent } from "../translator/formats/gemini.js";

const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

function flattenToolHistory(messages) {
  return messages
    .filter((msg) => msg)
    .map((msg) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = tool_calls.map((c) => c?.function?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((c) => c.type === "tool_use");
        const hasToolResult = msg.content.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts = [];
          const toolNames = [];
          const toolResults = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}

export function reorderByCapabilities(models, required) {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1) return models;
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  const soft = [...required].filter((c) => !HARD_CAPS.has(c));

  const tierOf = (m) => {
    const slash = typeof m === "string" ? m.indexOf("/") : -1;
    const provider = slash > 0 ? m.slice(0, slash) : "";
    const model = slash > 0 ? m.slice(slash + 1) : m;
    const caps = getCapabilitiesForModel(provider, model);
    if (!hard.every((c) => caps[c] === true)) return 2;
    return soft.every((c) => caps[c] === true) ? 0 : 1;
  };

  return models
    .map((m, i) => ({ m, i, t: tierOf(m) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);
}

const comboRotationState = new Map();

function trailingUserItems(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role)) i--;
  return arr.slice(i + 1);
}

export function detectRequiredCapabilities(body) {
  const required = new Set();
  if (!body || typeof body !== "object") return required;

  const addByMime = (mime) => {
    if (typeof mime !== "string") return;
    if (mime.startsWith("image/")) required.add("vision");
    else if (mime === "application/pdf") required.add("pdf");
    else if (mime.startsWith("audio/")) required.add("audioInput");
    else if (mime.startsWith("video/")) required.add("videoInput");
  };

  const scanBlock = (b) => {
    if (!b || typeof b !== "object") return;
    const t = b.type;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "input_audio" || t === "audio_url" || t === "audio") required.add("audioInput");
    if (t === "input_video" || t === "video_url" || t === "video") required.add("videoInput");
    if (t === "file" || t === "document" || t === "input_file") {
      let fmime = null;
      if (b.input_audio?.format) fmime = `audio/${b.input_audio.format}`;
      else if (b.file?.file_data) fmime = String(b.file.file_data).match(/^data:([^;,]+)/)?.[1];
      else if (b.source?.media_type) fmime = b.source.media_type;
      else if (b.source?.data) fmime = String(b.source.data).match(/^data:([^;,]+)/)?.[1];
      if (fmime) addByMime(fmime);
      else required.add("pdf");
    }
    addByMime(b.inlineData?.mimeType || b.fileData?.mimeType);
  };

  const scanContent = (content) => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b);
  };

  const scanMessage = (m) => {
    if (!m || typeof m !== "object") return;

    if (Array.isArray(m.images) && m.images.length > 0) {
      required.add("vision");
    }

    const attachments = m.experimental_attachments || m.attachments;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (!att) continue;
        const mime = att.contentType || att.mediaType || (typeof att.url === "string" && att.url.match(/^data:([^;,]+)/)?.[1]);
        if (mime) addByMime(mime);
        else if (att.url || att.data) required.add("vision");
      }
    }

    if (m.image_url || m.image) required.add("vision");
    if (m.audio_url || m.audio) required.add("audioInput");

    scanContent(m.content);

    if (typeof m.content === "string") {
      if (m.content.includes("data:image/")) required.add("vision");
      else if (m.content.includes("data:audio/")) required.add("audioInput");
      else if (m.content.includes("data:application/pdf")) required.add("pdf");
    }
  };

  for (const m of trailingUserItems(body.messages)) scanMessage(m);
  for (const it of trailingUserItems(body.input)) scanContent(it.content);
  const contents = body.contents || body.request?.contents;
  for (const c of trailingUserItems(contents)) scanContent(c.parts);


  return required;
}

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

export function getRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const existingState = comboRotationState.get(rotationKey);
  const state = typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

export function resetComboRotation(comboName) {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

export function getComboModelsFromData(modelStr, combosData) {
  if (modelStr.includes("/")) return null;
  
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true }) {
  let rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);

  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }
  
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);
      
      if (result.ok) {
        log.info("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      let errorText = result.statusText || "";
      let retryAfter = null;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch {
      }

      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function extractPanelText(json) {
  if (!json || typeof json !== "object") return "";

  const choice = json.choices?.[0];
  if (choice) {
    const msg = choice.message ?? choice.delta ?? {};
    const t = extractTextContent(msg.content);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  const claudeText = extractTextContent(json.content);
  if (claudeText.trim()) return claudeText;

  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts.map((p) => p?.text || "").join("");
    if (t.trim()) return t;
  }

  if (Array.isArray(json.output)) {
    const t = json.output
      .flatMap((o) => (Array.isArray(o.content) ? o.content.map((c) => c?.text || "") : []))
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

function appendUserTurn(body, text) {
  const next = { ...body };
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

function buildJudgePrompt(answers) {
  const panel = answers
    .map((a, i) => `[Source ${i + 1}]\n${a.text}`)
    .join("\n\n");

  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

const FUSION_DEFAULTS = {
  minPanel: 2,
  stragglerGraceMs: 8000,
  panelHardTimeoutMs: 90000,
};

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(promise)
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); resolve({ __error: e }); });
  });
}

function collectPanel(calls, { minPanel, stragglerGraceMs, panelHardTimeoutMs }) {
  return new Promise((resolve) => {
    const out = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p, i) => {
      Promise.resolve(p)
        .then((v) => { out[i] = v; })
        .catch((e) => { out[i] = { __error: e }; })
        .finally(() => {
          settled++;
          if (out[i] && out[i].ok) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

export async function handleFusionChat({ body, models, handleSingleModel, log, comboName, judgeModel, tuning }) {
  const panel = Array.isArray(models) ? models.filter(Boolean) : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Fusion combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  log.info("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  const { tools, tool_choice, stream_options, ...rest } = body;
  const panelBody = { ...rest, stream: false };

  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input);
  }

  const t0 = Date.now();
  const calls = panel.map((m) => withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs));
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  const answers = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = panel[i];
    if (!res) { log.warn("FUSION", `Panel ${model} dropped (straggler/timeout)`); continue; }
    if (res.__timeout) { log.warn("FUSION", `Panel ${model} timed out`); continue; }
    if (res.__error) { log.warn("FUSION", `Panel ${model} threw`, { error: res.__error?.message || String(res.__error) }); continue; }
    if (!res.ok) { log.warn("FUSION", `Panel ${model} failed`, { status: res.status }); continue; }
    try {
      const json = await res.clone().json();
      const text = extractPanelText(json);
      if (text) {
        answers.push({ model, text });
        log.info("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e) {
      log.warn("FUSION", `Panel ${model} unparseable`, { error: e.message || String(e) });
    }
  }

  if (answers.length === 0) {
    log.warn("FUSION", "All panel models failed");
    return new Response(
      JSON.stringify({ error: { message: "All fusion panel models failed" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (answers.length === 1) {
    log.info("FUSION", `Only ${answers[0].model} succeeded — answering directly (no fusion)`);
    return handleSingleModel(body, answers[0].model);
  }

  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}
