import {
  AWS_CREDENTIAL_MODE,
  AWS_CREDENTIAL_PROVIDERS_MODULE,
  AWS_CREDENTIAL_NO_EXPIRY_TTL_MS,
  AWS_CREDENTIAL_RESOLVE_TIMEOUT_MS,
  AWS_CREDENTIAL_REFRESH_LEAD_MS,
  AWS_PROFILE_PATTERN,
  AWS_REGION_PATTERN,
  BEDROCK,
} from "../config/awsConstants.js";


const credentialCache = new Map();

export function clearAwsCredentialCache() {
  credentialCache.clear();
}

export function detectCredentialMode(credentials) {
  const psd = credentials?.providerSpecificData || {};
  if (psd.profile) return AWS_CREDENTIAL_MODE.PROFILE;
  return AWS_CREDENTIAL_MODE.STATIC;
}

export function resolveRegion(credentials, env = process.env) {
  const candidates = [
    [credentials?.providerSpecificData?.region, "providerSpecificData.region"],
    [env.AWS_REGION, "the AWS_REGION environment variable"],
    [env.AWS_DEFAULT_REGION, "the AWS_DEFAULT_REGION environment variable"],
    [BEDROCK.defaultRegion, "the built-in default"],
  ];
  const [rawRegion, source] = candidates.find(([value]) => value) || [];

  const region = typeof rawRegion === "string" ? rawRegion.trim() : rawRegion;

  if (typeof region !== "string" || !AWS_REGION_PATTERN.test(region)) {
    throw new Error(
      `Invalid AWS region ${JSON.stringify(rawRegion)} from ${source}. A region looks like ` +
        '"us-east-1": lowercase letters, digits and hyphens only. It is used to build the ' +
        "Bedrock hostname, so anything else is rejected rather than sent to an unintended host.",
    );
  }
  return region;
}

function readStaticCredentials(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const accessKeyId = psd.accessKeyId;
  const secretAccessKey = credentials?.apiKey;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Bedrock static credentials are incomplete. Set the AWS secret access key as the " +
        "provider API key and providerSpecificData.accessKeyId to the AWS access key id, " +
        "or set providerSpecificData.profile to use a local AWS profile instead.",
    );
  }

  if (accessKeyId.startsWith("ASIA") && !psd.sessionToken) {
    throw new Error(
      "This looks like a temporary AWS access key (ASIA…) but no sessionToken was provided. " +
        "Add providerSpecificData.sessionToken, or use providerSpecificData.profile so " +
        "credentials are resolved and refreshed automatically.",
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: psd.sessionToken || undefined,
    expiration: null,
  };
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readProfileCredentials(
  credentials,
  loadCredentialProviders,
  log,
  resolveTimeoutMs,
) {
  const profile = credentials.providerSpecificData.profile;

  if (typeof profile !== "string" || !AWS_PROFILE_PATTERN.test(profile)) {
    throw new Error(
      `Invalid AWS profile name ${JSON.stringify(profile)}. Use the profile's name as it ` +
        "appears in ~/.aws/config or ~/.aws/credentials: letters, digits, spaces and " +
        "_ - @ + . % :, up to 64 characters.",
    );
  }

  let fromIni;
  try {
    ({ fromIni } = await loadCredentialProviders());
  } catch (error) {
    throw new Error(
      `Bedrock profile mode needs the ${AWS_CREDENTIAL_PROVIDERS_MODULE} package, which failed ` +
        `to load (${error.message}). Install it, or switch this connection to static ` +
        "accessKeyId/secretAccessKey credentials.",
    );
  }

  let resolved;
  try {
    resolved = await withTimeout(
      fromIni({ profile })(),
      resolveTimeoutMs,
      `Resolving AWS profile "${profile}" timed out after ${resolveTimeoutMs / 1000}s`,
    );
  } catch (error) {
    throw new Error(
      `Could not resolve AWS credentials for profile "${profile}": ${error.message}. ` +
        `If this profile uses IAM Identity Center, run: aws sso login --profile ${profile}`,
    );
  }

  if (!resolved?.accessKeyId || !resolved?.secretAccessKey) {
    throw new Error(
      `AWS profile "${profile}" resolved without usable credentials. Check that the profile ` +
        "exists in ~/.aws/config and grants Bedrock access.",
    );
  }

  log?.debug?.(
    "BEDROCK",
    `Resolved credentials from AWS profile "${profile}"` +
      (resolved.expiration
        ? ` (expire ${new Date(resolved.expiration).toISOString()})`
        : ""),
  );

  return {
    accessKeyId: resolved.accessKeyId,
    secretAccessKey: resolved.secretAccessKey,
    sessionToken: resolved.sessionToken || undefined,
    expiration: resolved.expiration
      ? new Date(resolved.expiration).getTime()
      : null,
  };
}

function computeExpiresAt(resolvedCredentials, now) {
  if (!resolvedCredentials.expiration)
    return now + AWS_CREDENTIAL_NO_EXPIRY_TTL_MS;
  return resolvedCredentials.expiration - AWS_CREDENTIAL_REFRESH_LEAD_MS;
}

function present(resolved, region, mode, expiresAt) {
  return {
    accessKeyId: resolved.accessKeyId,
    secretAccessKey: resolved.secretAccessKey,
    sessionToken: resolved.sessionToken,
    region,
    mode,
    expiresAt,
  };
}

export async function resolveAwsCredentials(
  credentials,
  {
    log = null,
    loadCredentialProviders = () => import("@aws-sdk/credential-providers"),
    now = () => Date.now(),
    resolveTimeoutMs = AWS_CREDENTIAL_RESOLVE_TIMEOUT_MS,
  } = {},
) {
  const mode = detectCredentialMode(credentials);
  const region = resolveRegion(credentials);

  if (mode === AWS_CREDENTIAL_MODE.STATIC) {
    return present(readStaticCredentials(credentials), region, mode, null);
  }

  const key = `profile:${credentials.providerSpecificData.profile}`;
  const currentTime = now();
  const cached = credentialCache.get(key);

  if (cached?.promise) {
    const resolved = await cached.promise;
    return present(
      resolved,
      region,
      mode,
      computeExpiresAt(resolved, currentTime),
    );
  }
  if (cached && cached.expiresAt > currentTime) {
    return present(cached.credentials, region, mode, cached.expiresAt);
  }

  const promise = readProfileCredentials(
    credentials,
    loadCredentialProviders,
    log,
    resolveTimeoutMs,
  );
  credentialCache.set(key, { promise });

  let resolved;
  try {
    resolved = await promise;
  } catch (error) {
    credentialCache.delete(key);
    throw error;
  }

  const expiresAt = computeExpiresAt(resolved, currentTime);
  credentialCache.set(key, {
    credentials: {
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
      sessionToken: resolved.sessionToken,
    },
    expiresAt,
  });

  return present(resolved, region, mode, expiresAt);
}
