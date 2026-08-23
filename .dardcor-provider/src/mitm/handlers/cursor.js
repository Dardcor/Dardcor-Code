const { getMitmAlias } = require("../dbReader");
const { fetchRouter } = require("./base");
const { log, err } = require("../logger");
const crypto = require("crypto");
const {
  parseFirstFrame,
  decodeRunRequest,
  buildTextUpdate,
  buildTurnEnd,
  buildMcpToolStarted,
  buildMcpToolCompleted,
  buildMcpExecRequest,
  decodeMcpExecResult,
  buildRequestContextRequest,
  isRequestContextResponse,
  buildSuccessTrailer,
  buildErrorTrailer,
} = require("../cursorAgentCodec");

const FIRST_FRAME_LIMIT = 1024 * 1024;
const FIRST_FRAME_TIMEOUT_MS = 10000;
const CONTEXT_RESPONSE_TIMEOUT_MS = 3000;
const TOOL_RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TOOL_ROUNDS = 32;

function readFirstFrame(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", finish);
      req.off("error", finish);
      req.pause();
      resolve(Buffer.concat(chunks));
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= 5) {
        const buffered = Buffer.concat(chunks);
        const expected = 5 + buffered.readUInt32BE(1);
        if (expected > FIRST_FRAME_LIMIT || size >= expected) finish();
      }
    };
    const timer = setTimeout(finish, FIRST_FRAME_TIMEOUT_MS);
    req.on("data", onData);
    req.once("end", finish);
    req.once("error", finish);
  });
}

function mappedModel(model) {
  try {
    const aliases = getMitmAlias("cursor");
    return aliases?.[model]
      || (model === "composer-2.5" ? aliases?.["composer-2.5-fast"] : null)
      || null;
  } catch {
    return null;
  }
}

function parseSseData(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function writeConnectHeaders(res) {
  if (res.headersSent) return;
  res.writeHead(200, {
    "Content-Type": "application/connect+proto",
    "Cache-Control": "no-cache",
    "connect-protocol-version": "1",
  });
}

function waitForClientFrame(req, predicate, timeoutMs) {
  return new Promise((resolve) => {
    let pending = Buffer.alloc(0);
    let settled = false;
    const finish = (received) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onEnd);
      resolve(received);
    };
    const onEnd = () => finish(false);
    const onData = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 5) {
        const frame = parseFirstFrame(pending);
        if (!frame) break;
        pending = pending.subarray(frame.consumed);
        const result = predicate(frame.payload);
        if (result) return finish(result);
      }
      if (pending.length > FIRST_FRAME_LIMIT) finish(false);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onEnd);
    req.resume();
  });
}

function waitForRequestContextResponse(req) {
  return waitForClientFrame(req, isRequestContextResponse, CONTEXT_RESPONSE_TIMEOUT_MS);
}

async function consumeRouterResponse(routerRes, res) {
  if (!routerRes.ok || !routerRes.body) {
    throw new Error(await routerRes.text().catch(() => "Cursor routing failed"));
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const parsed = parseSseData(data);
      if (parsed?.error) throw new Error(parsed.error.message || "Cursor routing failed");
      const content = parsed?.choices?.[0]?.delta?.content;
      if (content) res.write(buildTextUpdate(content));
      for (const call of parsed?.choices?.[0]?.delta?.tool_calls || []) {
        const index = call.index ?? toolCalls.size;
        const current = toolCalls.get(index) || {
          id: call.id || "",
          type: "function",
          function: { name: "", arguments: "" },
        };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.function.name = call.function.name;
        if (call.function?.arguments) current.function.arguments += call.function.arguments;
        toolCalls.set(index, current);
      }
    }
  }
  return [...toolCalls.values()];
}

function parseToolArguments(call) {
  try {
    const value = JSON.parse(call.function.arguments || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function routeAgent(req, res, decoded, mapped, routerRes) {
  const messages = [
    ...(decoded.system ? [{ role: "system", content: decoded.system }] : []),
    ...decoded.history,
    { role: "user", content: decoded.text },
  ];
  const definitions = new Map(decoded.toolDefinitions.map((tool) => [tool.name, tool]));
  let nextResponse = routerRes;
  let execId = 1;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const toolCalls = await consumeRouterResponse(nextResponse, res);
    if (toolCalls.length === 0) {
      res.write(buildTurnEnd());
      res.end(buildSuccessTrailer());
      return;
    }

    messages.push({ role: "assistant", content: null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      const tool = definitions.get(call.function.name);
      if (!tool) throw new Error(`Unknown Cursor tool: ${call.function.name}`);
      const callId = call.id || crypto.randomUUID();
      call.id = callId;
      const args = parseToolArguments(call);
      const id = execId++;
      const executionId = crypto.randomUUID();
      const resultPromise = waitForClientFrame(
        req,
        (payload) => decodeMcpExecResult(payload, id),
        TOOL_RESPONSE_TIMEOUT_MS,
      );
      res.write(buildMcpToolStarted(tool, callId, args));
      res.write(buildMcpExecRequest(id, executionId, tool, callId, args));
      const result = await resultPromise;
      if (!result) throw new Error(`Cursor tool timed out: ${call.function.name}`);
      res.write(buildMcpToolCompleted(tool, callId, args, result.displayResult));
      messages.push({
        role: "tool",
        tool_call_id: callId,
        name: call.function.name,
        content: result.content,
      });
    }

    nextResponse = await fetchRouter({
      model: mapped,
      messages,
      tools: decoded.tools,
      stream: true,
    }, "/v1/chat/completions", req.headers);
  }
  throw new Error(`Cursor tool loop exceeded ${MAX_TOOL_ROUNDS} rounds`);
}

async function interceptAgent(req, res, relay) {
  let initialData = null;
  try {
    initialData = await readFirstFrame(req);
    const frame = parseFirstFrame(initialData);
    const decoded = frame ? decodeRunRequest(frame.payload) : null;
    const mapped = decoded ? mappedModel(decoded.model) : null;

    // Unknown, unmapped, or non-MCP tool requests retain Cursor's native
    // full-duplex behavior byte-for-byte.
    if (!frame || !decoded || !mapped || (decoded.hasTools && decoded.tools.length === 0)) return relay(initialData);

    const messages = [
      ...(decoded.system ? [{ role: "system", content: decoded.system }] : []),
      ...decoded.history,
      { role: "user", content: decoded.text },
    ];
    const routerRes = await fetchRouter({
      model: mapped,
      messages,
      ...(decoded.tools.length ? { tools: decoded.tools } : {}),
      stream: true,
    }, "/v1/chat/completions", req.headers);
    if (!routerRes.ok || !routerRes.body) return relay(initialData);
    writeConnectHeaders(res);
    res.write(buildRequestContextRequest());
    const contextReceived = await waitForRequestContextResponse(req);
    if (!contextReceived) log("[cursor] request_context response timed out; continuing text route");
    log(`[cursor] routed ${decoded.model} -> ${mapped}`);
    return routeAgent(req, res, decoded, mapped, routerRes);
  } catch (error) {
    err(`[cursor] routing failed: ${error.message}`);
    if (initialData && !res.headersSent) return relay(initialData);
    if (!res.writableEnded) res.end(buildErrorTrailer());
  }
}

async function intercept(req, res, bodyBuffer, mappedModel, passthrough) {
  return passthrough(req, res, bodyBuffer);
}

module.exports = { intercept, interceptAgent };
