import { DEEPSEEK_WEB_CONFIG } from "../constants/oauth.js";

const deepseekWeb = {
  config: DEEPSEEK_WEB_CONFIG,
  flowType: "token_import",
  mapTokens: (tokens) => {
    return {
      accessToken: tokens.accessToken || tokens.token,
      email: tokens.email || null,
      providerSpecificData: tokens.providerSpecificData || {},
    };
  },
};

export default deepseekWeb;
