
import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";


const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}






export async function refreshAndUpdateCredentials(connection, force = false, proxyOptions = null) {
  const executor = getExecutor(connection.provider);


  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    idToken: connection.idToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    lastRefreshAt: connection.lastRefreshAt,
    connectionId: connection.id,
    providerSpecificData: connection.providerSpecificData,
  };


  const needsRefresh = force || executor.needsRefresh(credentials);

  if (!needsRefresh) {
    return { connection, refreshed: false };
  }


  const refreshResult = await executor.refreshCredentials(credentials, console, proxyOptions);

  if (!refreshResult) {

    if (connection.accessToken) {
      return { connection, refreshed: false };
    }
    throw new Error("Failed to refresh credentials. Please re-authorize the connection.");
  }


  const now = new Date().toISOString();
  const updateData = {
    updatedAt: now,
  };


  if (refreshResult.accessToken) {
    updateData.accessToken = refreshResult.accessToken;
  }


  if (refreshResult.refreshToken) {
    updateData.refreshToken = refreshResult.refreshToken;
  }

  if (refreshResult.idToken) {
    updateData.idToken = refreshResult.idToken;
  }

  if (refreshResult.lastRefreshAt) {
    updateData.lastRefreshAt = refreshResult.lastRefreshAt;
  }


  if (refreshResult.expiresIn) {
    updateData.expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
    updateData.expiresIn = refreshResult.expiresIn;
  } else if (refreshResult.expiresAt) {
    updateData.expiresAt = refreshResult.expiresAt;
  }


  const providerSpecificUpdates = {
    ...(refreshResult.providerSpecificData || {}),
  };
  if (Object.keys(providerSpecificUpdates).length > 0) {
    updateData.providerSpecificData = {
      ...(connection.providerSpecificData || {}),
      ...providerSpecificUpdates,
    };
  }


  await updateProviderConnection(connection.id, updateData);


  const updatedConnection = {
    ...connection,
    ...updateData,
    providerSpecificData: updateData.providerSpecificData || connection.providerSpecificData,
  };

  return {
    connection: updatedConnection,
    refreshed: true,
  };
}




export async function GET(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    const force = new URL(request.url).searchParams.get("force") === "1";



    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }




    const isOAuth = connection.authType === "oauth";
    const isApikeyAuth =
      connection.authType === "apikey" || connection.authType === "api_key";
    const isApikeyEligible =
      isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);

    if (!isOAuth && !isApikeyEligible) {
      return Response.json({ message: "Usage not available for this connection" });
    }


    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };


    if (isOAuth) {
      try {
        const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
        connection = result.connection;
      } catch (refreshError) {
        console.error("[Usage API] Credential refresh failed:", refreshError);
        return Response.json({
          error: `Credential refresh failed: ${refreshError.message}`
        }, { status: 401 });
      }
    }


    let usage = await getUsageForProvider(connection, proxyOptions, { force });



    if (isOAuth && isAuthExpiredMessage(usage) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = retryResult.connection;
        usage = await getUsageForProvider(connection, proxyOptions, { force });
      } catch (retryError) {
        console.warn(`[Usage] ${connection.provider}: force refresh failed: ${retryError.message}`);
      }
    }

    return Response.json(usage);
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Usage] ${provider}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
