export default {
  id: "bedrock",
  alias: "br",
  aliases: ["aws-bedrock"],
  uiAlias: "br",
  category: "apikey",
  authType: "apikey",
  apiKeyOptionalWith: "profile",
  credentialForm: "aws",
  display: {
    name: "AWS Bedrock",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "BR",
    website: "https://aws.amazon.com/bedrock/",
    notice: {
      text:
        "Two ways to authenticate, both entered in the AWS Bedrock Credentials section below. " +
        "SSO / profile (recommended): fill in Profile and Region, leave the API key empty, then " +
        "run `aws sso login --profile <name>` — credentials refresh automatically. " +
        "Static keys: put the AWS secret access key in the API Key field and the key id in " +
        "Access Key ID, adding Session Token if they are temporary (ASIA…) keys. " +
        "A profile, if set, takes precedence over static keys.",
      apiKeyUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
    },
  },
  transport: {
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    format: "claude",
    auth: { header: "aws-sigv4", scheme: "raw" },
  },
  passthroughModels: true,
  models: [
    { id: "us.anthropic.claude-opus-5", name: "Claude Opus 5" },
    { id: "us.anthropic.claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "us.anthropic.claude-fable-5", name: "Claude Fable 5" },
    { id: "us.anthropic.claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "us.anthropic.claude-opus-4-7", name: "Claude Opus 4.7" },
    { id: "us.anthropic.claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    {
      id: "us.anthropic.claude-opus-4-5-20251101-v1:0",
      name: "Claude Opus 4.5",
    },
    {
      id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      name: "Claude Sonnet 4.5",
    },
    {
      id: "us.anthropic.claude-opus-4-1-20250805-v1:0",
      name: "Claude Opus 4.1",
    },
    {
      id: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      name: "Claude Sonnet 4",
    },
    { id: "us.anthropic.claude-3-haiku-20240307-v1:0", name: "Claude 3 Haiku" },
  ],
  hasProviderSpecificData: true,
};
