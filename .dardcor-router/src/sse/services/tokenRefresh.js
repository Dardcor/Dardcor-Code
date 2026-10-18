import * as log from "../utils/logger.js";
import { updateProviderConnection } from "../../lib/localDb.js";
import {
  getProjectIdForConnection,
  invalidateProjectId,
  removeConnection,
} from "open-sse/services/projectId.js";
import {
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
  refreshAccessToken as _refreshAccessToken,
  refreshClaudeOAuthToken as _refreshClaudeOAuthToken,
  refreshGoogleToken as _refreshGoogleToken,
  refreshCodexToken as _refreshCodexToken,
  refreshIflowToken as _refreshIflowToken,
  refreshGitHubToken as _refreshGitHubToken,
  refreshCopilotToken as _refreshCopilotToken,
  getAccessToken as _getAccessToken,
  refreshTokenByProvider as _refreshTokenByProvider,
  formatProviderCredentials as _formatProviderCredentials,
  getAllAccessTokens as _getAllAccessTokens,
  refreshKiroToken as _refreshKiroToken,
  getRefreshLeadMs as _getRefreshLeadMs
} from "open-sse/services/tokenRefresh.js";
import {
  refreshProviderCredentials as _refreshProviderCredentials,
  shouldRefreshCredentials as _shouldRefreshCredentials,
} from "open-sse/services/oauthCredentialManager.js";

export const TOKEN_EXPIRY_BUFFER_MS = BUFFER_MS;


export const refreshAccessToken = (provider, refreshToken, credentials) =>
  _refreshAccessToken(provider, refreshToken, credentials, log);

export const refreshClaudeOAuthToken = (refreshToken) =>
  _refreshClaudeOAuthToken(refreshToken, log);

export const refreshGoogleToken = (refreshToken, clientId, clientSecret) =>
  _refreshGoogleToken(refreshToken, clientId, clientSecret, log);

export const refreshCodexToken = (refreshToken) =>
  _refreshCodexToken(refreshToken, log);

export const refreshIflowToken = (refreshToken) =>
  _refreshIflowToken(refreshToken, log);

export const refreshGitHubToken = (refreshToken) =>
  _refreshGitHubToken(refreshToken, log);

export const refreshCopilotToken = (githubAccessToken) =>
  _refreshCopilotToken(githubAccessToken, log);

export const refreshKiroToken = (refreshToken, providerSpecificData) =>
  _refreshKiroToken(refreshToken, providerSpecificData, log);

export const getAccessToken = (provider, credentials) =>
  _getAccessToken(provider, credentials, log);

export const refreshTokenByProvider = (provider, credentials) =>
  _refreshTokenByProvider(provider, credentials, log);

export const formatProviderCredentials = (provider, credentials) =>
  _formatProviderCredentials(provider, credentials, log);

export const getAllAccessTokens = (userInfo) =>
  _getAllAccessTokens(userInfo, log);

export const shouldRefreshCredentials = (provider, credentials) =>
  _shouldRefreshCredentials(provider, credentials);


export function releaseConnection(connectionId) {
  if (!connectionId) return;
  removeConnection(connectionId);
  log.debug("TOKEN_REFRESH", "Released connection resources", { connectionId });
}


function toExpiresAt(expiresIn) {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function normalizeExpiresAt(expiresAt) {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function needsProjectId(provider) {
  return provider === "antigravity" || provider === "gemini-cli";
}

function _refreshProjectId(provider, connectionId, accessToken) {
  if (!needsProjectId(provider) || !connectionId || !accessToken) return;

  invalidateProjectId(connectionId);

  if (process.env.EAGER_PROJECT_ID_REFRESH === "true") {
    getProjectIdForConnection(connectionId, accessToken, provider)
      .then((projectId) => {
        if (!projectId) return;
        updateProviderCredentials(connectionId, { projectId }).catch((err) => {
          log.debug("TOKEN_REFRESH", "Failed to persist refreshed projectId", {
            connectionId,
            error: err?.message ?? err,
          });
        });
      })
      .catch((err) => {
        log.debug("TOKEN_REFRESH", "Failed to fetch projectId after token refresh", {
          connectionId,
          error: err?.message ?? err,
        });
      });
  }
}


export async function updateProviderCredentials(connectionId, newCredentials) {
  try {
    const updates = {};

    if (newCredentials.accessToken)         updates.accessToken  = newCredentials.accessToken;
    if (newCredentials.refreshToken)        updates.refreshToken = newCredentials.refreshToken;
    if (newCredentials.idToken)             updates.idToken = newCredentials.idToken;
    if (newCredentials.lastRefreshAt)       updates.lastRefreshAt = newCredentials.lastRefreshAt;
    if (newCredentials.expiresAt)           updates.expiresAt = newCredentials.expiresAt;
    if (newCredentials.expiresIn) {
      updates.expiresAt = toExpiresAt(newCredentials.expiresIn);
      updates.expiresIn = newCredentials.expiresIn;
    } else if (newCredentials.expiresAt) {
      const expiresAt = normalizeExpiresAt(newCredentials.expiresAt);
      if (expiresAt) {
        updates.expiresAt = expiresAt;
        updates.expiresIn = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      }
    }
    if (newCredentials.providerSpecificData) {
      updates.providerSpecificData = {
        ...(newCredentials.existingProviderSpecificData || {}),
        ...newCredentials.providerSpecificData,
      };
    }
    if (newCredentials.copilotToken || newCredentials.copilotTokenExpiresAt) {
      updates.providerSpecificData = {
        ...(updates.providerSpecificData || newCredentials.existingProviderSpecificData || {}),
        ...(newCredentials.copilotToken ? { copilotToken: newCredentials.copilotToken } : {}),
        ...(newCredentials.copilotTokenExpiresAt ? { copilotTokenExpiresAt: newCredentials.copilotTokenExpiresAt } : {}),
      };
    }
    if (newCredentials.projectId)            updates.projectId = newCredentials.projectId;

    const result = await updateProviderConnection(connectionId, updates);
    log.info("TOKEN_REFRESH", "Credentials updated in localDb", {
      connectionId,
      success: !!result
    });
    return !!result;
  } catch (error) {
    log.error("TOKEN_REFRESH", "Error updating credentials in localDb", {
      connectionId,
      error: error.message,
    });
    return false;
  }
}


export async function checkAndRefreshToken(provider, credentials, options = {}) {
  let creds = { ...credentials };
  if (!creds.connectionId && creds.id) {
    creds.connectionId = creds.id;
  }

  const force = options?.force === true;

  if (force || _shouldRefreshCredentials(provider, creds)) {
    const expiresAt = creds.expiresAt ? new Date(creds.expiresAt).getTime() : null;
    const remaining = expiresAt ? expiresAt - Date.now() : null;
    const refreshLead = _getRefreshLeadMs(provider);

    log.info("TOKEN_REFRESH", "Refreshing provider credentials proactively", {
      provider,
      expiresIn: remaining === null ? null : Math.round(remaining / 1000),
      refreshLeadMs: refreshLead,
      lastRefreshAt: creds.lastRefreshAt || null,
    });

    const newCreds = await _refreshProviderCredentials(provider, creds, log);
    if (newCreds?.accessToken || newCreds?.apiKey || newCreds?.copilotToken) {
      const mergedCreds = {
        ...newCreds,
        existingProviderSpecificData: creds.providerSpecificData,
      };

      await updateProviderCredentials(creds.connectionId, mergedCreds);

      creds = {
        ...creds,
        ...newCreds,
        expiresAt: newCreds.expiresIn
          ? toExpiresAt(newCreds.expiresIn)
          : normalizeExpiresAt(newCreds.expiresAt) || newCreds.expiresAt || creds.expiresAt,
        providerSpecificData: newCreds.providerSpecificData
          ? { ...creds.providerSpecificData, ...newCreds.providerSpecificData }
          : creds.providerSpecificData,
      };

      _refreshProjectId(provider, creds.connectionId, creds.accessToken);
    }
  }

  if (provider === "github") {
    const copilotToken = creds.copilotToken || creds.providerSpecificData?.copilotToken;
    let copilotExpiresAt = creds.copilotTokenExpiresAt || creds.providerSpecificData?.copilotTokenExpiresAt;
    if (typeof copilotExpiresAt === "number" && copilotExpiresAt < 1e12) {
      copilotExpiresAt = copilotExpiresAt * 1000;
    } else if (typeof copilotExpiresAt === "string") {
      copilotExpiresAt = new Date(copilotExpiresAt).getTime();
    } else if (!copilotExpiresAt) {
      copilotExpiresAt = 0;
    }
    const remaining = copilotExpiresAt - Date.now();

    if (!copilotToken || remaining < BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Copilot token expiring soon or missing, refreshing proactively", {
        provider,
        expiresIn: copilotToken ? Math.round(remaining / 1000) : "missing",
      });

      const copilotTokenResult = await _refreshCopilotToken(creds.accessToken, log);
      if (copilotTokenResult?.token) {
        const updatedSpecific = {
          ...(creds.providerSpecificData || {}),
          copilotToken: copilotTokenResult.token,
          copilotTokenExpiresAt: copilotTokenResult.expiresAt,
        };

        await updateProviderCredentials(creds.connectionId, {
          providerSpecificData: updatedSpecific,
        });

        creds.providerSpecificData = updatedSpecific;
        creds.copilotToken = copilotTokenResult.token;
        creds.copilotTokenExpiresAt = copilotTokenResult.expiresAt;
      }
    }
  }

  return creds;
}

export async function refreshGitHubAndCopilotTokens(credentials) {
  const newGitHubCreds = await _refreshGitHubToken(credentials.refreshToken, log);
  if (!newGitHubCreds?.accessToken) return newGitHubCreds;

  const copilotToken = await _refreshCopilotToken(newGitHubCreds.accessToken, log);
  if (!copilotToken) return newGitHubCreds;

  return {
    ...newGitHubCreds,
    providerSpecificData: {
      ...(credentials.providerSpecificData || {}),
      copilotToken: copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expiresAt,
    },
  };
}
