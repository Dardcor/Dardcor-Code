import { DefaultExecutor } from "./default.js";
import { resolveXiaomiTokenplanBaseUrl } from "../config/providers.js";

export class XiaomiTokenplanExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-tokenplan");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrl = resolveXiaomiTokenplanBaseUrl(credentials);
    if (credentials?.runtimeTransport?.format === "claude") {
      return `${baseUrl.replace(/\/v1\/?$/, "")}/anthropic/v1/messages`;
    }
    return `${baseUrl}/chat/completions`;
  }
}
