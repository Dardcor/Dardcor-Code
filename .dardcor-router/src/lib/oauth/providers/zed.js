import { ZED_HOSTED_CONFIG } from "../constants/oauth.js";
import {
  createZedNativeAuthData,
  parseZedCallbackPayload,
  decryptZedAccessToken,
  fetchZedAuthenticatedUser,
  resolveZedOrganizationId,
} from "open-sse/shared/zedAuth.js";

const zed = {
  config: ZED_HOSTED_CONFIG,
  flowType: "authorization_code",
  callbackPath: "/",
  prepareConfig: async (config, meta) => {
    const nativeAppPort = Number(meta?.nativeAppPort) || ZED_HOSTED_CONFIG.defaultNativeAppPort;
    const auth = createZedNativeAuthData(config, { nativeAppPort });
    return { ...config, ...auth };
  },
  buildAuthUrl: (config, redirectUri, state) => config.authUrl,
  exchangeToken: async (config, code, redirectUri, codeVerifier, state) => {
    const { userId, encryptedAccessToken } = parseZedCallbackPayload(code);
    const accessToken = decryptZedAccessToken(encryptedAccessToken, codeVerifier);
    return { accessToken, userId, systemId: config.systemId };
  },
  postExchange: async (tokens) => {
    const credentials = {
      accessToken: tokens.accessToken,
      providerSpecificData: { userId: tokens.userId, systemId: tokens.systemId },
    };
    let userInfo = null;
    try {
      userInfo = await fetchZedAuthenticatedUser(credentials, { config: ZED_HOSTED_CONFIG });
    } catch { }
    const organizationId = resolveZedOrganizationId(credentials, userInfo);
    return {
      userInfo,
      organizationId,
      email: userInfo?.email || null,
      name: userInfo?.name || userInfo?.display_name || null,
    };
  },
  mapTokens: (tokens, extra) => ({
    accessToken: tokens.accessToken,
    refreshToken: null,
    expiresIn: null,
    email: extra?.email || undefined,
    displayName: extra?.name || undefined,
    providerSpecificData: {
      authMethod: "oauth",
      userId: tokens.userId,
      systemId: tokens.systemId,
      organizationId: extra?.organizationId || "",
    },
  }),
};

export default zed;
