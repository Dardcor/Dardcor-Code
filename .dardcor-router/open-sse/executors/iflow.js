import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

export class IFlowExecutor extends BaseExecutor {
  constructor() {
    super("iflow", PROVIDERS.iflow);
  }

  generateUUID() {
    return crypto.randomUUID();
  }

  createIFlowSignature(userAgent, sessionID, timestamp, apiKey) {
    if (!apiKey) return "";
    const payload = `${userAgent}:${sessionID}:${timestamp}`;
    const hmac = crypto.createHmac("sha256", apiKey);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  buildHeaders(credentials, stream = true) {
    const sessionID = `session-${this.generateUUID()}`;
    const timestamp = Date.now();

    const userAgent = this.config.headers["User-Agent"] || "iFlow-Cli";

    const apiKey = credentials.apiKey || credentials.accessToken || "";

    const signature = this.createIFlowSignature(userAgent, sessionID, timestamp, apiKey);

    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers,
      "session-id": sessionID,
      "x-iflow-timestamp": timestamp.toString(),
      "x-iflow-signature": signature
    };

    if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return this.config.baseUrl;
  }

  transformRequest(model, body, stream, credentials) {
    if (stream && body.messages && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
    return body;
  }
}

export default IFlowExecutor;
