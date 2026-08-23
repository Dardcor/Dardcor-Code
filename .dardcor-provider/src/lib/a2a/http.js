const MAX_REQUEST_BYTES = 256 * 1024;

const error = (status, code, message, id = null) => Response.json(
  { jsonrpc: "2.0", id, error: { code, message } },
  { status, headers: { "Cache-Control": "no-store" } },
);

export function createA2AHttpHandler({ core, authorize }) {
  return async function handle(request) {
    const auth = await authorize(request);
    if (!auth?.authenticated) return error(401, -32001, "Authentication required");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return error(415, -32600, "Content-Type must be application/json");
    const declared = Number(request.headers.get("content-length") || 0);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_REQUEST_BYTES) return error(413, -32600, "Request body too large");
    let body;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) return error(413, -32600, "Request body too large");
      body = JSON.parse(text);
    } catch { return error(400, -32700, "Parse error"); }

    const result = await core.handle(body, auth);
    if (!result) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
    const wantsStream = body?.method === "message/stream" && request.headers.get("accept")?.includes("text/event-stream") && result.result?.id;
    if (!wantsStream) return Response.json(result, { headers: { "Cache-Control": "no-store" } });

    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        unsubscribe = core.subscribe(result.result.id, (task) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: task })}\n\n`));
          if (["completed", "failed", "canceled"].includes(task.status.state)) { closed = true; controller.close(); }
        });
        if (closed) unsubscribe();
      },
      cancel() { unsubscribe(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  };
}
