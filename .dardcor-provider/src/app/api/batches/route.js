import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { BATCH_LIMITS } from "@/lib/batches/core.js";
import { serializeBatch } from "@/lib/batches/response.js";
import { batchService } from "@/lib/batches/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const unauthorized = () => Response.json({ error: "Local authentication required" }, { status: 403 });
const statusFor = (code) => code === "INPUT_TOO_LARGE" ? 413 : code === "UNSUPPORTED_PROVIDER" ? 422 : code === "QUEUE_FULL" ? 429 : 400;
const MAX_BODY_BYTES = BATCH_LIMITS.maxBytes * 2 + 64 * 1024;

async function readBoundedJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds batch input limit"), { code: "INPUT_TOO_LARGE" });
  if (!request.body?.getReader) return request.json();
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw Object.assign(new Error("Request body exceeds batch input limit"), { code: "INPUT_TOO_LARGE" }); }
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))));
}

export async function GET(request) {
  if (!(await canAccessLocalOnlyRoute(request))) return unauthorized();
  return Response.json({ batches: (await batchService.list()).map(serializeBatch), providers: batchService.providers() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  if (!(await canAccessLocalOnlyRoute(request))) return unauthorized();
  try {
    const body = await readBoundedJson(request);
    const batch = await batchService.create({ provider: body?.provider, input: body?.input });
    return Response.json({ batch: serializeBatch(batch) }, { status: 202 });
  } catch (error) {
    const code = error?.code || "INVALID_REQUEST";
    return Response.json({ error: error?.message || "Invalid batch request", code }, { status: statusFor(code) });
  }
}
