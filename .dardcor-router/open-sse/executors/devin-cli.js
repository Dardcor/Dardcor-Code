
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { BaseExecutor } from "./base.js";


function resolveDevinBin() {
  const envBin = process.env.CLI_DEVIN_BIN?.trim();
  if (envBin) return envBin;

  const isWin = process.platform === "win32";
  const home = os.homedir();

  const candidates = isWin
    ? [
      path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "devin", "cli", "bin", "devin.exe"),
      path.join(home, ".local", "bin", "devin.exe"),
      path.join(home, "scoop", "shims", "devin.exe"),
      path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Programs", "devin", "devin.exe"),
    ]
    : [
      path.join(home, ".local", "share", "devin", "bin", "devin"),
      path.join(home, ".devin", "bin", "devin"),
      path.join(home, ".local", "bin", "devin"),
      "/opt/homebrew/bin/devin",
      "/usr/local/bin/devin",
      "/usr/bin/devin",
    ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return isWin ? "devin.exe" : "devin";
}


function rpc(method, params, id) {
  const msg = { jsonrpc: "2.0", method, params };
  if (id !== undefined) msg.id = id;
  return JSON.stringify(msg) + "\n";
}


const CLIENT_TOOLS_MCP_SCRIPT = `
import readline from "node:readline";
const TOOLS = JSON.parse(process.env.DEVIN_MCP_TOOLS || "[]");
const RESULTS = JSON.parse(process.env.DEVIN_MCP_RESULTS || "{}");
const rl = readline.createInterface({ input: process.stdin });
function send(o){ process.stdout.write(JSON.stringify(o) + "\\n"); }
rl.on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") {
    send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "clientTools", version: "1.0" } } });
  } else if (m.method === "tools/list") {
    send({ jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } });
  } else if (m.method === "tools/call") {
    const name = m.params?.name || "";
    const seeded = RESULTS[name];
    const text = seeded !== undefined
      ? String(seeded)
      : "(awaiting client tool_result)";
    process.stderr.write("[client-tools] tool_call name=" + name + " seeded=" + (seeded !== undefined) + "\\n");
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text }] } });
  }
});
`.trimStart();

function ensureClientToolsScript() {
  const scriptPath = path.join(os.tmpdir(), "dardcor-code-devin-client-tools.mjs");
  fs.writeFileSync(scriptPath, CLIENT_TOOLS_MCP_SCRIPT);
  return scriptPath;
}

const MCP_TOOL_PREFIX = "mcp_";
function toMcpToolName(name) {
  return name.startsWith(MCP_TOOL_PREFIX) ? name : MCP_TOOL_PREFIX + name;
}
function fromMcpToolName(name) {
  return name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
}

function buildClientToolsMcp(tools, resultMap) {
  const mcpTools = [];
  for (const t of tools) {
    if (!t) continue;
    const f = t.function || t;
    if (!f?.name) continue;
    mcpTools.push({
      name: toMcpToolName(f.name),
      description: f.description || "",
      inputSchema: f.parameters || f.input_schema || { type: "object", properties: {} },
    });
  }
  if (!mcpTools.length) return null;
  const env = { DEVIN_MCP_TOOLS: JSON.stringify(mcpTools) };
  if (resultMap && Object.keys(resultMap).length) {
    env.DEVIN_MCP_RESULTS = JSON.stringify(resultMap);
  }
  return {
    command: process.execPath,
    args: [ensureClientToolsScript()],
    env,
  };
}

function extractClientToolResults(messages) {
  const idToMcpName = new Map();
  const results = {};
  for (const m of messages) {
    if (m?.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const name = tc?.function?.name || tc?.name;
        if (tc?.id && name) idToMcpName.set(tc.id, toMcpToolName(name));
      }
    }
    if (m?.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b?.type === "tool_use" && b.id && b.name) {
          idToMcpName.set(b.id, toMcpToolName(b.name));
        }
      }
    }
    if (m?.role === "tool" && m.tool_call_id) {
      const mcpName = idToMcpName.get(m.tool_call_id);
      if (mcpName) {
        results[mcpName] =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      }
    }
    if (m?.role === "user" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b?.type === "tool_result" && b.tool_use_id) {
          const mcpName = idToMcpName.get(b.tool_use_id);
          if (mcpName) {
            const c = b.content;
            results[mcpName] =
              typeof c === "string" ? c : JSON.stringify(c ?? "");
          }
        }
      }
    }
  }
  return results;
}

function resolveWorkspaceCwd(body) {
  const candidates = [];
  const push = (v) => {
    if (typeof v === "string" && v.trim()) candidates.push(v.trim());
  };
  push(body?.cwd);
  push(body?.working_directory);
  push(body?.workdir);
  push(body?.workspace);
  push(body?.metadata?.cwd);
  push(body?.metadata?.working_directory);

  const scanText = (text) => {
    if (typeof text !== "string") return;
    for (const m of text.matchAll(/<cwd>\s*([^<]+?)\s*<\/cwd>/gi)) push(m[1]);
  };
  const scanMessages = (msgs) => {
    if (!Array.isArray(msgs)) return;
    for (const msg of msgs) {
      if (!msg) continue;
      if (typeof msg.content === "string") scanText(msg.content);
      else if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          if (typeof p === "string") scanText(p);
          else if (p && typeof p === "object") {
            scanText(p.text);
            scanText(p.input_text);
            scanText(p.content);
          }
        }
      }
      if (typeof msg === "string") scanText(msg);
      if (msg.type === "message" && Array.isArray(msg.content)) {
        for (const p of msg.content) scanText(p?.text || p?.input_text);
      }
    }
  };
  scanMessages(body?.messages);
  scanMessages(body?.input);

  for (const c of candidates) {
    try {
      if (path.isAbsolute(c) && fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        return c;
      }
    } catch {
    }
  }
  return os.tmpdir();
}


function buildPromptText(messages) {
  const lines = [];
  for (const m of messages) {
    const role = String(m.role || "user");
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (!p || typeof p !== "object") continue;
        if (p.type === "text") text += String(p.text || "");
        else if (p.type === "tool_use") {
          text += `\n[Tool call ${p.name} id=${p.id}]\n${JSON.stringify(p.input ?? {})}\n`;
        } else if (p.type === "tool_result") {
          const c =
            typeof p.content === "string" ? p.content : JSON.stringify(p.content ?? "");
          text += `\n[Tool result id=${p.tool_use_id}]\n${c}\n`;
        }
      }
    }
    if (role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const parts = m.tool_calls.map((tc) => {
        const name = tc.function?.name || tc.name || "tool";
        const args = tc.function?.arguments ?? tc.arguments ?? {};
        const argStr = typeof args === "string" ? args : JSON.stringify(args);
        return `[Tool call ${name} id=${tc.id}]\n${argStr}`;
      });
      text = [text, ...parts].filter(Boolean).join("\n\n");
    }
    if (role === "tool") {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      text = `[Tool result id=${m.tool_call_id || ""}]\n${c}`;
    }
    if (!text.trim()) continue;
    if (role === "system") {
      lines.push(`[System]\n${text}`);
    } else if (role === "assistant") {
      lines.push(`[Assistant]\n${text}`);
    } else if (role === "tool") {
      lines.push(`[Tool]\n${text}`);
    } else {
      lines.push(`[User]\n${text}`);
    }
  }
  return lines.join("\n\n") || "(empty)";
}


export class DevinCliExecutor extends BaseExecutor {
  constructor() {
    super("devin-cli", { id: "devin-cli", baseUrl: "devin://acp/stdio" });
  }

  buildUrl() {
    return "devin://acp/stdio";
  }

  buildHeaders() {
    return {};
  }

  transformRequest() {
    return null;
  }

  async execute({ model, body, credentials, signal, log }) {
    const b = body ?? {};
    const messages = Array.isArray(b.messages)
      ? b.messages
      : Array.isArray(b.input)
        ? b.input
        : [];
    const promptText = buildPromptText(messages);
    const workspaceCwd = resolveWorkspaceCwd(b);
    const devinBin = resolveDevinBin();

    log?.info?.(
      "DEVIN",
      `devin acp → model=${model}, bin=${devinBin}, cwd=${workspaceCwd}`
    );

    // NOTE: this replaces the user's global devin MCP config for the subprocess.
    let mcpConfigDir = null;
    const mcpServers = {};
    const mcpJson = process.env.DEVIN_MCP_SERVERS?.trim();
    if (mcpJson) {
      try {
        Object.assign(mcpServers, JSON.parse(mcpJson));
      } catch (e) {
        log?.info?.("DEVIN", `DEVIN_MCP_SERVERS parse failed: ${e.message}`);
      }
    }
    const clientTools = Array.isArray(b.tools) ? b.tools.filter(Boolean) : [];
    const clientToolResults = extractClientToolResults(messages);
    const clientToolsMcp = buildClientToolsMcp(clientTools, clientToolResults);
    const hasClientTools = !!clientToolsMcp;
    if (clientToolsMcp) {
      mcpServers["clientTools"] = clientToolsMcp;
      const seeded = Object.keys(clientToolResults).length;
      log?.info?.(
        "DEVIN",
        `exposing ${clientTools.length} client tool(s) as MCP` +
          (seeded ? ` (seeded ${seeded} result(s))` : "")
      );
    }
    if (Object.keys(mcpServers).length) {
      try {
        mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "devin-mcp-"));
        const cfgDev = path.join(mcpConfigDir, "devin");
        fs.mkdirSync(cfgDev, { recursive: true });
        fs.writeFileSync(
          path.join(cfgDev, "config.json"),
          JSON.stringify({ mcpServers })
        );
        log?.info?.("DEVIN", `mcp config written → ${mcpConfigDir}`);
      } catch (e) {
        log?.info?.("DEVIN", `mcp config write failed: ${e.message}`);
        mcpConfigDir = null;
      }
    }
    const cleanupMcp = () => {
      if (!mcpConfigDir) return;
      try {
        fs.rmSync(mcpConfigDir, { recursive: true, force: true });
      } catch {
      }
      mcpConfigDir = null;
    };

    const sseStream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const emit = (data) => controller.enqueue(enc.encode(data));

        const env = { ...process.env };
        env.DEVIN_PERMISSION_MODE = process.env.DEVIN_PERMISSION_MODE || "bypass";
        if (mcpConfigDir) env.XDG_CONFIG_HOME = mcpConfigDir;

        const agentType = process.env.CLI_DEVIN_AGENT_TYPE?.trim();
        const acpArgs = ["acp"];
        if (agentType) acpArgs.push("--agent-type", agentType);

        const child = spawn(devinBin, acpArgs, {
          env,
          cwd: workspaceCwd,
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        });

        let spawnError = null;
        let stdinClosed = false;

        child.on("error", (err) => {
          spawnError = err;
          const msg =
            err.message.includes("ENOENT") || err.message.includes("not found")
              ? `Devin CLI not found: ${devinBin}. Install via https://cli.devin.ai or set CLI_DEVIN_BIN env var.`
              : `Devin CLI spawn error: ${err.message}`;
          emit(
            `data: ${JSON.stringify({ error: { message: msg, type: "devin_cli_error", code: "spawn_failed" } })}\n\n`
          );
          emit("data: [DONE]\n\n");
          controller.close();
        });

        if (signal) {
          signal.addEventListener("abort", () => {
            if (!child.killed) child.kill("SIGTERM");
          });
        }

        let idCounter = 1;
        let sessionId = null;
        let initDone = false;
        let sessionCreated = false;
        let promptSent = false;
        const responseId = `chatcmpl-devin-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);
        let roleEmitted = false;
        let totalText = "";
        let finished = false;

        const sendRpc = (method, params) => {
          if (stdinClosed || child.stdin.destroyed) return;
          const id = idCounter++;
          try {
            child.stdin.write(rpc(method, params, id));
          } catch {
          }
          return id;
        };

        const emitDelta = (delta) => {
          if (!roleEmitted) {
            emit(
              `data: ${JSON.stringify({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
              })}\n\n`
            );
            roleEmitted = true;
          }
          totalText += delta;
          emit(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
            })}\n\n`
          );
        };

        let toolUseEmitted = false;
        const pendingClientTools = new Map();
        const emitToolUse = (toolName, args, toolCallId) => {
          const argsStr = typeof args === "string" ? args : JSON.stringify(args ?? {});
          if (!roleEmitted) {
            emit(
              `data: ${JSON.stringify({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }],
              })}\n\n`
            );
            roleEmitted = true;
          }
          emit(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: toolCallId,
                        type: "function",
                        function: { name: toolName, arguments: argsStr },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`
          );
        };

        const finish = (error, finishReason = "stop") => {
          if (finished) return;
          finished = true;

          if (error) {
            emit(
              `data: ${JSON.stringify({ error: { message: error, type: "devin_cli_error" } })}\n\n`
            );
          } else {
            emit(
              `data: ${JSON.stringify({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
                usage: {
                  prompt_tokens: Math.ceil(promptText.length / 4),
                  completion_tokens: Math.ceil(totalText.length / 4),
                  total_tokens: Math.ceil((promptText.length + totalText.length) / 4),
                  estimated: true,
                },
              })}\n\n`
            );
          }
          emit("data: [DONE]\n\n");

          try {
            if (!stdinClosed) {
              stdinClosed = true;
              child.stdin.end();
            }
          } catch {
          }

          const killTimer = setTimeout(() => {
            if (!child.killed) child.kill("SIGKILL");
          }, 2000);
          killTimer.unref?.();

          controller.close();
          cleanupMcp();
        };

        let buffer = "";

        child.stdout.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;

            let msg;
            try {
              msg = JSON.parse(line);
            } catch {
              continue;
            }

            if (!initDone && msg.result !== undefined && !msg.method) {
              initDone = true;
              sendRpc("session/new", {
                cwd: workspaceCwd,
                mcpServers: [],
                model: model || undefined,
              });
              continue;
            }

            if (initDone && !sessionCreated && msg.result !== undefined && !msg.method) {
              const res = msg.result || {};
              sessionId = res.sessionId || null;
              if (!sessionId) {
                finish("Devin ACP: session/new returned no sessionId");
                return;
              }
              sessionCreated = true;
              promptSent = true;
              sendRpc("session/prompt", {
                sessionId,
                prompt: [{ type: "text", text: promptText }],
              });
              continue;
            }

            if (sessionCreated && promptSent && msg.result !== undefined && !msg.method) {
              if (!roleEmitted) {
                const res = msg.result || undefined;
                const content = extractResultText(res);
                if (content) {
                  totalText = content;
                  emitDelta(content);
                }
                const stopReason = (res && res.stopReason) || "";
                if (stopReason && stopReason !== "cancelled") {
                  finish();
                  return;
                }
              }
              continue;
            }

            if (msg.method === "session/request_permission" && msg.id !== undefined) {
              const options = msg.params?.options || [];
              const allow =
                options.find((o) => /allow/i.test(String(o.kind || ""))) || options[0];
              if (allow) {
                child.stdin.write(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id: msg.id,
                    result: { outcome: { outcome: "selected", optionId: allow.optionId } },
                  }) + "\n"
                );
              }
              continue;
            }

            if (msg.method === "_cognition.ai/agent_stopped" || msg.method === "$/agent_stopped") {
              const cause = msg.params?.cause;
              if (cause === "error") {
                const errText =
                  msg.params?.errorMessage ||
                  msg.params?.message ||
                  msg.params?.error ||
                  "Devin agent error";
                finish(String(errText));
              } else {
                finish();
              }
              return;
            }

            if (msg.method === "session/update" || msg.method === "$/update") {
              const params = msg.params;
              if (!params) continue;

              const update = params.update || {};
              const type = update.sessionUpdate || params.type;
              const contentField = update.content !== undefined ? update.content : params.content;
              const deltaText =
                typeof contentField === "string"
                  ? contentField
                  : contentField?.text ?? params.delta ?? params.text ?? "";

              if (
                hasClientTools &&
                !toolUseEmitted &&
                (type === "tool_call" || type === "tool_call_update")
              ) {
                const tcId = update.toolCallId;
                if (typeof update.title === "string" && update.title.startsWith("Calling mcp_") && /from clientTools\b/.test(update.title)) {
                  const nameMatch = update.title.match(/^Calling (mcp_\S+)\b/);
                  const mcpName = nameMatch ? nameMatch[1] : "";
                  const origName = fromMcpToolName(mcpName);
                  if (tcId && origName) pendingClientTools.set(tcId, origName);
                }
                const origName = tcId ? pendingClientTools.get(tcId) : null;
                if (origName && update.rawInput) {
                  toolUseEmitted = true;
                  pendingClientTools.delete(tcId);
                  emitToolUse(origName, update.rawInput, tcId || `call_${Date.now()}`);
                  finish(null, "tool_calls");
                  return;
                }
                continue;
              }

              if (type === "agent_message_chunk" || type === "message_delta" || type === "text_delta" || type === "content_delta") {
                if (deltaText) emitDelta(deltaText);
              } else if (type === "agent_thought_chunk") {
              } else if (type === "message_stop" || type === "stop" || type === "done") {
                finish();
                return;
              } else if (type === "error") {
                finish(String(params.message || params.error || "Devin ACP error"));
                return;
              }
              continue;
            }

            if (msg.error) {
              finish(`Devin ACP error ${msg.error.code}: ${msg.error.message}`);
              return;
            }
          }
        });

        child.stderr.on("data", (chunk) => {
          log?.debug?.("DEVIN", `stderr: ${chunk.toString("utf8").slice(0, 200)}`);
        });

        child.on("close", (code) => {
          if (!finished) {
            if (code !== 0 && !spawnError) {
              finish(roleEmitted ? undefined : `Devin CLI exited with code ${code}`);
            } else {
              finish();
            }
          } else {
            cleanupMcp();
          }
        });

        sendRpc("initialize", {
          protocolVersion: "0.3",
          clientInfo: { name: "dardcor-code", version: "1.0" },
          capabilities: {},
        });
      },
    });

    return {
      response: new Response(sseStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }),
      url: "devin://acp/stdio",
      headers: {},
      transformedBody: {
        model,
        cwd: workspaceCwd,
        clientTools: clientTools.map((t) => t?.function?.name || t?.name).filter(Boolean),
        clientToolResults: Object.keys(clientToolResults),
        mcpServers: Object.keys(mcpServers),
        promptLength: Array.isArray(body?.messages)
          ? body.messages.length
          : Array.isArray(body?.input)
            ? body.input.length
            : 0,
      },
    };
  }
}


function extractResultText(result) {
  if (typeof result.content === "string") return result.content;
  if (typeof result.text === "string") return result.text;
  const msg = result.message;
  if (msg && typeof msg.content === "string") return msg.content;
  const msgs = result.messages;
  if (Array.isArray(msgs)) {
    return msgs
      .filter((m) => m.role === "assistant")
      .map((m) => String(m.content || ""))
      .join("\n");
  }
  return "";
}

export default DevinCliExecutor;
