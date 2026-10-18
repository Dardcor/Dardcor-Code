
export const QODER_REGION_INTL = "intl";
export const QODER_REGION_CN = "cn";

const QODER_REGION_BASES = {
  [QODER_REGION_INTL]: {
    chat: "https://api3.qoder.sh",
    chatAlt: "https://api2.qoder.sh",
    openApi: "https://openapi.qoder.sh",
    center: "https://center.qoder.sh",
    login: "https://qoder.com/device/selectAccounts",
    website: "https://qoder.com",
  },
  [QODER_REGION_CN]: {
    chat: "https://gateway.qoder.com.cn",
    chatAlt: "https://gateway.qoder.com.cn",
    openApi: "https://openapi.qoder.com.cn",
    center: "https://gateway.qoder.com.cn",
    login: "https://qoder.com.cn/device/selectAccounts",
    website: "https://qoder.com.cn",
  },
};

export function qoderRegionBases(region) {
  return QODER_REGION_BASES[region] || QODER_REGION_BASES[QODER_REGION_INTL];
}

export function qoderRegionOf(providerId) {
  return providerId === "qoder-cn" ? QODER_REGION_CN : QODER_REGION_INTL;
}

export const QODER_OPENAPI_BASE = QODER_REGION_BASES[QODER_REGION_INTL].openApi;
export const QODER_CENTER_BASE = QODER_REGION_BASES[QODER_REGION_INTL].center;
export const QODER_CHAT_BASE = QODER_REGION_BASES[QODER_REGION_INTL].chat;
export const QODER_CHAT_BASE_ALT = QODER_REGION_BASES[QODER_REGION_INTL].chatAlt;

export const QODER_LOGIN_URL = QODER_REGION_BASES[QODER_REGION_INTL].login;

export function qoderOpenApiBase(region) {
  return qoderRegionBases(region).openApi;
}
export function qoderDeviceTokenUrl(region) {
  return `${qoderOpenApiBase(region)}/api/v1/deviceToken/poll`;
}
export function qoderUserInfoUrl(region) {
  return `${qoderOpenApiBase(region)}/api/v1/userinfo`;
}
export function qoderQuotaUsageUrl(region) {
  return `${qoderOpenApiBase(region)}/api/v2/quota/usage`;
}
export function qoderRefreshTokenUrl(region) {
  return `${qoderRegionBases(region).center}/algo/api/v3/user/refresh_token`;
}
export function qoderLoginUrl(region) {
  return qoderRegionBases(region).login;
}
export function qoderWebsiteUrl(region) {
  return qoderRegionBases(region).website;
}

export const QODER_DEVICE_TOKEN_URL = qoderDeviceTokenUrl(QODER_REGION_INTL);
export const QODER_USERINFO_URL = qoderUserInfoUrl(QODER_REGION_INTL);
export const QODER_QUOTA_USAGE_URL = qoderQuotaUsageUrl(QODER_REGION_INTL);
export const QODER_REFRESH_TOKEN_URL = qoderRefreshTokenUrl(QODER_REGION_INTL);

export function qoderJobTokenExchangeUrl(region) {
  return `${qoderOpenApiBase(region)}/api/v1/jobToken/exchange`;
}
export const QODER_JOB_TOKEN_EXCHANGE_URL = qoderJobTokenExchangeUrl(QODER_REGION_INTL);

export const QODER_CHAT_SIG_PATH = "/api/v2/service/pro/sse/agent_chat_generation";
export const QODER_CHAT_URL = `${QODER_CHAT_BASE}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common`;
export const QODER_CHAT_URL_ENCODED = `${QODER_CHAT_URL}&Encode=1`;
export function qoderModelListUrl(region) {
  return `${qoderRegionBases(region).chat}/algo/api/v2/model/list`;
}
export const QODER_MODEL_LIST_URL = qoderModelListUrl(QODER_REGION_INTL);
export const QODER_IMAGE_UPLOAD_SIG_PATH = "/api/v2/image/upload";

export const QODER_MAX_PAYLOAD_BYTES = 6 * 1024 * 1024;
export const QODER_INLINE_FALLBACK_MAX_BYTES = 512 * 1024;

export const QODER_CONTEXT_TIER_HEADROOM = 0.15;
export const QODER_CONTEXT_TIER_ENV = "QODER_CONTEXT_TIER";
export const QODER_CONTEXT_TIER_MODES = Object.freeze({ AUTO: "auto", MAX: "max", DEFAULT: "default" });

export function qoderInferenceBase(credentials, region = QODER_REGION_INTL) {
  if (region === QODER_REGION_CN) return QODER_REGION_BASES[QODER_REGION_CN].chat;
  const raw = credentials?.apiKey || credentials?.accessToken;
  if (
    typeof raw === "string" &&
    !raw.startsWith("pt-") &&
    (raw.startsWith("jt-") || (credentials?.accessToken || "").startsWith("jt-"))
  ) {
    return QODER_CHAT_BASE_ALT;
  }
  return QODER_CHAT_BASE;
}

export const QODER_IDE_VERSION = "1.0.0";
export const QODER_CLIENT_TYPE = "5";
export const QODER_DATA_POLICY = "disagree";
export const QODER_LOGIN_VERSION = "v2";
export const QODER_MACHINE_OS = "x86_64_windows";
export const QODER_MACHINE_TYPE = "5";

export const QODER_MODEL_MAP = {
  auto: "auto",
  ultimate: "ultimate",
  performance: "performance",
  efficient: "efficient",
  lite: "lite",
  qmodel: "qmodel",
  qfmodel: "qfmodel",
  qmodel_latest: "qmodel_latest",
  qmodel_38max: "qmodel_38max",
  dmodel: "dmodel",
  dfmodel: "dfmodel",
  gmodel: "gmodel",
  gfmodel: "gfmodel",
  kmodel: "kmodel",
  mmodel: "mmodel",
};

export const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
