import crypto from "crypto";
import open from "open";
import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "../constants/oauth.js";
import { getServerCredentials } from "../config/index.js";
import { startLocalServer } from "../utils/server.js";
import { spinner as createSpinner } from "../utils/ui.js";

export class AntigravityService {
  constructor() {
    this.config = ANTIGRAVITY_CONFIG;
  }

  buildAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(" "),
      state: state,
      access_type: "offline",
      prompt: "consent",
    });

    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  async exchangeCode(code, redirectUri) {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }

  async getUserInfo(accessToken) {
    const response = await fetch(`${this.config.userInfoUrl}?alt=json`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    return await response.json();
  }

  getApiHeaders(accessToken) {
    return {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": this.config.loadCodeAssistUserAgent,
    };
  }

  getMetadata() {
    return getOAuthClientMetadata();
  }

  async loadCodeAssist(accessToken) {
    const response = await fetch(this.config.loadCodeAssistEndpoint, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({ metadata: this.getMetadata() }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to load code assist: ${errorText}`);
    }

    const data = await response.json();

    let projectId = data.cloudaicompanionProject;
    if (typeof projectId === 'object' && projectId !== null && projectId.id) {
      projectId = projectId.id;
    }

    let tierId = "legacy-tier";
    if (Array.isArray(data.allowedTiers)) {
      for (const tier of data.allowedTiers) {
        if (tier.isDefault && tier.id) {
          tierId = tier.id.trim();
          break;
        }
      }
    }

    return { projectId, tierId, raw: data };
  }

  async onboardUser(accessToken, projectId, tierId) {
    const response = await fetch(this.config.onboardUserEndpoint, {
      method: "POST",
      headers: this.getApiHeaders(accessToken),
      body: JSON.stringify({ tierId, metadata: this.getMetadata() }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to onboard user: ${errorText}`);
    }

    return await response.json();
  }

  async completeOnboarding(accessToken, projectId, tierId, maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
      const result = await this.onboardUser(accessToken, projectId, tierId);

      if (result.done === true) {
        let finalProjectId = projectId;
        if (result.response?.cloudaicompanionProject) {
          const respProject = result.response.cloudaicompanionProject;
          if (typeof respProject === 'string') {
            finalProjectId = respProject.trim();
          } else if (respProject.id) {
            finalProjectId = respProject.id.trim();
          }
        }
        return { success: true, projectId: finalProjectId };
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error("Onboarding timeout - please try again");
  }

  async fetchProjectId(accessToken) {
    const { projectId } = await this.loadCodeAssist(accessToken);
    if (!projectId) {
      throw new Error("No cloudaicompanionProject found in response");
    }
    return projectId;
  }

  async saveTokens(tokens, userInfo, projectId) {
    const { server, token, userId } = getServerCredentials();

    const response = await fetch(`${server}/api/cli/providers/antigravity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-User-Id": userId,
      },
      body: JSON.stringify({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        email: userInfo.email,
        projectId: projectId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to save tokens");
    }

    return await response.json();
  }

  async connect() {
    const spinner = createSpinner("Starting Antigravity OAuth...").start();

    try {
      spinner.text = "Starting local server...";

      let callbackParams = null;
      const { port, close } = await startLocalServer((params) => {
        callbackParams = params;
      });

      const redirectUri = `http://localhost:${port}/callback`;
      spinner.succeed(`Local server started on port ${port}`);

      const state = crypto.randomBytes(32).toString("base64url");

      const authUrl = this.buildAuthUrl(redirectUri, state);

      console.log("\nOpening browser for Antigravity authentication...");
      console.log(`If browser doesn't open, visit:\n${authUrl}\n`);

      await open(authUrl);

      spinner.start("Waiting for Antigravity authorization...");

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Authentication timeout (5 minutes)"));
        }, 300000);

        const checkInterval = setInterval(() => {
          if (callbackParams) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });

      close();

      if (callbackParams.error) {
        throw new Error(callbackParams.error_description || callbackParams.error);
      }

      if (!callbackParams.code) {
        throw new Error("No authorization code received");
      }

      spinner.start("Exchanging code for tokens...");

      const tokens = await this.exchangeCode(callbackParams.code, redirectUri);

      spinner.text = "Fetching user info...";

      const userInfo = await this.getUserInfo(tokens.access_token);

      spinner.text = "Loading Code Assist configuration...";

      const { projectId, tierId } = await this.loadCodeAssist(tokens.access_token);

      if (!projectId) {
        throw new Error("No Google Cloud Project found. Please ensure you have a GCP project with Gemini Code Assist enabled.");
      }

      spinner.text = "Onboarding to Gemini Code Assist...";

      const onboardResult = await this.completeOnboarding(tokens.access_token, projectId, tierId);
      const finalProjectId = onboardResult.projectId || projectId;

      spinner.text = "Saving tokens to server...";

      await this.saveTokens(tokens, userInfo, finalProjectId);

      spinner.succeed(`Antigravity connected successfully! (${userInfo.email}, Project: ${finalProjectId})`);
      return true;
    } catch (error) {
      spinner.fail(`Failed: ${error.message}`);
      throw error;
    }
  }
}

