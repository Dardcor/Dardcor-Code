import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { chatChunkSse } from "../utils/sse.js";

const GEMINI_WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

let cachedBL = "boq_assistant-bard-web-server_20260922.11_p0";
let cachedFSID = "";

function makeTextChunk(responseId, model, content) {
  return chatChunkSse({
    id: responseId,
    created: Math.floor(Date.now() / 1000),
    model,
    delta: { content },
  });
}

function makeStopChunk(responseId, model) {
  return chatChunkSse({
    id: responseId,
    created: Math.floor(Date.now() / 1000),
    model,
    delta: {},
    finishReason: "stop",
  });
}

function parseOpenAIMessages(messages) {
  if (!Array.isArray(messages)) return "";
  const parts = [];
  for (const msg of messages) {
    const role = String(msg.role || "user");
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c) => c.type === "text")
        .map((c) => String(c.text || ""))
        .join(" ");
    }
    if (content.trim()) {
      parts.push(`${role.toUpperCase()}: ${content}`);
    }
  }
  return parts.join("\n\n");
}

function findTextInArray(arr) {
  if (!arr) return "";
  if (typeof arr === "string") {
    if (
      arr.startsWith("http") ||
      arr.startsWith("c_") ||
      arr.startsWith("rc_") ||
      arr.startsWith("wrb.fr") ||
      arr.length < 2
    ) {
      return "";
    }
    return arr;
  }
  if (Array.isArray(arr)) {
    const p1 = arr[4]?.[0]?.[1]?.[0];
    if (typeof p1 === "string" && p1.length > 0) return p1;
    const p2 = arr[0]?.[4]?.[0]?.[1]?.[0];
    if (typeof p2 === "string" && p2.length > 0) return p2;

    let longest = "";
    for (const item of arr) {
      const found = findTextInArray(item);
      if (found.length > longest.length) longest = found;
    }
    return longest;
  }
  return "";
}

function extractGeminiWebText(rawBuffer) {
  if (!rawBuffer) return "";
  const text = rawBuffer.replace(/^\)\]\}'\s*/, "");
  let fullExtracted = "";

  let startIdx = 0;
  while ((startIdx = text.indexOf('"wrb.fr"', startIdx)) !== -1) {
    let arrayStart = text.lastIndexOf("[", startIdx);
    if (arrayStart > 0) {
      const prevNonWs = text.slice(0, arrayStart).trimEnd();
      if (prevNonWs.endsWith("[")) {
        arrayStart = prevNonWs.length - 1;
      }
    }

    let depth = 0;
    let endIdx = -1;
    let inString = false;
    let escaped = false;

    for (let i = arrayStart; i < text.length; i++) {
      const char = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === "[") depth++;
        else if (char === "]") {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
    }

    if (endIdx !== -1) {
      const jsonCandidate = text.slice(arrayStart, endIdx + 1);
      try {
        const parsed = JSON.parse(jsonCandidate);
        const items = Array.isArray(parsed) ? (Array.isArray(parsed[0]) ? parsed : [parsed]) : [];
        for (const item of items) {
          if (Array.isArray(item) && typeof item[2] === "string") {
            try {
              const inner = JSON.parse(item[2]);
              const found = findTextInArray(inner);
              if (found.length > fullExtracted.length) {
                fullExtracted = found;
              }
            } catch {}
          }
        }
      } catch {}
      startIdx = endIdx + 1;
    } else {
      startIdx += 9;
    }
  }

  if (!fullExtracted) {
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^\d+$/.test(trimmed)) continue;
      if (trimmed.startsWith("[[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (Array.isArray(item) && typeof item[2] === "string") {
                try {
                  const inner = JSON.parse(item[2]);
                  const found = findTextInArray(inner);
                  if (found.length > fullExtracted.length) {
                    fullExtracted = found;
                  }
                } catch {}
              }
            }
          }
        } catch {}
      }
    }
  }

  return fullExtracted;
}

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", PROVIDERS["gemini-web"] || {
      baseUrl: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
      format: "gemini-web",
    });
  }

  buildHeaders(credentials) {
    const cookies =
      credentials?.cookies ||
      credentials?.providerSpecificData?.cookies ||
      credentials?.accessToken ||
      credentials?.apiKey ||
      "";

    return {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": GEMINI_WEB_USER_AGENT,
      Origin: "https://gemini.google.com",
      Referer: "https://gemini.google.com/",
      "x-same-domain": "1",
      Cookie: cookies.includes("=") ? cookies : `__Secure-1PSID=${cookies}`,
      Accept: "*/*",
    };
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const rawModel = String(model || body?.model || "gemini-3.5-flash").toLowerCase();
    const cleanModel = rawModel.replace(/^gmw\//, "").replace(/^gemini-web\//, "");
    const outModel = cleanModel && cleanModel !== "auto" ? cleanModel : "gemini-3.5-flash";
    const responseId = `chatcmpl-gmw-${Date.now()}`;

    const promptText = parseOpenAIMessages(body?.messages || body?.input || []);
    let atToken =
      credentials?.providerSpecificData?.snlm0e ||
      credentials?.providerSpecificData?.at ||
      "";

    const cookieStr =
      credentials?.cookies ||
      credentials?.providerSpecificData?.cookies ||
      credentials?.accessToken ||
      "";

    try {
      const probeRes = await fetch("https://gemini.google.com/app", {
        headers: {
          "User-Agent": GEMINI_WEB_USER_AGENT,
          Cookie: cookieStr.includes("=") ? cookieStr : `__Secure-1PSID=${cookieStr}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (probeRes.ok) {
        const html = await probeRes.text();
        const snMatch = html.match(/"SNlM0e":"([^"]+)"/) || html.match(/\["SNlM0e",\[\],\[\],"([^"]+)"\]/);
        if (snMatch) {
          atToken = snMatch[1];
          if (credentials.providerSpecificData) {
            credentials.providerSpecificData.snlm0e = atToken;
          }
        }
        const blMatch = html.match(/"cfb2h":"([^"]+)"/) || html.match(/boq_assistant-bard-web-server_[0-9._a-zA-Z]+/);
        if (blMatch) {
          cachedBL = blMatch[1] || blMatch[0];
        }
        const fsidMatch = html.match(/"FdrFJe":"([^"]+)"/);
        if (fsidMatch) {
          cachedFSID = fsidMatch[1];
        }
      }
    } catch {}

    if (!atToken) {
      const errMsg = "Sesi Gemini Web tidak terautentikasi (SNlM0e token tidak ditemukan). Cookie Google Anda kemungkinan telah kedaluwarsa atau belum menyertakan __Secure-1PSIDTS. Silakan hubungkan ulang akun dengan Copy as cURL dari gemini.google.com atau gunakan Ekstensi Gemini Web Sync.";
      log?.warn?.("GMW", errMsg);
      if (stream) {
        const readable = new ReadableStream({
          start(controller) {
            const chunk = makeTextChunk(responseId, outModel, `\n\n[${errMsg}]\n\n`);
            controller.enqueue(new TextEncoder().encode(chunk));
            controller.enqueue(new TextEncoder().encode(makeStopChunk(responseId, outModel)));
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            controller.close();
          },
        });
        return {
          response: new Response(readable, { headers: SSE_HEADERS_NO_BUFFER }),
        };
      }
      return {
        response: new Response(
          JSON.stringify({
            error: {
              message: errMsg,
              status: 401,
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        ),
      };
    }

    const reqData = [
      null,
      JSON.stringify([
        [promptText || "Hello"],
        null,
        ["", "", ""],
      ]),
    ];

    const formBody = new URLSearchParams();
    formBody.append("f.req", JSON.stringify(reqData));
    if (atToken) formBody.append("at", atToken);
    if (cachedFSID) formBody.append("f.sid", cachedFSID);

    const headers = this.buildHeaders(credentials, stream);
    const url = `${this.config.baseUrl || "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"}?bl=${cachedBL}&_reqid=${Math.floor(Math.random() * 900000) + 100000}&rt=c`;

    log?.debug?.("GMW", `Sending request to Gemini Web | model: ${outModel} | bl: ${cachedBL}`);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formBody.toString(),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      log?.warn?.("GMW", `Gemini Web returned HTTP ${response.status}: ${errText.slice(0, 200)}`);
      const errMsg = `Gemini Web error (HTTP ${response.status}): ${errText.slice(0, 300)}. Pastikan cookie __Secure-1PSID dan __Secure-1PSIDTS masih aktif.`;

      if (stream) {
        const readable = new ReadableStream({
          start(controller) {
            const chunk = makeTextChunk(responseId, outModel, `\n\n[${errMsg}]\n\n`);
            controller.enqueue(new TextEncoder().encode(chunk));
            controller.enqueue(new TextEncoder().encode(makeStopChunk(responseId, outModel)));
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            controller.close();
          },
        });
        return {
          response: new Response(readable, { headers: SSE_HEADERS_NO_BUFFER }),
        };
      }

      return {
        response: new Response(
          JSON.stringify({
            error: {
              message: errMsg,
              status: response.status,
            },
          }),
          { status: response.status, headers: { "Content-Type": "application/json" } }
        ),
      };
    }

    if (stream) {
      const readable = new ReadableStream({
        async start(controller) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let lastSeenLength = 0;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const currentFullText = extractGeminiWebText(buffer);
              if (currentFullText && currentFullText.length > lastSeenLength) {
                const delta = currentFullText.slice(lastSeenLength);
                lastSeenLength = currentFullText.length;
                const chunk = makeTextChunk(responseId, outModel, delta);
                controller.enqueue(new TextEncoder().encode(chunk));
              }
            }

            if (lastSeenLength === 0) {
              const fallbackMsg =
                buffer.includes('"er"') || buffer.includes("SignIn") || buffer.includes("accounts.google")
                  ? "Sesi Gemini Web ditolak oleh Google. Pastikan cookie __Secure-1PSID dan __Secure-1PSIDTS masih aktif (salin via Copy as cURL dari Network tab gemini.google.com)."
                  : "Gemini Web: Tidak ada respons yang dihasilkan oleh model. Periksa cookie __Secure-1PSIDTS pada pengaturan provider.";
              const errChunk = makeTextChunk(responseId, outModel, `\n\n[${fallbackMsg}]\n\n`);
              controller.enqueue(new TextEncoder().encode(errChunk));
            }

            controller.enqueue(new TextEncoder().encode(makeStopChunk(responseId, outModel)));
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            controller.close();
          } catch (streamErr) {
            controller.error(streamErr);
          } finally {
            reader.releaseLock();
          }
        },
      });

      return {
        response: new Response(readable, {
          headers: SSE_HEADERS_NO_BUFFER,
        }),
      };
    }

    const raw = await response.text();
    let fullText = extractGeminiWebText(raw);
    if (!fullText) {
      if (raw.includes('"er"') || raw.includes("SignIn") || raw.includes("accounts.google")) {
        fullText = "[Sesi Gemini Web ditolak oleh Google. Pastikan cookie __Secure-1PSID dan __Secure-1PSIDTS masih aktif.]";
      } else {
        fullText = raw;
      }
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
            content: fullText,
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
