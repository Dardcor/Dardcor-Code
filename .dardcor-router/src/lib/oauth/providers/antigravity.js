import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth.js";

const antigravity = {
  config: ANTIGRAVITY_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config, redirectUri, state) => {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: config.scopes.join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config, code, redirectUri) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  },
  postExchange: async (tokens) => {
    const loadHeaders = {
      "Authorization": `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
      "x-request-source": "local",
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    };
    const metadata = getOAuthClientMetadata();

    // Fetch user info
    const userInfoRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "x-request-source": "local",
        "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      },
    });
    const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};

    // Load Code Assist to get project ID and tier
    let projectId = "";
    let tierId = "legacy-tier";
    try {
      const loadRes = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
        method: "POST",
        headers: loadHeaders,
        body: JSON.stringify({ metadata }),
      });
      if (loadRes.ok) {
        const data = await loadRes.json();
        projectId = data.cloudaicompanionProject?.id || data.cloudaicompanionProject || "";
        if (Array.isArray(data.allowedTiers)) {
          for (const tier of data.allowedTiers) {
            if (tier.isDefault && tier.id) {
              tierId = tier.id.trim();
              break;
            }
          }
        }
      }
    } catch (e) {
      console.log("Failed to load code assist:", e);
    }

    // If project is explicitly discovered and needs a single onboarding call
    if (projectId && projectId !== "default-cli-project") {
      try {
        await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
          method: "POST",
          headers: loadHeaders,
          body: JSON.stringify({ tierId, metadata }),
        });
      } catch {
        // Silently ignore - onboarding failure is non-fatal
      }
    }

    return { userInfo, projectId: projectId || "default-cli-project" };
  },
  mapTokens: (tokens, extra) => {
    const rawScope = tokens.scope || "";
    const cleanScope = rawScope
      .split(" ")
      .filter(s => s && !s.includes("cclog") && !s.includes("experimentsandconfigs"))
      .join(" ") || "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid";

    let email = extra?.userInfo?.email;
    if (!email && tokens.id_token) {
      try {
        const payloadBase64 = tokens.id_token.split(".")[1];
        if (payloadBase64) {
          const decoded = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf8"));
          email = decoded.email || null;
        }
      } catch {}
    }

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: cleanScope,
      email: email || "Google User",
      name: extra?.userInfo?.name || email || "Google Account",
      projectId: extra?.projectId || "default-cli-project",
    };
  },
};

export default antigravity;
