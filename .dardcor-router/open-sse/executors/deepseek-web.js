import crypto from "node:crypto";
import { Keccak } from "@noble/hashes/sha3";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { chatChunkSse } from "../utils/sse.js";

const DEEPSEEK_WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function makeTextChunk(responseId, model, content, reasoningContent = "") {
  const delta = {};
  if (content) delta.content = content;
  if (reasoningContent) delta.reasoning_content = reasoningContent;
  return chatChunkSse({
    id: responseId,
    created: Math.floor(Date.now() / 1000),
    model,
    delta,
  });
}

function makeToolCallChunk(responseId, model, toolCalls, finishReason = null) {
  return chatChunkSse({
    id: responseId,
    created: Math.floor(Date.now() / 1000),
    model,
    delta: { tool_calls: toolCalls },
    finishReason,
  });
}

function makeStopChunk(responseId, model, finishReason = "stop") {
  return chatChunkSse({
    id: responseId,
    created: Math.floor(Date.now() / 1000),
    model,
    delta: {},
    finishReason,
  });
}

function cleanJsonString(str) {
  let cleaned = str.replace(/\\(?!["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
  return cleaned;
}

function parseJsonArguments(argsRaw) {
  if (typeof argsRaw === "object" && argsRaw !== null) return argsRaw;
  if (typeof argsRaw !== "string") return {};

  let s = argsRaw.trim();
  if (s.startsWith("```json")) s = s.slice(7);
  if (s.startsWith("```")) s = s.slice(3);
  if (s.endsWith("```")) s = s.slice(0, -3);
  s = s.trim();

  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(cleanJsonString(s));
    } catch {
      return {};
    }
  }
}

function normalizeToolArgs(name, args) {
  if (!args || typeof args !== "object") return {};
  const normalized = { ...args };
  if (name === "list_dir") {
    if (!normalized.path && normalized.dirPath) normalized.path = normalized.dirPath;
    if (!normalized.path) normalized.path = ".";
  }
  if (
    name === "read_file" ||
    name === "create_file" ||
    name === "insert_edit_into_file" ||
    name === "replace_string_in_file" ||
    name === "multi_replace_string_in_file"
  ) {
    if (!normalized.filePath && normalized.path) normalized.filePath = normalized.path;
    if (!normalized.path && normalized.filePath) normalized.path = normalized.filePath;
  }
  if (name === "run_in_terminal" || name === "execute_command") {
    if (!normalized.command && normalized.cmd) normalized.command = normalized.cmd;
  }
  if (name === "file_search") {
    if (!normalized.query && normalized.pattern) normalized.query = normalized.pattern;
  }
  return normalized;
}

function parseToolCallsAndCleanText(text) {
  const toolCalls = [];
  let cleanText = text;

  const patterns = [
    /<tool_call>([\s\S]*?)<\/tool_call>/gi,
    /<function_call>([\s\S]*?)<\/function_call>/gi,
    /```(?:tool_call|tool-call)\s*([\s\S]*?)```/gi,
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      cleanText = cleanText.replace(match[0], "");
      let inner = match[1].trim();
      if (inner.startsWith("```json")) inner = inner.slice(7);
      if (inner.startsWith("```")) inner = inner.slice(3);
      if (inner.endsWith("```")) inner = inner.slice(0, -3);
      inner = inner.trim();

      try {
        let parsed;
        try {
          parsed = JSON.parse(inner);
        } catch {
          parsed = JSON.parse(cleanJsonString(inner));
        }

        if (parsed && typeof parsed === "object") {
          const name = parsed.name || parsed.tool || parsed.function;
          let args = parsed.arguments || parsed.args || parsed.parameters || {};
          if (typeof args === "string") args = parseJsonArguments(args);
          if (name) {
            toolCalls.push({
              name: String(name).trim(),
              arguments: normalizeToolArgs(String(name).trim(), args),
            });
          }
        }
      } catch {}
    }
  }

  if (toolCalls.length === 0 && cleanText.includes("<tool_call>")) {
    const startIdx = cleanText.indexOf("<tool_call>");
    const unclosedInner = cleanText.slice(startIdx + 11).trim();
    cleanText = cleanText.slice(0, startIdx).trim();
    try {
      let parsed;
      try {
        parsed = JSON.parse(unclosedInner);
      } catch {
        parsed = JSON.parse(cleanJsonString(unclosedInner));
      }
      if (parsed && typeof parsed === "object") {
        const name = parsed.name || parsed.tool || parsed.function;
        let args = parsed.arguments || parsed.args || parsed.parameters || {};
        if (typeof args === "string") args = parseJsonArguments(args);
        if (name) {
          toolCalls.push({
            name: String(name).trim(),
            arguments: normalizeToolArgs(String(name).trim(), args),
          });
        }
      }
    } catch {}
  }

  return { cleanText: cleanText.trim(), toolCalls };
}

function detectOrSynthesizeToolCalls(cleanText, toolCalls, availableTools, userPrompt = "", isFirstTurn = false) {
  if (toolCalls && toolCalls.length > 0) return toolCalls;
  if (!Array.isArray(availableTools) || availableTools.length === 0) return [];

  const listDirTool = availableTools.find((t) => (t.function?.name || t.name) === "list_dir");
  const readFileTool = availableTools.find((t) => (t.function?.name || t.name) === "read_file");

  if (!isFirstTurn && readFileTool) {
    const codeTickMatch = cleanText.match(
      /`([a-zA-Z0-9_\-\.\/\\\~]+\.(?:json|jsx?|tsx?|css|scss|html|py|go|rs|md|yaml|yml|toml|env|vue|svelte))`(?!\s*tiap)/i
    );
    if (codeTickMatch) {
      const filePath = codeTickMatch[1].trim();
      if (filePath && !filePath.endsWith(".zip") && !filePath.includes("...")) {
        return [{ name: "read_file", arguments: { filePath, path: filePath } }];
      }
    }

    const fileMentionRegex =
      /(?:file|isi|baca|cek|periksa|read|inspect|buka|audit|lihat)\s*[:`'"]*\s*(?:-\s*[`'"]*)?([a-zA-Z0-9_\-\.\/\\\~]+\.[a-zA-Z0-9]+)/i;
    const fileMatch = cleanText.match(fileMentionRegex);
    if (fileMatch) {
      const filePath = fileMatch[1].replace(/[`'"]/g, "").trim();
      if (filePath && !filePath.endsWith(".zip") && !filePath.includes("...")) {
        return [{ name: "read_file", arguments: { filePath, path: filePath } }];
      }
    }
  }

  const wantsInspection =
    /(?:workspace\s+tool|akses\s+(?:file|workspace|eksekusi)|hubungkan\s+workspace|sambungkan\s+workspace|upload\s+(?:zip|file|folder)|kirim(?:kan)?\s+(?:isi|struktur|file|kode|project|proyek)|tempelkan\s+(?:struktur|file)|aktifkan\s+workspace|belum\s+(?:memiliki|menerima)\s+akses|tidak\s+(?:memiliki|bisa)\s+akses|saya\s+(?:akan\s+)?(?:cek|periksa|baca|audit|lihat|analisa|mulai|inspeksi)|(?:let me|i will|i'll|i am going to)\s+(?:check|inspect|read|explore|examine|audit))/i;

  if (wantsInspection.test(cleanText)) {
    if (isFirstTurn && listDirTool) {
      return [{ name: "list_dir", arguments: { path: ".", dirPath: "." } }];
    }
    if (readFileTool) {
      return [{ name: "read_file", arguments: { filePath: "package.json", path: "package.json" } }];
    }
    if (listDirTool) {
      return [{ name: "list_dir", arguments: { path: ".", dirPath: "." } }];
    }
  }

  if (isFirstTurn && userPrompt) {
    const isActionableProjectTask =
      /(?:cek|periksa|baca|audit|lihat|analisa|buat|ubah|edit|ganti|perbaiki|tambah|implementasi|coding|desain|design|fix|build|refactor|update|create|add|check|inspect)\s+.*(?:project|proyek|file|folder|kode|code|fitur|website|web|desain|aplikasi|app|halaman|page|komponen|component|tampilan)/i;
    if (isActionableProjectTask.test(userPrompt)) {
      if (listDirTool) return [{ name: "list_dir", arguments: { path: ".", dirPath: "." } }];
      if (readFileTool) return [{ name: "read_file", arguments: { filePath: "package.json", path: "package.json" } }];
    }
  }

  return [];
}

function findToolStart(text) {
  const patterns = [
    "<tool_call>",
    "<function_call>",
    "```tool_call",
    "```tool-call",
    "```function_call",
    "<tool_call",
    "<function_call",
  ];
  let earliest = -1;
  for (const p of patterns) {
    const idx = text.indexOf(p);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
    }
  }
  const partials = ["<tool", "<func", "```tool"];
  for (const p of partials) {
    const lastIdx = text.lastIndexOf(p[0]);
    if (lastIdx !== -1 && (earliest === -1 || lastIdx < earliest)) {
      const tail = text.slice(lastIdx);
      if (p.startsWith(tail)) {
        earliest = lastIdx;
      }
    }
  }
  return earliest;
}

function buildToolSystemPrompt(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";

  const toolDefs = tools
    .map((t) => {
      const fn = t.function || t;
      const name = fn.name;
      const desc = fn.description || "";
      const params = fn.parameters ? JSON.stringify(fn.parameters) : "{}";
      return `### Tool: \`${name}\`\nDescription: ${desc}\nParameters: ${params}`;
    })
    .join("\n\n");

  return [
    `# System Rule: Autonomous Coding Agent Protocol`,
    `You are an autonomous AI coding assistant running inside the user's IDE (Dardcor Code).`,
    `You interact with the workspace directly through client tools.`,
    `When you need to inspect, read, create, edit files, or execute commands in the project, invoke tools using this format:`,
    `<tool_call>`,
    `{`,
    `  "name": "tool_name",`,
    `  "arguments": {`,
    `    "param": "value"`,
    `  }`,
    `}`,
    `</tool_call>`,
    `Never ask the user to manually upload, paste, or send file contents or directory trees when you can inspect them via tools.`,
    `When asked to audit, fix, improve, or build features in a project, start by inspecting the project structure or key files using tools.`,
    ``,
    `# Available Workspace Tools:`,
    toolDefs,
  ].join("\n");
}

function parseOpenAIMessages(messages, toolPrompt = "") {
  if (!Array.isArray(messages)) return toolPrompt || "";
  const parts = [];
  if (toolPrompt) parts.push(toolPrompt);

  for (const msg of messages) {
    const role = String(msg.role || "user").toLowerCase();
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c) => c.type === "text")
        .map((c) => String(c.text || ""))
        .join(" ");
    }

    if (role === "system") {
      if (content.trim()) parts.push(`SYSTEM: ${content.trim()}`);
    } else if (role === "assistant") {
      let assistantText = content.trim();
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const callsStr = msg.tool_calls
          .map((tc) => {
            const fn = tc.function || {};
            const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {});
            return `<tool_call>\n{"name": "${fn.name}", "arguments": ${args}}\n</tool_call>`;
          })
          .join("\n");
        assistantText = assistantText ? `${assistantText}\n${callsStr}` : callsStr;
      }
      if (assistantText) parts.push(`ASSISTANT: ${assistantText}`);
    } else if (role === "tool") {
      const toolName = msg.name || "workspace_tool";
      const toolId = msg.tool_call_id ? ` (call_id: ${msg.tool_call_id})` : "";
      parts.push(`[Tool Result for ${toolName}${toolId}]:\n${content.trim()}`);
    } else {
      if (content.trim()) parts.push(`USER: ${content.trim()}`);
    }
  }

  return parts.join("\n\n");
}

function solveProofOfWork(challengeData, targetPath = "/api/v0/chat/completion") {
  if (!challengeData) return null;
  const { algorithm, challenge, salt, difficulty, expire_at, signature } = challengeData;

  if (algorithm !== "DeepSeekHashV1" || !challenge || !salt) {
    return null;
  }

  const maxNonce = typeof difficulty === "number" ? difficulty : 150000;
  const prefix = `${salt}_${expire_at}_`;
  const targetBuf = Buffer.from(challenge, "hex");

  // DeepSeekHashV1 executes 23 rounds (skips round 0)
  const base = new Keccak(136, 0x06, 32, false, 23);
  base.update(prefix);

  const hashBuf = new Uint8Array(32);
  let foundNonce = null;

  for (let nonce = 0; nonce <= maxNonce; nonce++) {
    const inst = base._cloneInto();
    inst.update(String(nonce));
    inst.digestInto(hashBuf);

    let match = true;
    for (let b = 0; b < 32; b++) {
      if (hashBuf[b] !== targetBuf[b]) {
        match = false;
        break;
      }
    }

    if (match) {
      foundNonce = nonce;
      break;
    }
  }

  if (foundNonce === null) return null;

  const payload = {
    algorithm,
    challenge,
    salt,
    answer: foundNonce,
    signature,
    target_path: targetPath,
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function requestPoWHeader(token, log) {
  try {
    const res = await fetch("https://chat.deepseek.com/api/v0/chat/create_pow_challenge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": DEEPSEEK_WEB_USER_AGENT,
        Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
        Origin: "https://chat.deepseek.com",
        Referer: "https://chat.deepseek.com/",
        "x-app-version": "20241129.1",
      },
      body: JSON.stringify({ target_path: "/api/v0/chat/completion" }),
    });

    if (!res.ok) {
      log?.warn?.("DSW", `Failed to get PoW challenge: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const challengeData = data?.data?.biz_data?.challenge || data?.data?.challenge;
    if (!challengeData) return null;

    const solutionB64 = solveProofOfWork(challengeData, "/api/v0/chat/completion");
    if (solutionB64) {
      log?.debug?.("DSW", "PoW challenge successfully solved.");
    }
    return solutionB64;
  } catch (err) {
    log?.warn?.("DSW", `PoW challenge error: ${err.message}`);
    return null;
  }
}

async function getOrCreateSessionId(token, log) {
  try {
    const res = await fetch("https://chat.deepseek.com/api/v0/chat_session/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": DEEPSEEK_WEB_USER_AGENT,
        Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
        Origin: "https://chat.deepseek.com",
        Referer: "https://chat.deepseek.com/",
        "x-app-version": "20241129.1",
      },
      body: JSON.stringify({ character_id: null }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.biz_data?.id || json?.data?.id || null;
  } catch (err) {
    log?.warn?.("DSW", `Session create error: ${err.message}`);
    return null;
  }
}

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor() {
    super("deepseek-web", PROVIDERS["deepseek-web"] || {
      baseUrl: "https://chat.deepseek.com/api/v0/chat/completion",
      format: "deepseek-web",
    });
  }

  buildHeaders(token, powHeader = null, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": DEEPSEEK_WEB_USER_AGENT,
      Origin: "https://chat.deepseek.com",
      Referer: "https://chat.deepseek.com/",
      "x-app-version": "20241129.1",
      Accept: stream ? "text/event-stream" : "application/json",
    };

    if (token) {
      headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    }

    if (powHeader) {
      headers["x-ds-pow-response"] = powHeader;
    }

    return headers;
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const rawModel = String(model || body?.model || "deepseek-chat").toLowerCase();
    const cleanModel = rawModel.replace(/^dsw\//, "").replace(/^deepseek-web\//, "");

    const isReasoner =
      cleanModel.includes("reasoner") ||
      cleanModel.includes("r1") ||
      cleanModel.includes("pro") ||
      cleanModel.includes("thinking") ||
      body.thinking === "high" ||
      body.thinking === "medium";

    const token = (credentials?.accessToken || credentials?.apiKey || "").trim();
    if (!token) {
      const errMsg = "DeepSeek Web token belum tersambung. Silakan buka Provider Settings dan hubungkan akun DeepSeek Web Anda.";
      return {
        response: new Response(JSON.stringify({ error: { message: errMsg, status: 401 } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }

    const availableTools = body?.tools || (body?.functions ? body.functions.map((f) => ({ type: "function", function: f })) : []);
    const toolPrompt = buildToolSystemPrompt(availableTools);
    const fullPrompt = parseOpenAIMessages(body?.messages || body?.input || [], toolPrompt);

    const userMsgs = (body?.messages || []).filter((m) => m.role === "user");
    const lastUserMsg = userMsgs[userMsgs.length - 1];
    const userPrompt = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

    const hasPriorToolCall = (body?.messages || []).some(
      (m) =>
        (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) ||
        (typeof m.content === "string" && m.content.includes("<tool_call>")) ||
        m.role === "tool"
    );
    const isFirstTurn = !hasPriorToolCall;

    let sessionId = credentials?.providerSpecificData?.chatSessionId || null;
    if (!sessionId) {
      sessionId = await getOrCreateSessionId(token, log);
    }

    const powHeader = await requestPoWHeader(token, log);
    const headers = this.buildHeaders(token, powHeader, stream);

    const payload = {
      chat_session_id: sessionId,
      parent_message_id: null,
      prompt: fullPrompt || "Hello",
      ref_file_ids: [],
      thinking_enabled: isReasoner,
      search_enabled: !!body.web_search,
      stream: true,
      model: isReasoner ? "deepseek-reasoner" : "deepseek-chat",
    };

    const url = this.config.baseUrl || "https://chat.deepseek.com/api/v0/chat/completion";
    log?.debug?.("DSW", `Connecting to DeepSeek Web | model: ${payload.model} | thinking: ${payload.thinking_enabled}`);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });

    const responseId = `chatcmpl-dsw-${Date.now()}`;
    const outModel = cleanModel || payload.model;

    if (!response.ok) {
      const errText = await response.text();
      log?.warn?.("DSW", `DeepSeek Web returned HTTP ${response.status}: ${errText.slice(0, 200)}`);
      let errMsg = `DeepSeek Web error (HTTP ${response.status}). Sesi DeepSeek Web Anda mungkin telah kadaluarsa. Silakan buka modal DeepSeek Web dan hubungkan kembali sesi Anda.`;
      try {
        const jsonErr = JSON.parse(errText);
        if (jsonErr.msg) errMsg = `DeepSeek Web error: ${jsonErr.msg} (code: ${jsonErr.code || response.status}).`;
      } catch {}

      if (stream) {
        const readable = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, `\n\n[${errMsg}]\n\n`)));
            controller.enqueue(new TextEncoder().encode(makeStopChunk(responseId, outModel)));
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            controller.close();
          },
        });
        return { response: new Response(readable, { headers: SSE_HEADERS_NO_BUFFER }) };
      }

      return {
        response: new Response(JSON.stringify({ error: { message: errMsg, status: response.status } }), {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }

    if (stream) {
      const readable = new ReadableStream({
        async start(controller) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let fullAssistantText = "";
          let lastEmittedTextLength = 0;
          let chunkCount = 0;

          let currentFragmentType = "RESPONSE";
          let currentEvent = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(":")) continue;
                if (trimmed.startsWith("event: ")) {
                  currentEvent = trimmed.slice(7).trim();
                  continue;
                }
                if (trimmed === "data: [DONE]" || trimmed === "[DONE]") {
                  continue;
                }
                if (currentEvent === "title" || currentEvent === "close") {
                  continue;
                }

                let dataStr = trimmed;
                if (dataStr.startsWith("data: ")) {
                  dataStr = dataStr.slice(6).trim();
                }

                try {
                  const json = JSON.parse(dataStr);
                  if (json && json.code && json.code !== 0) {
                    const errMsg = `DeepSeek Web error: ${json.msg || "API error"} (code: ${json.code})`;
                    controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, `\n\n[${errMsg}]\n\n`)));
                    chunkCount++;
                    continue;
                  }

                  if (json.p === "response/status" || json.p === "response" || json.v === "FINISHED") {
                    continue;
                  }

                  if (Array.isArray(json.v?.response?.fragments)) {
                    const firstFrag = json.v.response.fragments[0];
                    if (firstFrag?.type) currentFragmentType = firstFrag.type;
                    if (firstFrag?.content) {
                      if (currentFragmentType === "THINK") {
                        controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, "", firstFrag.content)));
                        chunkCount++;
                      } else {
                        fullAssistantText += firstFrag.content;
                        controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, firstFrag.content)));
                        lastEmittedTextLength = fullAssistantText.length;
                        chunkCount++;
                      }
                    }
                  }

                  if (json.p === "response/fragments" && Array.isArray(json.v)) {
                    for (const frag of json.v) {
                      if (frag?.type) currentFragmentType = frag.type;
                      if (frag?.content) {
                        if (currentFragmentType === "THINK") {
                          controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, "", frag.content)));
                          chunkCount++;
                        } else {
                          fullAssistantText += frag.content;
                          controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, frag.content)));
                          lastEmittedTextLength = fullAssistantText.length;
                          chunkCount++;
                        }
                      }
                    }
                  }

                  const textDelta =
                    typeof json.v === "string" && (json.p === "response/fragments/-1/content" || !json.p)
                      ? json.v
                      : (json.choices?.[0]?.delta?.content || json.delta || "");
                  const explicitReasoning = json.choices?.[0]?.delta?.reasoning_content || json.reasoning_content || "";

                  if (explicitReasoning) {
                    controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, "", explicitReasoning)));
                    chunkCount++;
                  }

                  if (textDelta) {
                    if (currentFragmentType === "THINK") {
                      controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, "", textDelta)));
                      chunkCount++;
                    } else {
                      fullAssistantText += textDelta;
                      const toolIdx = findToolStart(fullAssistantText);
                      const limit = toolIdx !== -1 ? toolIdx : fullAssistantText.length;
                      if (limit > lastEmittedTextLength) {
                        const delta = fullAssistantText.slice(lastEmittedTextLength, limit);
                        lastEmittedTextLength = limit;
                        controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, delta)));
                        chunkCount++;
                      }
                    }
                  }
                } catch {
                  if (dataStr && !dataStr.startsWith("{")) {
                    fullAssistantText += dataStr;
                    controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, dataStr)));
                    chunkCount++;
                  }
                }
              }
            }

            if (chunkCount === 0) {
              const fallbackMsg =
                "DeepSeek Web: Tidak ada respon yang diterima. Pastikan sesi login DeepSeek Web Anda masih aktif.";
              controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, `\n\n[${fallbackMsg}]\n\n`)));
            }

            let { cleanText, toolCalls } = parseToolCallsAndCleanText(fullAssistantText);
            toolCalls = detectOrSynthesizeToolCalls(
              cleanText,
              toolCalls,
              availableTools,
              userPrompt,
              isFirstTurn
            );

            if (toolCalls.length > 0) {
              toolCalls.forEach((tc, idx) => {
                controller.enqueue(
                  new TextEncoder().encode(
                    makeToolCallChunk(responseId, outModel, [
                      {
                        index: idx,
                        id: `call_${Date.now()}_${idx}`,
                        type: "function",
                        function: {
                          name: tc.name,
                          arguments: JSON.stringify(tc.arguments),
                        },
                      },
                    ])
                  )
                );
              });
              controller.enqueue(new TextEncoder().encode(makeStopChunk(responseId, outModel, "tool_calls")));
            } else {
              if (lastEmittedTextLength < fullAssistantText.length) {
                const delta = fullAssistantText.slice(lastEmittedTextLength);
                controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, delta)));
              }
              controller.enqueue(new TextEncoder().encode(makeStopChunk(responseId, outModel, "stop")));
            }

            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            controller.close();
          } catch (streamErr) {
            controller.error(streamErr);
          } finally {
            reader.releaseLock();
          }
        },
      });

      return { response: new Response(readable, { headers: SSE_HEADERS_NO_BUFFER }) };
    }

    const rawText = await response.text();
    let accumulatedContent = "";
    let accumulatedReasoning = "";
    let currentEvent = "";
    let currentFragmentType = "RESPONSE";

    for (const line of rawText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (trimmed.startsWith("event: ")) {
        currentEvent = trimmed.slice(7).trim();
        continue;
      }
      if (currentEvent === "title" || currentEvent === "close") continue;
      if (!trimmed.startsWith("data: ")) continue;
      const dataStr = trimmed.slice(6).trim();
      if (dataStr === "[DONE]") break;
      try {
        const json = JSON.parse(dataStr);
        if (json.p === "response/status" || json.p === "response" || json.v === "FINISHED") continue;
        if (Array.isArray(json.v?.response?.fragments)) {
          const f = json.v.response.fragments[0];
          if (f?.type) currentFragmentType = f.type;
          if (f?.content) {
            if (currentFragmentType === "THINK") accumulatedReasoning += f.content;
            else accumulatedContent += f.content;
          }
        }
        if (json.p === "response/fragments" && Array.isArray(json.v)) {
          for (const f of json.v) {
            if (f?.type) currentFragmentType = f.type;
            if (f?.content) {
              if (currentFragmentType === "THINK") accumulatedReasoning += f.content;
              else accumulatedContent += f.content;
            }
          }
        }
        if (typeof json.v === "string" && (json.p === "response/fragments/-1/content" || !json.p)) {
          if (currentFragmentType === "THINK") accumulatedReasoning += json.v;
          else accumulatedContent += json.v;
        }
      } catch {}
    }

    const jsonRes = {
      id: responseId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: outModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: accumulatedContent || rawText,
            ...(accumulatedReasoning ? { reasoning_content: accumulatedReasoning } : {}),
          },
          finish_reason: "stop",
        },
      ],
    };

    return {
      response: new Response(JSON.stringify(jsonRes), {
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
}
