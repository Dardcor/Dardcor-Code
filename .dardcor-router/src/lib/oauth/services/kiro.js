import { KIRO_CONFIG, assertValidAwsRegion } from "../constants/oauth.js";


const KIRO_AUTH_SERVICE = "https://prod.us-east-1.auth.desktop.kiro.dev";

export class KiroService {
  async registerClient(region = "us-east-1") {
    assertValidAwsRegion(region);
    const endpoint = `https://oidc.${region}.amazonaws.com/client/register`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientName: KIRO_CONFIG.clientName,
        clientType: KIRO_CONFIG.clientType,
        scopes: KIRO_CONFIG.scopes,
        grantTypes: KIRO_CONFIG.grantTypes,
        issuerUrl: KIRO_CONFIG.issuerUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register client: ${error}`);
    }

    const data = await response.json();
    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      clientSecretExpiresAt: data.clientSecretExpiresAt,
    };
  }

  async startDeviceAuthorization(clientId, clientSecret, startUrl, region = "us-east-1") {
    assertValidAwsRegion(region);
    const endpoint = `https://oidc.${region}.amazonaws.com/device_authorization`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        startUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to start device authorization: ${error}`);
    }

    const data = await response.json();
    return {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      verificationUri: data.verificationUri,
      verificationUriComplete: data.verificationUriComplete,
      expiresIn: data.expiresIn,
      interval: data.interval || 5,
    };
  }

  async pollDeviceToken(clientId, clientSecret, deviceCode, region = "us-east-1") {
    assertValidAwsRegion(region);
    const endpoint = `https://oidc.${region}.amazonaws.com/token`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error,
        errorDescription: data.error_description,
        pending: data.error === "authorization_pending" || data.error === "slow_down",
      };
    }

    return {
      success: true,
      tokens: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        tokenType: data.tokenType,
      },
    };
  }

  buildSocialLoginUrl(provider, codeChallenge, state) {
    const idp = provider === "google" ? "Google" : "Github";
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";
    return `${KIRO_AUTH_SERVICE}/login?idp=${idp}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&prompt=select_account`;
  }

  async exchangeSocialCode(code, codeVerifier) {
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";

    const response = await fetch(`${KIRO_AUTH_SERVICE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600,
    };
  }

  async refreshToken(refreshToken, providerSpecificData = {}) {
    const { authMethod, clientId, clientSecret, region } = providerSpecificData;

    if (clientId && clientSecret) {
      const safeRegion = region || "us-east-1";
      assertValidAwsRegion(safeRegion);
      const endpoint = `https://oidc.${safeRegion}.amazonaws.com/token`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken,
          grantType: "refresh_token",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
      }

      const data = await response.json();
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || refreshToken,
        profileArn: data.profileArn,
        expiresIn: data.expiresIn,
      };
    }

    const response = await fetch(`${KIRO_AUTH_SERVICE}/refreshToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600,
    };
  }

  async validateImportToken(refreshToken) {
    if (!refreshToken.startsWith("aorAAAAAG")) {
      throw new Error("Invalid token format. Token should start with aorAAAAAG...");
    }

    try {
      const result = await this.refreshToken(refreshToken);
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || refreshToken,
        profileArn: result.profileArn,
        expiresIn: result.expiresIn,
        authMethod: "imported",
      };
    } catch (error) {
      throw new Error(`Token validation failed: ${error.message}`);
    }
  }

  async listAvailableProfiles(accessToken, region = "us-east-1") {
    assertValidAwsRegion(region);
    const endpoint = `https://codewhisperer.${region}.amazonaws.com`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": "AmazonCodeWhispererService.ListAvailableProfiles",
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({ maxResults: 10 }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list profiles: ${error}`);
    }

    const data = await response.json();
    const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
    const arnOf = (p) => p?.arn || p?.profileArn || null;
    const match = profiles.find((p) => arnOf(p)?.split(":")[3] === region) || profiles[0];
    return arnOf(match);
  }

  async listAvailableApiKeyModels(apiKey, region = "us-east-1") {
    assertValidAwsRegion(region);
    const params = new URLSearchParams({ origin: "AI_EDITOR" });
    const endpoint = `https://q.${region}.amazonaws.com/ListAvailableModels?${params}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "TokenType": "API_KEY",
        "Accept": "application/json",
        "User-Agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
        "X-Amz-User-Agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list API-key models: ${error}`);
    }

    const data = await response.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    if (models.length === 0) {
      throw new Error("API key returned no available models");
    }
    return models;
  }

  async validateApiKey(apiKey, region = "us-east-1") {
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      throw new Error("API key is required");
    }
    const trimmed = apiKey.trim();

    try {
      await this.listAvailableApiKeyModels(trimmed, region);
    } catch (error) {
      throw new Error(`API key validation failed: ${error.message}`);
    }

    return {
      accessToken: trimmed,
      refreshToken: null,
      profileArn: null,
      region,
      authMethod: "api_key",
    };
  }

  async listAvailableModels(accessToken, profileArn) {
    const endpoint = "https://codewhisperer.us-east-1.amazonaws.com";
    const target = "AmazonCodeWhispererService.ListAvailableModels";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": target,
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        origin: "AI_EDITOR",
        profileArn,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list models: ${error}`);
    }

    const data = await response.json();
    return (data.models || []).map(m => ({
      id: m.modelId,
      name: m.modelName || m.modelId,
      description: m.description,
      rateMultiplier: m.rateMultiplier,
      rateUnit: m.rateUnit,
      maxInputTokens: m.tokenLimits?.maxInputTokens || 0,
    }));
  }

  extractEmailFromJWT(accessToken) {
    try {
      const parts = accessToken.split(".");
      if (parts.length !== 3) return null;

      let payload = parts[1];
      while (payload.length % 4) {
        payload += "=";
      }

      const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return decoded.email || decoded.preferred_username || decoded.sub;
    } catch {
      return null;
    }
  }
}
