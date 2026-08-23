import { FREEBUFF_CONFIG } from "../constants/oauth.js";

const freebuff = {
  config: FREEBUFF_CONFIG,
  flowType: "import_token",
  mapTokens: (tokens) => ({
    accessToken: tokens.authToken || tokens.accessToken,
    refreshToken: null,
    expiresIn: tokens.expiresIn || 86400 * 30,
    providerSpecificData: {
      userId: tokens.id || null,
      email: tokens.email || null,
      name: tokens.name || null,
      authMethod: tokens.authMethod || "imported",
    },
  }),
};

export default freebuff;
