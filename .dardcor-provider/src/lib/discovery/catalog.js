const endpoints = [
  ["chat-completions", "POST", "/api/v1/chat/completions", "llm", "public-api-key", "OpenAI-compatible chat completions", "OpenAI-compatible chat completion requests."],
  ["responses", "POST", "/api/v1/responses", "llm", "public-api-key", "OpenAI Responses API", "OpenAI-compatible response generation."],
  ["models", "GET", "/api/v1/models", "discovery", "public-api-key", "Model listing", "List models available through the router."],
  ["embeddings", "POST", "/api/v1/embeddings", "media", "public-api-key", "Embeddings", "Create vector embeddings."],
  ["images-generations", "POST", "/api/v1/images/generations", "media", "public-api-key", "Image generation", "Generate images from text prompts."],
  ["audio-speech", "POST", "/api/v1/audio/speech", "media", "public-api-key", "Text to speech", "Generate speech audio from text."],
  ["audio-transcriptions", "POST", "/api/v1/audio/transcriptions", "media", "public-api-key", "Speech transcription", "Transcribe uploaded audio."],
  ["messages", "POST", "/api/v1/messages", "llm", "public-api-key", "Anthropic Messages API", "Anthropic-compatible message generation."],
  ["search", "POST", "/api/v1/search", "web", "public-api-key", "Web search", "Search the web through a configured provider."],
  ["web-fetch", "POST", "/api/v1/web/fetch", "web", "public-api-key", "Web fetch", "Fetch web content through a configured provider."],
  ["gemini-models", "GET", "/api/v1beta/models", "llm", "public-api-key", "Gemini-compatible models", "List models through the Gemini-compatible API."],
  ["mcp", "POST", "/api/mcp", "agent-protocol", "local-only", "MCP tools", "Sessionless MCP Streamable HTTP endpoint."],
  ["a2a", "POST", "/api/a2a", "agent-protocol", "local-only", "A2A skills", "Authenticated A2A JSON-RPC endpoint."],
  ["webhooks", "GET", "/api/webhooks", "automation", "local-only", "Webhook management", "Manage local webhook subscriptions."],
  ["batches", "GET", "/api/batches", "automation", "local-only", "Batch jobs", "List and manage local batch jobs."],
  ["agents", "GET", "/api/agents", "agents", "local-only", "Agent integrations", "List locally detected agent integrations."],
];

export const API_ENDPOINT_CATALOG = Object.freeze(endpoints.map(([
  id, method, path, category, auth, capability, description,
]) => Object.freeze({ id, method, path, category, auth, capability, status: "available", description })));
