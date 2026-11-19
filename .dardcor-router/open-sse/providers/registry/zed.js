export default {
  id: "zed",
  priority: 10,
  alias: "zd",
  uiAlias: "zd",
  hidden: true,
  display: {
    name: "Zed",
    icon: "code",
    color: "#A855F7",
    website: "https://zed.dev",
    notice: {
      signupUrl: "https://zed.dev/native_app_signin",
    },
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,

  transport: {
    baseUrl: "https://cloud.zed.dev/completions",
    format: "openai",
    forceStream: true,
    headers: {
      "content-type": "application/json",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "<user_id> <access_token>",
    },
    usage: {
      url: "https://cloud.zed.dev/client/users/me",
    },
    modelsUrl: "https://cloud.zed.dev/models",
  },

  models: [],
  passthroughModels: true,

  oauth: {
    authorizeUrl: "https://zed.dev/native_app_signin",
    platform: "zed",
    rsaKeyExchange: true,
  },

  features: {
    usage: true,
  },
};
