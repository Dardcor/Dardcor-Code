export function createAgentCard(skills, baseUrl) {
  return {
    name: "MiawRouter Local Agent",
    description: "Authenticated, read-only local provider and usage introspection.",
    protocolVersion: "0.3.0",
    version: "1.0.0",
    url: `${baseUrl}/api/a2a`,
    preferredTransport: "JSONRPC",
    additionalInterfaces: [{ url: `${baseUrl}/api/a2a`, transport: "JSONRPC" }],
    capabilities: { streaming: true, pushNotifications: false },
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    security: [{ bearerAuth: [] }],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: skills.map((skill) => ({ ...skill, tags: ["read-only", "local"], inputModes: ["application/json"], outputModes: ["application/json"] })),
  };
}
