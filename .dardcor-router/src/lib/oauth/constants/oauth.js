/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { platform, arch } from "os";
import { ANTIGRAVITY_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } from "open-sse/providers/shared.js";
import { PROVIDER_OAUTH, PROVIDERS as REGISTRY_PROVIDERS } from "open-sse/providers/index.js";

function getOAuthPlatformEnum() {
  const os = platform();
  const architecture = arch();
  if (os === "darwin") return architecture === "arm64" ? 2 : 1;
  if (os === "linux") return architecture === "arm64" ? 4 : 3;
  if (os === "win32") return 5;
  return 0;
}

export const CLAUDE_CONFIG = { ...PROVIDER_OAUTH["claude"] };

export const CODEX_CONFIG = { ...PROVIDER_OAUTH["codex"] };

export const GEMINI_CONFIG = { ...GOOGLE_OAUTH_CLIENT, ...PROVIDER_OAUTH["gemini-cli"] };

export const QODER_CONFIG = { ...PROVIDER_OAUTH["qoder"] };

export const IFLOW_CONFIG = { ...PROVIDER_OAUTH["iflow"] };

export const ANTIGRAVITY_CONFIG = {
  ...ANTIGRAVITY_OAUTH_CLIENT,
  ...PROVIDER_OAUTH["antigravity"],
  loadCodeAssistClientMetadata: JSON.stringify({ ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 }),
};

export function getOAuthClientMetadata() {
  return { ideType: 9, platform: getOAuthPlatformEnum(), pluginType: 2 };
}

export const OPENAI_CONFIG = { ...PROVIDER_OAUTH["openai"] };

export const GITHUB_CONFIG = { ...PROVIDER_OAUTH["github"] };

export const OPENCODE_CONFIG = {
  ...PROVIDER_OAUTH["opencode"],
  deviceCodeUrl: PROVIDER_OAUTH["opencode"]?.deviceCodeUrl || "https://opencode.ai/console/auth/device/code",
  tokenUrl: PROVIDER_OAUTH["opencode"]?.tokenUrl || "https://opencode.ai/console/auth/device/token",
  refreshUrl: PROVIDER_OAUTH["opencode"]?.refreshUrl || "https://opencode.ai/console/auth/device/token",
  userUrl: PROVIDER_OAUTH["opencode"]?.userUrl || "https://opencode.ai/console/api/user",
  clientId: PROVIDER_OAUTH["opencode"]?.clientId || "opencode-cli",
};


export const KIRO_CONFIG = { ...PROVIDER_OAUTH["kiro"] };

export const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;

export function assertValidAwsRegion(region) {
  if (typeof region !== "string" || !AWS_REGION_PATTERN.test(region)) {
    throw new Error("Invalid region");
  }
  return region;
}

export const CURSOR_CONFIG = {
  ...PROVIDER_OAUTH["cursor"],
  tokenStoragePaths: {
    linux: "~/.config/Cursor/User/globalStorage/state.vscdb",
    macos: "/Users/<user>/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    windows: "%APPDATA%\\Cursor\\User\\globalStorage\\state.vscdb",
  },
};

export const KIMI_CONFIG = {
  ...PROVIDER_OAUTH["kimi"],
  clientId:
    process.env.KIMI_CODING_OAUTH_CLIENT_ID ||
    process.env.KIMI_OAUTH_CLIENT_ID ||
    REGISTRY_PROVIDERS["kimi"]?.clientId ||
    PROVIDER_OAUTH["kimi"]?.clientId,
};
export const KIMI_CODING_CONFIG = KIMI_CONFIG;

export const KILOCODE_CONFIG = { ...PROVIDER_OAUTH["kilocode"] };

export const CLINE_CONFIG = { ...PROVIDER_OAUTH["cline"] };

export const CLINEPASS_CONFIG = { ...PROVIDER_OAUTH["clinepass"] };

export const GITLAB_CONFIG = { ...PROVIDER_OAUTH["gitlab"] };

export const CODEBUDDY_CONFIG = { ...PROVIDER_OAUTH["codebuddy-cn"] };

export const CODEBUDDY_INTL_CONFIG = { ...PROVIDER_OAUTH["codebuddy-intl"] };

export const KIMCHI_CONFIG = { ...PROVIDER_OAUTH["kimchi"] };

export const GROK_CLI_CONFIG = { ...PROVIDER_OAUTH["grok-cli"] };

export const XIAOMI_MIMO_CONFIG = {
  platformUrl: process.env.MIMO_PLATFORM_URL || "https://platform.xiaomimimo.com",
  defaultBaseUrl: "https://api.xiaomimimo.com/v1",
  kn: "mimocode",
  callbackPath: "/",
  timeoutMs: 300000,
};

export const TRAE_CONFIG = {
  clientId: "ono9krqynydwx5",
  clientSecret: "-",
  loginGuidanceUrls: [
    "https://api.marscode.com/cloudide/api/v3/trae/GetLoginGuidance",
    "https://api.trae.ai/cloudide/api/v3/trae/GetLoginGuidance",
    "https://www.trae.ai/cloudide/api/v3/trae/GetLoginGuidance",
  ],
  apiOrigins: [
    "https://api.marscode.com",
    "https://api.trae.ai",
    "https://www.trae.ai",
    "https://www.marscode.com",
  ],
  exchangeTokenPath: "/cloudide/api/v3/trae/oauth/ExchangeToken",
  getUserInfoPath: "/cloudide/api/v3/trae/GetUserInfo",
  authorizationPath: "/authorization",
  callbackPath: "/callback",
  minAppVersion: "3.5.54",
  defaultAppVersion: "3.5.54",
  defaultAppType: "stable",
  defaultPluginVersion: "local",
  defaultDeviceId: "0",
  userAgent: "Trae/1.0.0 antigravity-cockpit-tools",
  webUrl: "https://www.trae.ai",
  authScheme: "Cloud-IDE-JWT",
  tokenLifetimeDays: 14,
  oauthTimeoutMs: 600_000,
};

export const WINDSURF_CONFIG = {
  clientId: "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u",
  authBaseUrl: "https://www.windsurf.com",
  signInPath: "/windsurf/signin",
  registerApiBaseUrl: "https://register.windsurf.com",
  registerPath: "/exa.seat_management_pb.SeatManagementService/RegisterUser",
  oneTimeAuthPath: "/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken",
  currentUserPath: "/exa.seat_management_pb.SeatManagementService/GetCurrentUser",
  planStatusPath: "/exa.seat_management_pb.SeatManagementService/GetPlanStatus",
  userStatusPath: "/exa.seat_management_pb.SeatManagementService/GetUserStatus",
  defaultApiServerUrl: "https://server.codeium.com",
  firebaseApiKey: "AIzaSyDsOl-1XpT5err0Tcn0TFFod1H8gVGIycY",
  callbackPath: "/windsurf-auth-callback",
  userAgent: "antigravity-cockpit-tools",
  oauthTimeoutMs: 600_000,
};

export const GLM_OAUTH_CONFIG = { ...PROVIDER_OAUTH["glm"] };

export const ZED_HOSTED_CONFIG = {
  webBaseUrl: "https://zed.dev",
  cloudBaseUrl: "https://cloud.zed.dev",
  llmBaseUrl: "https://cloud.zed.dev",
  defaultNativeAppPort: 58443,
  oauthTimeoutMs: 600_000,
};

export const OAUTH_TIMEOUT = 300000;

export const PROVIDERS = {
  CLAUDE: "claude",
  CODEX: "codex",
  GEMINI: "gemini-cli",
  QODER: "qoder",
  IFLOW: "iflow",
  ANTIGRAVITY: "antigravity",
  OPENAI: "openai",
  GITHUB: "github",
  KIRO: "kiro",
  CURSOR: "cursor",
  KIMI: "kimi",
  KIMI_CODING: "kimi",
  KILOCODE: "kilocode",
  CLINE: "cline",
  CLINEPASS: "clinepass",
  GITLAB: "gitlab",
  CODEBUDDY: "codebuddy-cn",
  CODEBUDDY_INTL: "codebuddy-intl",
  KIMCHI: "kimchi",
  GROK_CLI: "grok-cli",
  TRAE: "trae",
  WINDSURF: "windsurf",
  GLM: "glm",
  ZED: "zed",
  OPENCODE: "opencode",
};

export const QODER_CN_CONFIG = {
  ...(PROVIDER_OAUTH["qoder-cn"] || PROVIDER_OAUTH["qoder"] || {}),
  deviceCodeUrl: PROVIDER_OAUTH["qoder-cn"]?.deviceCodeUrl || "https://openapi.qoder.com.cn/auth/device/code",
  tokenUrl: PROVIDER_OAUTH["qoder-cn"]?.tokenUrl || "https://openapi.qoder.com.cn/auth/device/token",
  userUrl: PROVIDER_OAUTH["qoder-cn"]?.userUrl || "https://openapi.qoder.com.cn/auth/user",
  clientId: PROVIDER_OAUTH["qoder-cn"]?.clientId || "qoder-cli",
};

export const NOUS_CONFIG = {
  ...(PROVIDER_OAUTH["nous"] || {}),
  deviceCodeUrl: PROVIDER_OAUTH["nous"]?.deviceCodeUrl || "https://portal.nousresearch.com/oauth/device/code",
  tokenUrl: PROVIDER_OAUTH["nous"]?.tokenUrl || "https://portal.nousresearch.com/oauth/device/token",
  clientId: PROVIDER_OAUTH["nous"]?.clientId || "nous-portal",
  scope: PROVIDER_OAUTH["nous"]?.scope || "openid profile email",
};

export const MUSE_CONFIG = {
  ...(PROVIDER_OAUTH["muse"] || {}),
  deviceCodeUrl: PROVIDER_OAUTH["muse"]?.deviceCodeUrl || "https://auth.meta.com/oauth/device/code",
  tokenUrl: PROVIDER_OAUTH["muse"]?.tokenUrl || "https://auth.meta.com/oauth/device/token",
  clientId: PROVIDER_OAUTH["muse"]?.clientId || "muse-cli",
};
