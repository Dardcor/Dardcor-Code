export function maskWebhookSecret(secret) {
  return secret ? `••••••••${secret.slice(-4)}` : null;
}

export function serializeWebhook(webhook, { includeSecret = false } = {}) {
  if (!webhook) return webhook;
  const { secret, ...safe } = webhook;
  const secretConfigured = safe.secretConfigured ?? Boolean(secret);
  const secretPreview = safe.secretPreview ?? maskWebhookSecret(secret);
  return {
    ...safe,
    secretConfigured,
    ...(secretPreview ? { secretPreview } : {}),
    ...(includeSecret && secret ? { secret } : {}),
  };
}
