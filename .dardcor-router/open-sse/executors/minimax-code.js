import { DefaultExecutor } from "./default.js";
import { refreshMiniMaxCodeToken } from "../services/tokenRefresh.js";

const QUOTA_RE = /insufficient|balance|credit|quota|exhaust|limit|余额|积分|额度|不足|用完|上限/i;

export async function normalizeQuotaResponse(response) {
  const status = response?.status;
  if (!response || (status !== 402 && status !== 403 && status !== 429)) return response;

  const text = await response.text().catch(() => "");
  if (status === 429 || !QUOTA_RE.test(text)) {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(text, { status, statusText: response.statusText, headers });
  }

  let msg = text.trim();
  try {
    const v = JSON.parse(text);
    msg = v?.error?.message ?? v?.message ?? v?.msg ?? v?.base_resp?.status_msg ?? msg;
  } catch { }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: `usage limit reached: ${msg}` } }),
    { status: 429, statusText: "Too Many Requests", headers }
  );
}

export class MinimaxCodeExecutor extends DefaultExecutor {
  async execute(args) {
    const result = await super.execute(args);
    if (!result?.response) return result;
    return { ...result, response: await normalizeQuotaResponse(result.response) };
  }

  async refreshCredentials(credentials, log) {
    if (!credentials?.refreshToken) return null;
    return refreshMiniMaxCodeToken(this.provider, credentials.refreshToken, log);
  }
}
