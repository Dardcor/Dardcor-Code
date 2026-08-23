const MAX_REQUEST_BYTES = 1024 * 1024;

function jsonError(status, code, message, id = null) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

export function createMcpHttpHandler({ core, authorize }) {
  return async function handle(request) {
    const auth = await authorize(request);
    if (!auth?.authenticated) return jsonError(401, -32001, "Authentication required");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return jsonError(415, -32600, "Content-Type must be application/json");
    }
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > MAX_REQUEST_BYTES) return jsonError(413, -32600, "Request body too large");

    let body;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) return jsonError(413, -32600, "Request body too large");
      body = JSON.parse(text);
    } catch {
      return jsonError(400, -32700, "Parse error");
    }

    const result = await core.handle(body, auth);
    if (!result) return new Response(null, { status: 202 });
    const headers = { "MCP-Protocol-Version": "2025-06-18", "Cache-Control": "no-store" };
    if (request.headers.get("accept")?.includes("text/event-stream")) {
      return new Response(`event: message\ndata: ${JSON.stringify(result)}\n\n`, {
        status: 200,
        headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" },
      });
    }
    return Response.json(result, { headers });
  };
}
