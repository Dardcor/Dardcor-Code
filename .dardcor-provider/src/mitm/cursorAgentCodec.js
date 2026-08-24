const zlib = require("zlib");

const VARINT = 0;
const LEN = 2;
const textDecoder = new TextDecoder();

function readVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buffer.length && shift < 35) {
    const byte = buffer[pos++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, pos];
    shift += 7;
  }
  throw new Error("Invalid protobuf varint");
}

function decodeMessage(buffer) {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const [tag, afterTag] = readVarint(buffer, offset);
    const field = tag >>> 3;
    const wire = tag & 7;
    let value;
    let next = afterTag;
    if (wire === VARINT) {
      [value, next] = readVarint(buffer, next);
    } else if (wire === LEN) {
      const [length, start] = readVarint(buffer, next);
      next = start + length;
      if (next > buffer.length) throw new Error("Invalid protobuf length");
      value = buffer.subarray(start, next);
    } else if (wire === 1) {
      next += 8;
      value = buffer.subarray(afterTag, next);
    } else if (wire === 5) {
      next += 4;
      value = buffer.subarray(afterTag, next);
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
    if (next > buffer.length || field === 0) throw new Error("Invalid protobuf field");
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push({ wire, value });
    offset = next;
  }
  return fields;
}

function encodeVarint(value) {
  const bytes = [];
  let current = value >>> 0;
  while (current >= 0x80) {
    bytes.push((current & 0x7f) | 0x80);
    current >>>= 7;
  }
  bytes.push(current);
  return Buffer.from(bytes);
}

function encodeField(field, wire, value) {
  const tag = encodeVarint((field << 3) | wire);
  if (wire === VARINT) return Buffer.concat([tag, encodeVarint(value)]);
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value || "");
  return Buffer.concat([tag, encodeVarint(data.length), data]);
}

function encodeFixed64Field(field, value) {
  const data = Buffer.alloc(8);
  data.writeDoubleLE(value);
  return Buffer.concat([encodeVarint((field << 3) | 1), data]);
}

function encodeAgentStruct(value) {
  return Buffer.concat(Object.entries(value).map(([key, item]) => {
    const entry = Buffer.concat([
      encodeField(1, LEN, key),
      encodeField(2, LEN, encodeAgentValue(item)),
    ]);
    return encodeField(1, LEN, entry);
  }));
}

function encodeAgentValue(value) {
  if (value === null || value === undefined) return encodeField(1, VARINT, 0);
  if (typeof value === "number") return encodeFixed64Field(2, value);
  if (typeof value === "string") return encodeField(3, LEN, value);
  if (typeof value === "boolean") return encodeField(4, VARINT, value ? 1 : 0);
  if (Array.isArray(value)) {
    const list = Buffer.concat(value.map((item) => encodeField(1, LEN, encodeAgentValue(item))));
    return encodeField(6, LEN, list);
  }
  return encodeField(5, LEN, encodeAgentStruct(value));
}

function wrapFrame(payload, flags = 0) {
  const data = Buffer.from(payload);
  const frame = Buffer.alloc(5 + data.length);
  frame[0] = flags;
  frame.writeUInt32BE(data.length, 1);
  data.copy(frame, 5);
  return frame;
}

function parseFirstFrame(buffer) {
  if (!buffer || buffer.length < 5) return null;
  const flags = buffer[0];
  const length = buffer.readUInt32BE(1);
  if (buffer.length < 5 + length) return null;
  let payload = buffer.subarray(5, 5 + length);
  if (flags & 1) payload = zlib.gunzipSync(payload);
  return { flags, payload, consumed: 5 + length };
}

function first(fields, field) {
  return fields.get(field)?.[0]?.value;
}

function stringField(fields, field) {
  const value = first(fields, field);
  return value ? textDecoder.decode(value) : "";
}

function decodeAgentStruct(buffer) {
  const result = {};
  const fields = decodeMessage(buffer);
  for (const item of fields.get(1) || []) {
    const entry = decodeMessage(item.value);
    const key = stringField(entry, 1);
    const value = first(entry, 2);
    if (key && value) result[key] = decodeAgentValue(value);
  }
  return result;
}

function decodeAgentValue(buffer) {
  const fields = decodeMessage(buffer);
  if (fields.has(1)) return null;
  if (fields.has(2)) return Buffer.from(first(fields, 2)).readDoubleLE();
  if (fields.has(3)) return stringField(fields, 3);
  if (fields.has(4)) return Boolean(first(fields, 4));
  if (fields.has(5)) return decodeAgentStruct(first(fields, 5));
  if (fields.has(6)) {
    const list = decodeMessage(first(fields, 6));
    return (list.get(1) || []).map((item) => decodeAgentValue(item.value));
  }
  return null;
}

function decodeHistory(userAction) {
  const historyBytes = first(userAction, 7);
  if (!historyBytes) return [];
  const history = decodeMessage(historyBytes);
  const messages = [];
  for (const item of history.get(1) || []) {
    const entry = decodeMessage(item.value);
    const assistant = first(entry, 2);
    const user = first(entry, 1);
    const roleBytes = assistant || user;
    if (!roleBytes) continue;
    const roleMessage = decodeMessage(roleBytes);
    const contentBytes = first(roleMessage, 1);
    if (!contentBytes) continue;
    const contentMessage = decodeMessage(contentBytes);
    const content = stringField(contentMessage, 1);
    if (content) messages.push({ role: assistant ? "assistant" : "user", content });
  }
  return messages;
}

function hasFastParameter(requestedModel) {
  for (const item of requestedModel.get(3) || []) {
    try {
      const parameter = decodeMessage(item.value);
      if (stringField(parameter, 1) === "fast" && stringField(parameter, 2) === "true") return true;
    } catch {
      continue;
    }
  }
  return false;
}

function hasMcpTools(run) {
  for (const item of run.get(4) || []) {
    if (!item.value?.length) continue;
    try {
      if ((decodeMessage(item.value).get(1) || []).length > 0) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function decodeMcpToolDefinition(buffer) {
  const definition = decodeMessage(buffer);
  const name = stringField(definition, 1);
  if (!name) return null;
  let parameters = { type: "object", properties: {} };
  const schema = first(definition, 3);
  if (schema) {
    const decoded = decodeAgentValue(schema);
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) parameters = decoded;
  } else {
    const schemaJson = stringField(definition, 6);
    if (schemaJson) {
      try {
        const decoded = JSON.parse(schemaJson);
        if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) parameters = decoded;
      } catch {
        parameters = { type: "object", properties: {} };
      }
    }
  }
  return {
    name,
    description: stringField(definition, 2),
    parameters,
    providerIdentifier: stringField(definition, 4),
    toolName: stringField(definition, 5) || name,
  };
}

function decodeMcpTools(run, userAction) {
  const definitions = [];
  const wrapper = first(run, 4);
  if (wrapper) {
    const tools = decodeMessage(wrapper);
    for (const item of tools.get(1) || []) definitions.push(item.value);
  }
  const requestContextBytes = first(userAction, 2);
  if (requestContextBytes) {
    const requestContext = decodeMessage(requestContextBytes);
    for (const item of requestContext.get(7) || []) definitions.push(item.value);
  }

  const unique = new Map();
  for (const bytes of definitions) {
    try {
      const tool = decodeMcpToolDefinition(bytes);
      if (tool) unique.set(tool.name, tool);
    } catch {
      continue;
    }
  }
  return [...unique.values()];
}

function normalizeModel(model, fast) {
  const value = String(model || "").replace(/^models\//, "");
  if (value === "auto") return "default";
  if (value === "composer-2.5[fast=true]" || value === "composer-2.5" && fast) return "composer-2.5-fast";
  return value;
}

function decodeRunRequest(payload) {
  try {
    const client = decodeMessage(payload);
    const runBytes = first(client, 1);
    if (!runBytes) return null;
    const run = decodeMessage(runBytes);
    const requestedModelBytes = first(run, 9);
    const actionBytes = first(run, 2);
    if (!requestedModelBytes || !actionBytes) return null;

    const requestedModel = decodeMessage(requestedModelBytes);
    const conversationAction = decodeMessage(actionBytes);
    const userActionBytes = first(conversationAction, 1);
    if (!userActionBytes) return null;
    const userAction = decodeMessage(userActionBytes);
    const userMessageBytes = first(userAction, 1);
    if (!userMessageBytes) return null;
    const userMessage = decodeMessage(userMessageBytes);

    const model = normalizeModel(stringField(requestedModel, 1), hasFastParameter(requestedModel));
    const text = stringField(userMessage, 1);
    if (!model || !text) return null;
    const toolDefinitions = decodeMcpTools(run, userAction);
    return {
      model,
      text,
      system: stringField(run, 8),
      history: decodeHistory(userAction),
      hasTools: hasMcpTools(run),
      tools: toolDefinitions.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          parameters: tool.parameters,
        },
      })),
      toolDefinitions,
    };
  } catch {
    return null;
  }
}

function buildTextUpdate(text) {
  const textPart = encodeField(1, LEN, Buffer.from(text));
  const update = encodeField(1, LEN, textPart);
  return wrapFrame(encodeField(1, LEN, update));
}

function buildTurnEnd() {
  return wrapFrame(encodeField(1, LEN, encodeField(14, LEN, Buffer.alloc(0))));
}

function encodeMcpArgs(tool, callId, args) {
  const entries = Object.entries(args || {}).map(([key, value]) => {
    const entry = Buffer.concat([
      encodeField(1, LEN, key),
      encodeField(2, LEN, encodeAgentValue(value)),
    ]);
    return encodeField(2, LEN, entry);
  });
  const provider = tool.providerIdentifier || "";
  const toolName = tool.toolName || tool.name;
  return Buffer.concat([
    encodeField(1, LEN, provider ? `${provider}-${toolName}` : toolName),
    ...entries,
    encodeField(3, LEN, callId),
    ...(provider ? [encodeField(4, LEN, provider)] : []),
    encodeField(5, LEN, toolName),
    ...(provider ? [encodeField(9, LEN, provider)] : []),
  ]);
}

function buildMcpToolCall(tool, callId, args, result) {
  const mcpToolCall = Buffer.concat([
    encodeField(1, LEN, encodeMcpArgs(tool, callId, args)),
    ...(result ? [encodeField(2, LEN, result)] : []),
  ]);
  return Buffer.concat([
    encodeField(15, LEN, mcpToolCall),
    encodeField(57, LEN, callId),
  ]);
}

function buildToolUpdate(field, tool, callId, args, result) {
  const update = Buffer.concat([
    encodeField(1, LEN, callId),
    encodeField(2, LEN, buildMcpToolCall(tool, callId, args, result)),
  ]);
  return wrapFrame(encodeField(1, LEN, encodeField(field, LEN, update)));
}

function buildMcpToolStarted(tool, callId, args) {
  return buildToolUpdate(2, tool, callId, args);
}

function buildMcpToolCompleted(tool, callId, args, result) {
  return buildToolUpdate(3, tool, callId, args, result);
}

function buildMcpExecRequest(id, execId, tool, callId, args) {
  const request = Buffer.concat([
    encodeField(1, VARINT, id),
    encodeField(15, LEN, execId),
    encodeField(11, LEN, encodeMcpArgs(tool, callId, args)),
  ]);
  return wrapFrame(encodeField(2, LEN, request));
}

function decodeMcpResult(resultBytes) {
  const result = decodeMessage(resultBytes);
  const successBytes = first(result, 1);
  if (successBytes) {
    const success = decodeMessage(successBytes);
    const content = [];
    for (const itemBytes of success.get(1) || []) {
      const item = decodeMessage(itemBytes.value);
      const textBytes = first(item, 1);
      if (textBytes) content.push(stringField(decodeMessage(textBytes), 1));
      const imageBytes = first(item, 2);
      if (imageBytes) {
        const image = decodeMessage(imageBytes);
        content.push(`[image: ${stringField(image, 2) || "application/octet-stream"}]`);
      }
    }
    const structured = first(success, 3);
    if (structured) content.push(JSON.stringify(decodeAgentStruct(structured)));
    return {
      content: content.filter(Boolean).join("\n") || "Tool completed successfully.",
      isError: Boolean(first(success, 2)),
      displayResult: resultBytes,
    };
  }

  for (const field of [2, 3, 4, 5, 6]) {
    const errorBytes = first(result, field);
    if (!errorBytes) continue;
    const error = decodeMessage(errorBytes);
    const message = stringField(error, 1) || "Cursor tool execution failed";
    const displayResult = field <= 4
      ? resultBytes
      : encodeField(2, LEN, encodeField(1, LEN, message));
    return { content: message, isError: true, displayResult };
  }
  return { content: "Cursor tool returned an empty result.", isError: false, displayResult: resultBytes };
}

function decodeMcpExecResult(payload, expectedId) {
  try {
    const client = decodeMessage(payload);
    const execBytes = first(client, 2);
    if (!execBytes) return null;
    const exec = decodeMessage(execBytes);
    if (first(exec, 1) !== expectedId) return null;
    const result = first(exec, 11);
    return result ? decodeMcpResult(result) : null;
  } catch {
    return null;
  }
}

function buildRequestContextRequest() {
  return wrapFrame(encodeField(2, LEN, encodeField(10, LEN, Buffer.alloc(0))));
}

function isRequestContextResponse(payload) {
  try {
    const client = decodeMessage(payload);
    const execBytes = first(client, 2);
    return execBytes ? decodeMessage(execBytes).has(10) : false;
  } catch {
    return false;
  }
}

function buildSuccessTrailer() {
  return wrapFrame(Buffer.from("{}"), 2);
}

function buildErrorTrailer() {
  return wrapFrame(Buffer.from(JSON.stringify({
    error: { code: "internal", message: "Dardcor Code routing failed" },
  })), 2);
}

module.exports = {
  parseFirstFrame,
  decodeRunRequest,
  decodeAgentValue,
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
};
