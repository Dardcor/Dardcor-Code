export default {
  id: "bedrock-xai",
  alias: "brx",
  aliases: ["bedrock-grok"],
  uiAlias: "brx",
  category: "apikey",
  authType: "apikey",
  apiKeyOptionalWith: "profile",
  credentialForm: "aws",
  display: {
    name: "AWS Bedrock (xAI)",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "BX",
    website: "https://aws.amazon.com/bedrock/",
    notice: {
      text:
        "xAI Grok models hosted on AWS Bedrock. Authenticate exactly like the AWS Bedrock " +
        "provider: fill in Profile and Region and leave the API key empty, then run " +
        "`aws sso login --profile <name>`; or use static keys with the AWS secret access key " +
        "as the API key. Note Grok is a reasoning model and spends output budget thinking " +
        'before it answers — a small max_tokens returns finish_reason "length" with empty ' +
        "content, so allow a few thousand tokens.",
      apiKeyUrl:
        "https://console.aws.amazon.com/iam/home#/security_credentials",
    },
  },
  transport: {
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    auth: { header: "aws-sigv4", scheme: "raw" },
  },
  passthroughModels: true,
  models: [
    { id: "us.xai.grok-4.6", name: "Grok 4.6" },
    { id: "global.xai.grok-4.6", name: "Grok 4.6 (global)" },
  ],
  hasProviderSpecificData: true,
};
