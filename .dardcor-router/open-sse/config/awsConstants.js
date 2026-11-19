export const AWS_SIGV4 = {
  algorithm: "AWS4-HMAC-SHA256",
  terminator: "aws4_request",
  keyPrefix: "AWS4",
  dateHeader: "x-amz-date",
  securityTokenHeader: "x-amz-security-token",
};

export const AWS_CREDENTIAL_MODE = {
  STATIC: "static",
  PROFILE: "profile",
};

export const AWS_CREDENTIAL_REFRESH_LEAD_MS = 5 * 60 * 1000;

export const AWS_CREDENTIAL_NO_EXPIRY_TTL_MS = 60 * 1000;

export const AWS_REGION_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}$/;

export const AWS_PROFILE_PATTERN = /^[\w@+.%: -]{1,64}$/;

export const AWS_CREDENTIAL_RESOLVE_TIMEOUT_MS = 10 * 1000;

export const AWS_CREDENTIAL_PROVIDERS_MODULE = "@aws-sdk/credential-providers";

export const BEDROCK = {
  service: "bedrock",
  defaultRegion: "us-east-1",
  anthropicVersion: "bedrock-2023-05-31",
  streamPath: "invoke-with-response-stream",
  invokePath: "invoke",
  chunkEventName: "chunk",
  modelFamilyPatterns: {
    claude: /(^|[./])anthropic\./,
    openai: /(^|[./])xai\./,
  },
  modelFamilyHints: {
    claude: 'an Anthropic model, e.g. "us.anthropic.claude-sonnet-4-5-20250929-v1:0"',
    openai: 'an xAI model, e.g. "us.xai.grok-4.6"',
  },
  terminalEventType: "message_stop",
  probePath: "foundation-models",
  probeTimeoutMs: 8000,
  errorTypeHeader: "x-amzn-errortype",
  accessDeniedErrorType: "AccessDeniedException",
};

export const AWS_EVENTSTREAM = {
  maxMessageBytes: 24 * 1024 * 1024,
  maxHeadersBytes: 128 * 1024,
};
