function objectSchema(schema) {
  const normalized = schema && typeof schema === "object" && !Array.isArray(schema)
    ? schema
    : {};
  normalized.type = "object";
  if (!normalized.properties || typeof normalized.properties !== "object" || Array.isArray(normalized.properties)) {
    normalized.properties = {};
  }
  if (Array.isArray(normalized.required)) {
    normalized.required = normalized.required.filter((key) =>
      Object.prototype.hasOwnProperty.call(normalized.properties, key)
    );
    if (normalized.required.length === 0) delete normalized.required;
  }
  return normalized;
}

function normalizeTool(tool) {
  if (!tool || typeof tool !== "object") return;
  if (tool.function && typeof tool.function === "object") {
    tool.function.parameters = objectSchema(tool.function.parameters);
    return;
  }
  if (tool.type === "function" && typeof tool.name === "string") {
    tool.parameters = objectSchema(tool.parameters);
    return;
  }
  if (typeof tool.name === "string" && (!tool.type || Object.prototype.hasOwnProperty.call(tool, "input_schema"))) {
    tool.input_schema = objectSchema(tool.input_schema);
  }
}

function normalizeGroups(groups) {
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (Array.isArray(group?.functionDeclarations)) {
      for (const declaration of group.functionDeclarations) {
        declaration.parameters = objectSchema(declaration.parameters);
      }
    } else {
      normalizeTool(group);
    }
  }
}

export function normalizeToolSchemas(body) {
  if (!body || typeof body !== "object") return body;
  normalizeGroups(body.tools);
  normalizeGroups(body.request?.tools);
  return body;
}
