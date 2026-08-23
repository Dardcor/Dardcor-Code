/**
 * GeminiWebExecutor — Gemini Web Session Provider
 *
 * Routes requests through Google Gemini's web interface using browser
 * cookies + Playwright automation. Translates between OpenAI chat
 * completions format and Gemini's web UI.
 *
 * Auth: Cookie-based (__Secure-1PSID + optional __Secure-1PSIDTS from
 * gemini.google.com).
 * Method: Playwright browser automation — dynamically imported ONLY inside
 * execute() so this module loads and verifies on hosts without the
 * `playwright` dependency. Missing Playwright / missing Chromium are
 * surfaced as actionable 503 errors, never as retryable upstream faults.
 *
 * Text chat only: tool calls and image/audio content parts are rejected.
 *
 * Note: Streaming is pseudo-streaming — waits for the full Gemini response
 * then sends it as a single SSE chunk. Gemini's StreamGenerate endpoint
 * returns complete responses, not chunked streams.
 */

import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const GEMINI_URL = "https://gemini.google.com/app";
const DEFAULT_MODEL = "gemini-3.1-pro";

const GEMINI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// Auth cookies that may rotate server-side mid-session (merge on refresh).
const ROTATABLE_COOKIE_NAMES = ["__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC"];

// Cookie attribute names that are not name=value cookie pairs.
const COOKIE_ATTRIBUTES = new Set([
  "path", "domain", "expires", "max-age", "secure", "httponly", "samesite",
]);

/**
 * Whether an error came from Playwright failing to launch because the browser
 * binary is not installed (`chromium.launch: Executable doesn't exist at ...`).
 * This is a host/config problem, not a transient upstream fault, so the
 * executor must NOT surface it as a retryable error.
 */
export function isMissingBrowserExecutable(message) {
  if (!message) return false;
  return /executable doesn't exist|executablenotfound|playwright install|chromium.*download/i.test(
    message
  );
}

// ─── Response shaping helpers ───────────────────────────────────────────────

function errorJson(status, message) {
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error" } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function formatChatCompletion(content, model, finishReason = "stop") {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function formatStreamChunk(content, model, finishReason = null) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  };
}

// ─── Cookie parsing / normalization (authoritative port from OmniRoute) ─────

/**
 * Parse cookie string, stripping attributes (Path, Domain, Expires, etc.)
 * Input: full browser cookie string or just "name=value; name2=value2"
 * Output: array of { name, value } pairs
 */
function parseCookies(raw) {
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) return null;
      const name = part.substring(0, eqIdx).trim();
      const value = part.substring(eqIdx + 1).trim();
      // Skip cookie attributes that aren't name=value pairs
      if (!name || !value) return null;
      if (COOKIE_ATTRIBUTES.has(name.toLowerCase())) return null;
      return { name, value };
    })
    .filter(Boolean);
}

/**
 * Merge rotated __Secure-1PSID* cookies read back from the live Playwright
 * cookie jar into the original cookie string. Only the long-lived Gemini auth
 * cookies are considered — pulling in the entire jar would risk treating
 * short-lived Google analytics/consent cookies as credentials. Cookies the
 * jar didn't return, or that are unchanged, are left untouched.
 */
export function mergeRotatedGeminiCookies(originalCookie, jarCookies) {
  const jarByName = new Map(jarCookies.map((c) => [c.name, c.value]));

  const pairs = parseCookies(originalCookie);
  const seen = new Set();
  const merged = pairs.map(({ name, value }) => {
    seen.add(name);
    if (ROTATABLE_COOKIE_NAMES.includes(name) && jarByName.has(name)) {
      return { name, value: jarByName.get(name) };
    }
    return { name, value };
  });

  for (const name of ROTATABLE_COOKIE_NAMES) {
    if (!seen.has(name) && jarByName.has(name)) {
      merged.push({ name, value: jarByName.get(name) });
    }
  }

  return merged.map(({ name, value }) => `${name}=${value}`).join("; ");
}

function normalizeGeminiCookieInput(raw, cookieName = "__Secure-1PSID") {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.includes("=") ? trimmed : `${cookieName}=${trimmed}`;
}

function readCredentialString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function readProviderSpecificString(providerSpecificData, keys) {
  if (
    !providerSpecificData ||
    typeof providerSpecificData !== "object" ||
    Array.isArray(providerSpecificData)
  ) {
    return "";
  }
  for (const key of keys) {
    const value = readCredentialString(providerSpecificData[key]);
    if (value) return value;
  }
  return "";
}

function resolveGeminiWebCookie(credentials) {
  const directCookie =
    readCredentialString(credentials?.apiKey) ||
    readCredentialString(credentials?.cookie);
  if (directCookie) return normalizeGeminiCookieInput(directCookie);

  const providerSpecificData = credentials?.providerSpecificData;
  const cookie = readProviderSpecificString(providerSpecificData, ["cookie"]);
  if (cookie) return normalizeGeminiCookieInput(cookie);

  const psid = readProviderSpecificString(providerSpecificData, ["__Secure-1PSID"]);
  const psidts = readProviderSpecificString(providerSpecificData, ["__Secure-1PSIDTS"]);
  return [
    psid ? normalizeGeminiCookieInput(psid, "__Secure-1PSID") : "",
    psidts ? normalizeGeminiCookieInput(psidts, "__Secure-1PSIDTS") : "",
  ]
    .filter(Boolean)
    .join("; ");
}

// ─── Prompt building ────────────────────────────────────────────────────────

// Text chat only — flatten a message's content parts to plain text (guaranteed
// text-only by findUnsupportedContent, which rejects earlier).
function contentText(m) {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((c) => c && c.type === "text")
      .map((c) => String(c.text ?? ""))
      .join(" ");
  }
  return "";
}

/**
 * Reject the first unsupported (non-text) content part, or null if all parts
 * are text. gemini-web drives a real browser page — it cannot pass image/audio
 * parts through, and tool calls are unsupported, so anything non-text is a
 * client error rather than a silent drop.
 */
export function findUnsupportedContent(messages) {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part && typeof part === "object" && part.type && part.type !== "text") {
        return `gemini-web is text-only — unsupported content part "${part.type}"`;
      }
    }
  }
  return null;
}

/**
 * Flatten the OpenAI-style multi-turn `messages[]` into the single plain-text
 * prompt typed into the Gemini web UI.
 *
 * gemini-web drives a real browser page and captures only the FIRST
 * `StreamGenerate` response, so it is a stateless, single-turn provider.
 * Single-turn requests are preserved byte-for-byte (only the final user
 * message is returned). Multi-turn requests emit a labeled transcript:
 *
 *   System:
 *   <system text>
 *
 *   Previous conversation:
 *   User: ...
 *   Assistant: ...
 *
 *   Current user message:
 *   <last user message>
 */
export function buildGeminiPrompt(messages) {
  const textMessages = messages
    .filter((m) => contentText(m).trim().length > 0)
    .map((m) => ({ role: m.role, content: contentText(m) }));

  const userMessages = textMessages.filter((m) => m.role === "user");
  const lastUser = userMessages[userMessages.length - 1];
  const lastUserContent = lastUser?.content ?? "";
  const lastUserIdx = lastUser ? textMessages.lastIndexOf(lastUser) : -1;

  // Prior conversation = every user/assistant turn before the final user turn.
  const priorTurns = textMessages.filter(
    (m, i) => i < lastUserIdx && (m.role === "user" || m.role === "assistant")
  );

  // Single-turn (no earlier user/assistant turns): byte-for-byte the original
  // single-message derivation. Do NOT prepend system text here.
  if (priorTurns.length === 0) return lastUserContent;

  const systemText = textMessages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const historyLines = priorTurns.map(
    (m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`
  );

  const parts = [];
  if (systemText) parts.push(`System:\n${systemText}`);
  parts.push(`Previous conversation:\n${historyLines.join("\n\n")}`);
  parts.push(`Current user message:\n${lastUserContent}`);
  return parts.join("\n\n");
}

// ─── StreamGenerate response parser ─────────────────────────────────────────

/**
 * Parse Gemini StreamGenerate response text.
 *
 * Response format:
 *   )]}'
 *   <length>
 *   [["wrb.fr", null, "<JSON string>"]]
 *   <length>
 *   [["wrb.fr", null, "<JSON string>"]]
 *
 * The JSON string contains nested array: inner[4][0][1] = ["text chunks"].
 * Each wrb.fr line is a CUMULATIVE snapshot of the whole answer generated so
 * far (not an independent delta), so we keep only the text from the LAST
 * frame that yields non-empty text instead of concatenating every frame.
 */
export function parseStreamResponse(raw) {
  const lines = raw.split("\n");
  let lastText = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === ")]}'" || /^\d+$/.test(line)) continue;
    if (!line.includes("wrb.fr")) continue;
    try {
      const arr = JSON.parse(line);
      if (!Array.isArray(arr) || !Array.isArray(arr[0]) || arr[0][0] !== "wrb.fr") continue;
      const payload = arr[0]?.[2];
      if (typeof payload !== "string") continue;
      const inner = JSON.parse(payload);
      // Defensive: check each level before accessing
      const responseArray = inner?.[4]?.[0]?.[1];
      if (!Array.isArray(responseArray)) continue;
      const text = responseArray.filter((c) => typeof c === "string").join("");
      if (text) lastText = text;
    } catch {
      // Skip unparseable lines
    }
  }
  return lastText;
}

// ─── Credential probe (no browser, no completion) ───────────────────────────

/**
 * Auth-only probe for the Add-provider "Check token" / saved-connection test
 * flows. gemini-web cannot verify a cookie without a real browser session, so
 * this validates the credential shape: the resolved cookie must contain a
 * non-empty __Secure-1PSID. No completion is generated and Playwright is never
 * imported or launched. Real auth is verified at request time.
 */
export function probeGeminiWebCredential(rawCredential) {
  const cookie = resolveGeminiWebCookie({ apiKey: rawCredential });
  if (!cookie) {
    return {
      status: 0,
      valid: false,
      error: "Missing Gemini cookie — paste __Secure-1PSID from gemini.google.com DevTools → Application → Cookies.",
    };
  }
  const psid = parseCookies(cookie).find((c) => c.name === "__Secure-1PSID");
  if (!psid?.value) {
    return {
      status: 0,
      valid: false,
      error: "Missing __Secure-1PSID cookie — paste it from gemini.google.com DevTools → Application → Cookies.",
    };
  }
  return { status: 200, valid: true, error: null };
}

// ─── Executor ───────────────────────────────────────────────────────────────

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", { id: "gemini-web", baseUrl: GEMINI_URL });
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        response: errorJson(400, "Missing or empty messages array"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Text chat only: reject tool contracts and non-text content parts.
    if (body.tools?.length || body.tool_choice) {
      return {
        response: errorJson(400, "gemini-web is text-only — tool calls are not supported"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }
    const unsupported = findUnsupportedContent(messages);
    if (unsupported) {
      return {
        response: errorJson(400, unsupported),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const cookie = resolveGeminiWebCookie(credentials);
    if (!cookie) {
      return {
        response: errorJson(
          401,
          "Missing Gemini cookie — paste __Secure-1PSID (and optionally __Secure-1PSIDTS) from gemini.google.com."
        ),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const prompt = buildGeminiPrompt(messages);
    if (!prompt) {
      return {
        response: errorJson(400, "No user message found"),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    }

    let browser = null;
    let abortBrowser = null;
    try {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
      }

      // Lazy dependency: only import Playwright inside the execute path so a
      // host without `playwright` installed still loads/verifies this module.
      let chromium;
      try {
        ({ chromium } = await import(/* turbopackOptional: true */ "playwright"));
      } catch {
        return {
          response: errorJson(
            503,
            "Gemini Web requires the `playwright` npm package, which is not installed. " +
              "Run `npm install playwright` then `npx playwright install chromium` on the host " +
              "(or rebuild the Docker image with browsers)."
          ),
          url: GEMINI_URL,
          headers: {},
          transformedBody: body,
        };
      }

      browser = await chromium.launch({ headless: true });
      abortBrowser = () => {
        void browser?.close().catch(() => {});
      };
      signal?.addEventListener("abort", abortBrowser, { once: true });

      const context = await browser.newContext({ userAgent: GEMINI_USER_AGENT });

      // Parse cookies — strips attributes like Path, Domain, Expires
      const cookiePairs = parseCookies(cookie);
      await context.addCookies(
        cookiePairs.map(({ name, value }) => ({
          name,
          value,
          domain: ".google.com",
          path: "/",
          secure: true,
        }))
      );

      const page = await context.newPage();

      // Capture first StreamGenerate response
      let responseText = "";
      let captured = false;
      const responsePromise = new Promise((resolve) => {
        page.on("response", async (resp) => {
          if (captured || !resp.url().includes("StreamGenerate")) return;
          captured = true;
          try {
            responseText = parseStreamResponse(await resp.text());
          } catch {
            /* ignore */
          }
          resolve();
        });
      });

      await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
      }
      await page.waitForTimeout(3000);

      // Type and send message
      const inputEl = await page.waitForSelector(".ql-editor, [contenteditable='true']", {
        timeout: 10000,
      });
      await inputEl.click();
      await page.keyboard.type(prompt, { delay: 10 });
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");

      // Wait for response or timeout
      await Promise.race([responsePromise, page.waitForTimeout(30000)]);
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
      }

      if (!responseText) {
        return {
          response: errorJson(502, "No response from Gemini"),
          url: GEMINI_URL,
          headers: {},
          transformedBody: body,
        };
      }

      // Read rotated __Secure-1PSID* cookies back from the live jar and expose
      // them on the result for the caller to persist if it wants to. The
      // execute contract has no onCredentialsRefreshed callback, so rotation
      // persistence is left to the caller (see mergeRotatedGeminiCookies).
      let rotatedCookie = null;
      try {
        const merged = mergeRotatedGeminiCookies(cookie, await context.cookies());
        if (merged && merged !== cookie) rotatedCookie = merged;
      } catch {
        /* persistence must never fail the response */
      }

      const modelId = model || DEFAULT_MODEL;

      if (stream) {
        // Pseudo-streaming: send complete response as single SSE chunk.
        // Gemini's StreamGenerate returns complete responses, not chunked streams.
        const encoder = new TextEncoder();
        const readable = new ReadableStream(
          {
            start(controller) {
              controller.enqueue(encoder.encode(sseChunk(formatStreamChunk(responseText, modelId))));
              controller.enqueue(encoder.encode(sseChunk(formatStreamChunk("", modelId, "stop"))));
              controller.enqueue(encoder.encode(SSE_DONE));
              controller.close();
            },
          },
          { highWaterMark: 16384 }
        );
        return {
          response: new Response(readable, { status: 200, headers: SSE_HEADERS_NO_BUFFER }),
          url: GEMINI_URL,
          headers: {},
          transformedBody: body,
          rotatedCookie,
        };
      }

      return {
        response: new Response(JSON.stringify(formatChatCompletion(responseText, modelId)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
        rotatedCookie,
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Unknown error";
      // A missing Playwright browser is a host/config problem, not a transient
      // upstream fault — surface an actionable error instead of a retryable 5xx.
      if (isMissingBrowserExecutable(rawMessage)) {
        return {
          response: errorJson(
            503,
            "Gemini Web requires the Playwright Chromium browser, which is not installed. " +
              "Run `npx playwright install chromium` on the host (or rebuild the Docker image with browsers)."
          ),
          url: GEMINI_URL,
          headers: {},
          transformedBody: body,
        };
      }
      log?.error?.("GEMINI-WEB", rawMessage);
      return {
        response: errorJson(500, rawMessage),
        url: GEMINI_URL,
        headers: {},
        transformedBody: body,
      };
    } finally {
      if (abortBrowser) signal?.removeEventListener("abort", abortBrowser);
      // Always close browser to prevent resource leaks
      if (browser) {
        try {
          await browser.close();
        } catch {
          /* ignore close errors */
        }
      }
    }
  }
}

export default GeminiWebExecutor;
