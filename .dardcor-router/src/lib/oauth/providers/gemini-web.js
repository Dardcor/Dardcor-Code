import { GEMINI_WEB_CONFIG } from "../constants/oauth.js";

const geminiWeb = {
  config: GEMINI_WEB_CONFIG,
  flowType: "token_import",
  mapTokens: (tokens) => {
    return {
      accessToken: tokens.accessToken || tokens.cookies || tokens.token,
      email: tokens.email || null,
      providerSpecificData: tokens.providerSpecificData || {},
    };
  },
};

export default geminiWeb;
