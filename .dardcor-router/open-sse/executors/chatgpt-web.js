import http2 from "node:http2";
import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { chatChunkSse } from "../utils/sse.js";

const CHATGPT_WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const CHROME_CIPHERS = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

function makeTextChunk(responseId, model, content) {
  return chatChunkSse({
    id: responseId,
    created: Math.floor(Date.now() / 1000),
    model,
    delta: { content },
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
          if (typeof args === "string") {
            args = parseJsonArguments(args);
          }
          if (name) {
            toolCalls.push({ name: String(name).trim(), arguments: normalizeToolArgs(String(name).trim(), args) });
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
          toolCalls.push({ name: String(name).trim(), arguments: normalizeToolArgs(String(name).trim(), args) });
        }
      }
    } catch {}
  }

  return { cleanText: cleanText.trim(), toolCalls };
}

function normalizeToolArgs(name, args) {
  if (!args || typeof args !== "object") return {};
  const normalized = { ...args };
  if (name === "list_dir") {
    if (!normalized.path && normalized.dirPath) normalized.path = normalized.dirPath;
    if (!normalized.path) normalized.path = ".";
  }
  if (name === "read_file" || name === "create_file" || name === "insert_edit_into_file" || name === "replace_string_in_file" || name === "multi_replace_string_in_file") {
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

function detectOrSynthesizeToolCalls(cleanText, toolCalls, availableTools, userPrompt = "", isFirstTurn = false) {
  if (toolCalls && toolCalls.length > 0) return toolCalls;
  if (!Array.isArray(availableTools) || availableTools.length === 0) return [];

  const listDirTool = availableTools.find((t) => (t.function?.name || t.name) === "list_dir");
  const readFileTool = availableTools.find((t) => (t.function?.name || t.name) === "read_file");

  if (!isFirstTurn && readFileTool) {
    const codeTickMatch = cleanText.match(/`([a-zA-Z0-9_\-\.\/\\\~]+\.(?:json|jsx?|tsx?|css|scss|html|py|go|rs|md|yaml|yml|toml|env|vue|svelte))`(?!\s*tiap)/i);
    if (codeTickMatch) {
      const filePath = codeTickMatch[1].trim();
      if (filePath && !filePath.endsWith(".zip") && !filePath.includes("...")) {
        return [{ name: "read_file", arguments: { filePath, path: filePath } }];
      }
    }

    const fileMentionRegex = /(?:file|isi|baca|cek|periksa|read|inspect|buka|audit|lihat)\s*[:`'"]*\s*(?:-\s*[`'"]*)?([a-zA-Z0-9_\-\.\/\\\~]+\.[a-zA-Z0-9]+)/i;
    const fileMatch = cleanText.match(fileMentionRegex);
    if (fileMatch) {
      const filePath = fileMatch[1].replace(/[`'"]/g, "").trim();
      if (filePath && !filePath.endsWith(".zip") && !filePath.includes("...")) {
        return [{ name: "read_file", arguments: { filePath, path: filePath } }];
      }
    }
  }

  const wantsInspection = /(?:workspace\s+tool|akses\s+(?:file|workspace|eksekusi)|hubungkan\s+workspace|sambungkan\s+workspace|upload\s+(?:zip|file|folder)|kirim(?:kan)?\s+(?:isi|struktur|file|kode|project|proyek)|tempelkan\s+(?:struktur|file)|aktifkan\s+workspace|belum\s+(?:memiliki|menerima)\s+akses|tidak\s+(?:memiliki|bisa)\s+akses|saya\s+(?:akan\s+)?(?:cek|periksa|baca|audit|lihat|analisa|mulai|inspeksi)|(?:let me|i will|i'll|i am going to)\s+(?:check|inspect|read|explore|examine|audit))/i;

  if (wantsInspection.test(cleanText)) {
    if (isFirstTurn && listDirTool) {
      return [{ name: "list_dir", arguments: { path: ".", dirPath: "." } }];
    }
    if (readFileTool) {
      const fallbackFile = cleanText.includes("package.json") ? "package.json" : "package.json";
      return [{ name: "read_file", arguments: { filePath: fallbackFile, path: fallbackFile } }];
    }
    if (listDirTool) {
      return [{ name: "list_dir", arguments: { path: ".", dirPath: "." } }];
    }
  }

  if (isFirstTurn && userPrompt) {
    const isActionableProjectTask = /(?:cek|periksa|baca|audit|lihat|analisa|buat|ubah|edit|ganti|perbaiki|tambah|implementasi|coding|desain|design|fix|build|refactor|update|create|add|check|inspect)\s+.*(?:project|proyek|file|folder|kode|code|fitur|website|web|desain|aplikasi|app|halaman|page|komponen|component|tampilan)/i;
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

function resolveWebModel(model) {
  const clean = String(model || "auto")
    .trim()
    .toLowerCase()
    .replace(/^cgw\//, "")
    .replace(/^chatgpt-web\//, "")
    .replace(/^chatgpt\//, "")
    .replace(/\s+/g, "-");

  if (clean.includes("4o-mini")) return "gpt-4o-mini";
  if (clean.includes("4o")) return "gpt-4o";
  if (clean.includes("o3-mini") || clean.includes("o3")) return "o3-mini";
  if (clean.includes("o1-mini")) return "o1-mini";
  if (clean.includes("o1-pro")) return "o1-pro";
  if (clean.includes("o1")) return "o1";
  if (clean.includes("4.5")) return "gpt-4.5";
  if (clean.includes("terra")) return "gpt-5.6-terra";
  if (clean.includes("luna")) return "gpt-5.6-luna";
  if (clean.includes("5.6")) return "gpt-5.6-luna";
  if (clean.includes("5.5")) return "gpt-5.5";
  return clean || "auto";
}

function solveProofOfWork(seed, diff, userAgent) {
  const config = [
    3016,
    new Date().toString(),
    4294705152,
    0,
    userAgent,
    "",
    "",
    "en-US",
    "en-US,es-US,en,es",
    0,
    "vendor−Google Inc.",
    "location",
    "window",
    performance.now(),
    crypto.randomUUID(),
    "",
    16,
    Date.now() - performance.now(),
  ];

  const diffLen = diff.length;
  const seedBuf = Buffer.from(seed, "utf8");
  const targetDiff = Buffer.from(diff, "hex");

  const p1 = Buffer.from(JSON.stringify(config.slice(0, 3)).slice(0, -1) + ",", "utf8");
  const p2 = Buffer.from("," + JSON.stringify(config.slice(4, 9)).slice(1, -1) + ",", "utf8");
  const p3 = Buffer.from("," + JSON.stringify(config.slice(10)).slice(1), "utf8");

  for (let i = 0; i < 500000; i++) {
    const d1 = Buffer.from(String(i), "utf8");
    const d2 = Buffer.from(String(i >> 1), "utf8");

    const finalBuf = Buffer.concat([p1, d1, p2, d2, p3]);
    const baseEncode = finalBuf.toString("base64");
    const baseEncodeBuf = Buffer.from(baseEncode, "utf8");

    const hash = crypto.createHash("sha3-512")
      .update(seedBuf)
      .update(baseEncodeBuf)
      .digest();

    if (hash.subarray(0, diffLen).compare(targetDiff) <= 0) {
      return "gAAAAAB" + baseEncode;
    }
  }

  return "wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D" + Buffer.from(`"${seed}"`).toString("base64");
}

function createH2Session() {
  return http2.connect("https://chatgpt.com", {
    ciphers: CHROME_CIPHERS,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.3",
  });
}

export class ChatGPTWebExecutor extends BaseExecutor {
  constructor() {
    super("chatgpt-web", PROVIDERS["chatgpt-web"] || {
      baseUrl: "https://chatgpt.com/backend-api/conversation",
      format: "chatgpt-web",
    });
  }

  transformRequest(model, body) {
    const mappedModel = resolveWebModel(model || body?.model);
    const tools = body?.tools || (body?.functions ? body.functions.map((f) => ({ type: "function", function: f })) : []);
    const toolPrompt = buildToolSystemPrompt(tools);

    const outMessages = [];
    const systemParts = [];
    if (toolPrompt) {
      systemParts.push(toolPrompt);
    }

    const rawMessages = Array.isArray(body?.messages)
      ? body.messages
      : body?.input
      ? [{ role: "user", content: body.input }]
      : [];

    for (const msg of rawMessages) {
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
        if (content.trim()) systemParts.push(content.trim());
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
        if (assistantText) {
          outMessages.push({
            id: crypto.randomUUID(),
            author: { role: "assistant" },
            content: { content_type: "text", parts: [assistantText] },
            metadata: {},
          });
        }
      } else if (role === "tool") {
        const toolName = msg.name || "workspace_tool";
        const toolId = msg.tool_call_id ? ` (call_id: ${msg.tool_call_id})` : "";
        outMessages.push({
          id: crypto.randomUUID(),
          author: { role: "user" },
          content: { content_type: "text", parts: [`[Tool Result for ${toolName}${toolId}]:\n${content.trim()}`] },
          metadata: {},
        });
      } else {
        if (content.trim()) {
          outMessages.push({
            id: crypto.randomUUID(),
            author: { role: "user" },
            content: { content_type: "text", parts: [content.trim()] },
            metadata: {},
          });
        }
      }
    }

    if (systemParts.length > 0) {
      outMessages.unshift({
        id: crypto.randomUUID(),
        author: { role: "system" },
        content: { content_type: "text", parts: [systemParts.join("\n\n")] },
        metadata: {},
      });
    }


    if (outMessages.length === 0) {
      outMessages.push({
        id: crypto.randomUUID(),
        author: { role: "user" },
        content: { content_type: "text", parts: ["Hello"] },
        metadata: {},
      });
    }

    return {
      action: "next",
      messages: outMessages,
      parent_message_id: crypto.randomUUID(),
      model: mappedModel,
      timezone_offset_min: -new Date().getTimezoneOffset(),
      suggestions: [],
      history_and_training_disabled: true,
      conversation_mode: { kind: "primary_assistant" },
      force_paragen: false,
    };
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const mappedModel = resolveWebModel(model || body?.model);
    const responseId = `chatcmpl-cgw-${Date.now()}`;
    const outModel = mappedModel;

    const rawMessages = Array.isArray(body?.messages)
      ? body.messages
      : body?.input
      ? [{ role: "user", content: body.input }]
      : [];
    const lastUserMsg = [...rawMessages].reverse().find((m) => String(m.role).toLowerCase() === "user");
    let userPrompt = "";
    if (typeof lastUserMsg?.content === "string") {
      userPrompt = lastUserMsg.content;
    } else if (Array.isArray(lastUserMsg?.content)) {
      userPrompt = lastUserMsg.content.filter((c) => c.type === "text").map((c) => c.text).join(" ");
    }
    const hasPriorToolCall = rawMessages.some(
      (m) =>
        (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) ||
        (typeof m.content === "string" && m.content.includes("<tool_call>")) ||
        m.role === "tool"
    );
    const isFirstTurn = !hasPriorToolCall;

    const token = (credentials?.accessToken || credentials?.apiKey || "").trim();
    const accountId = credentials?.providerSpecificData?.chatgptAccountId || null;
    const deviceId = credentials?.providerSpecificData?.deviceId || crypto.randomUUID();
    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    log?.debug?.("CGW", `Connecting to ChatGPT Web via HTTP/2 | model: ${mappedModel}`);

    const client = createH2Session();
    let clientClosed = false;
    const safeCloseClient = () => {
      if (!clientClosed) {
        clientClosed = true;
        try { client.close(); } catch {}
      }
    };

    if (signal) {
      signal.addEventListener("abort", () => {
        safeCloseClient();
      }, { once: true });
    }

    let sentinelToken = null;
    let proofToken = null;

    try {
      const reqPayload = Buffer.from("{}", "utf8");
      const sReq = client.request({
        ":method": "POST",
        ":path": "/backend-api/sentinel/chat-requirements",
        ":authority": "chatgpt.com",
        ":scheme": "https",
        "content-type": "application/json",
        "content-length": reqPayload.length,
        "user-agent": CHATGPT_WEB_USER_AGENT,
        authorization: authHeader,
        ...(accountId ? { "chatgpt-account-id": accountId } : {}),
        "oai-device-id": deviceId,
        origin: "https://chatgpt.com",
        referer: "https://chatgpt.com/",
        "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      });

      let sBody = "";
      sReq.on("data", (chunk) => { sBody += chunk.toString(); });

      const sJson = await new Promise((resolve, reject) => {
        sReq.on("end", () => {
          try {
            resolve(JSON.parse(sBody));
          } catch (e) {
            reject(new Error(`Failed to parse sentinel requirements: ${sBody.slice(0, 100)}`));
          }
        });
        sReq.on("error", reject);
        sReq.write(reqPayload);
        sReq.end();
      });

      sentinelToken = sJson?.token || null;
      console.log("[CGW-DEBUG] Sentinel token:", !!sentinelToken, "PoW required:", sJson?.proofofwork?.required);
      if (sJson?.proofofwork?.required && sJson.proofofwork.seed && sJson.proofofwork.difficulty) {
        proofToken = solveProofOfWork(sJson.proofofwork.seed, sJson.proofofwork.difficulty, CHATGPT_WEB_USER_AGENT);
        console.log("[CGW-DEBUG] Solved PoW token:", !!proofToken);
      }
    } catch (sErr) {
      console.error("[CGW-DEBUG] Sentinel requirements error:", sErr);
      log?.warn?.("CGW", `Sentinel requirements warning: ${sErr.message}`);
    }

    const transformed = this.transformRequest(model, body);
    const inputMessageIds = new Set(transformed.messages.map((m) => m.id));
    const bodyBuffer = Buffer.from(JSON.stringify(transformed), "utf8");

    const convHeaders = {
      ":method": "POST",
      ":path": "/backend-api/conversation",
      ":authority": "chatgpt.com",
      ":scheme": "https",
      "content-type": "application/json",
      "content-length": bodyBuffer.length,
      "user-agent": CHATGPT_WEB_USER_AGENT,
      authorization: authHeader,
      ...(accountId ? { "chatgpt-account-id": accountId } : {}),
      accept: "text/event-stream",
      "accept-language": "en-US,en;q=0.9",
      origin: "https://chatgpt.com",
      referer: "https://chatgpt.com/",
      "oai-device-id": deviceId,
      "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    };

    if (sentinelToken) {
      convHeaders["openai-sentinel-chat-requirements-token"] = sentinelToken;
    }
    if (proofToken) {
      convHeaders["openai-sentinel-proof-token"] = proofToken;
    }

    if (stream) {
      const readable = new ReadableStream({
        start(controller) {
          let convReq;
          try {
            convReq = client.request(convHeaders);
          } catch (reqErr) {
            safeCloseClient();
            const errMsg = `ChatGPT Web connection error: ${reqErr.message}`;
            controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, `\n\n[${errMsg}]\n\n`)));
            controller.enqueue(new TextEncoder().encode(makeStopChunk(responseId, outModel, "stop")));
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            controller.close();
            return;
          }

          let status = 200;
          let buffer = "";
          let fullAssistantText = "";
          let lastEmittedTextLength = 0;
          let chunkCount = 0;
          let errorBody = "";
          let streamFinished = false;

          const finishStream = () => {
            if (streamFinished) return;
            streamFinished = true;
            safeCloseClient();

            if (status >= 400) {
              let errMsg = `ChatGPT Web error (HTTP ${status}). Sesi ChatGPT Web Anda mungkin telah kadaluarsa. Silakan buka modal ChatGPT Web dan klik 'Connect' untuk memperbarui sesi.`;
              try {
                const j = JSON.parse(errorBody);
                if (j?.detail?.message) errMsg = j.detail.message;
                else if (j?.detail) errMsg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
              } catch {}
              controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, `\n\n[${errMsg}]\n\n`)));
              controller.enqueue(new TextEncoder().encode(makeStopChunk(responseId, outModel, "stop")));
              controller.enqueue(new TextEncoder().encode(SSE_DONE));
              controller.close();
              return;
            }

            if (chunkCount === 0 && fullAssistantText.length === 0) {
              const fallbackMsg = "ChatGPT Web: Tidak ada respon yang diterima. Pastikan sesi login ChatGPT Web Anda masih aktif.";
              controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, `\n\n[${fallbackMsg}]\n\n`)));
            }

            let { cleanText, toolCalls } = parseToolCallsAndCleanText(fullAssistantText);
            toolCalls = detectOrSynthesizeToolCalls(cleanText, toolCalls, body?.tools || body?.functions, userPrompt, isFirstTurn);
            if (toolCalls.length > 0) {
              toolCalls.forEach((tc, idx) => {
                controller.enqueue(new TextEncoder().encode(makeToolCallChunk(responseId, outModel, [{
                  index: idx,
                  id: `call_${Date.now()}_${idx}`,
                  type: "function",
                  function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments),
                  },
                }])));
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
          };

          convReq.on("response", (resHeaders) => {
            status = Number(resHeaders[":status"] || 200);
            console.log("[CGW-DEBUG] convReq response status:", status);
          });

          convReq.on("data", (chunk) => {
            const text = chunk.toString();
            console.log("[CGW-DEBUG] convReq chunk received, len:", text.length, "status:", status);
            if (status >= 400) {
              errorBody += text;
              return;
            }

            buffer += text;
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith("event:") || trimmed.startsWith(":")) continue;
              if (trimmed === "data: [DONE]" || trimmed === "[DONE]") {
                finishStream();
                continue;
              }

              let dataStr = trimmed;
              if (dataStr.startsWith("data: ")) {
                dataStr = dataStr.slice(6).trim();
              }

              try {
                const json = JSON.parse(dataStr);
                if (
                  !json?.message ||
                  inputMessageIds.has(json.message.id) ||
                  json.message.author?.role !== "assistant" ||
                  json.message.content?.content_type !== "text"
                ) {
                  continue;
                }

                const parts = json.message.content?.parts;
                if (Array.isArray(parts) && typeof parts[0] === "string") {
                  fullAssistantText = parts[0];
                  const toolIdx = findToolStart(fullAssistantText);
                  const limit = toolIdx !== -1 ? toolIdx : fullAssistantText.length;
                  if (limit > lastEmittedTextLength) {
                    const delta = fullAssistantText.slice(lastEmittedTextLength, limit);
                    lastEmittedTextLength = limit;
                    controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, delta)));
                    chunkCount++;
                  }
                }
                if (json.message.status === "finished_successfully") {
                  finishStream();
                }
              } catch {
                // ignore non-json line
              }
            }
          });

          convReq.on("end", () => {
            finishStream();
          });

          convReq.on("error", (err) => {
            if (!streamFinished) {
              streamFinished = true;
              safeCloseClient();
              const errMsg = `ChatGPT Web stream error: ${err.message}`;
              controller.enqueue(new TextEncoder().encode(makeTextChunk(responseId, outModel, `\n\n[${errMsg}]\n\n`)));
              controller.enqueue(new TextEncoder().encode(makeStopChunk(responseId, outModel, "stop")));
              controller.enqueue(new TextEncoder().encode(SSE_DONE));
              controller.close();
            }
          });

          convReq.write(bodyBuffer);
          convReq.end();
        },
      });

      return {
        response: new Response(readable, { headers: SSE_HEADERS_NO_BUFFER }),
        responseFormat: "openai",
      };
    }

    return new Promise((resolve) => {
      let convReq;
      try {
        convReq = client.request(convHeaders);
      } catch (err) {
        safeCloseClient();
        return resolve({
          response: new Response(
            JSON.stringify({ error: { message: err.message, status: 500 } }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          ),
          responseFormat: "openai",
        });
      }

      let status = 200;
      let fullText = "";
      let errorBody = "";

      convReq.on("response", (resHeaders) => {
        status = Number(resHeaders[":status"] || 200);
      });

      convReq.on("data", (chunk) => {
        const text = chunk.toString();
        if (status >= 400) {
          errorBody += text;
          return;
        }

        const lines = text.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]") continue;
          try {
            const j = JSON.parse(trimmed.slice(6));
            if (
              !j?.message ||
              inputMessageIds.has(j.message.id) ||
              j.message.author?.role !== "assistant" ||
              j.message.content?.content_type !== "text"
            ) {
              continue;
            }

            const parts = j.message.content?.parts;
            if (Array.isArray(parts) && typeof parts[0] === "string") {
              fullText = parts[0];
            }
          } catch {}
        }
      });

      convReq.on("end", () => {
        safeCloseClient();

        if (status >= 400) {
          let errMsg = `ChatGPT Web error (HTTP ${status}). Sesi ChatGPT Web Anda mungkin telah kadaluarsa.`;
          try {
            const j = JSON.parse(errorBody);
            if (j?.detail?.message) errMsg = j.detail.message;
            else if (j?.detail) errMsg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
          } catch {}
          return resolve({
            response: new Response(
              JSON.stringify({ error: { message: errMsg, status } }),
              { status, headers: { "Content-Type": "application/json" } }
            ),
            responseFormat: "openai",
          });
        }

        let { cleanText, toolCalls } = parseToolCallsAndCleanText(fullText);
        toolCalls = detectOrSynthesizeToolCalls(cleanText, toolCalls, body?.tools || body?.functions, userPrompt, isFirstTurn);
        const choiceMessage = {
          role: "assistant",
          content: cleanText,
        };
        let finishReason = "stop";

        if (toolCalls.length > 0) {
          finishReason = "tool_calls";
          choiceMessage.tool_calls = toolCalls.map((tc, idx) => ({
            id: `call_${Date.now()}_${idx}`,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }

        return resolve({
          response: new Response(
            JSON.stringify({
              id: responseId,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: outModel,
              choices: [
                {
                  index: 0,
                  message: choiceMessage,
                  finish_reason: finishReason,
                },
              ],
            }),
            { headers: { "Content-Type": "application/json" } }
          ),
          responseFormat: "openai",
        });
      });

      convReq.on("error", (err) => {
        safeCloseClient();
        return resolve({
          response: new Response(
            JSON.stringify({ error: { message: err.message, status: 500 } }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          ),
          responseFormat: "openai",
        });
      });

      convReq.write(bodyBuffer);
      convReq.end();
    });
  }
}
