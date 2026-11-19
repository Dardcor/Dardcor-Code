

export default {
  id: "example",
  alias: "ex",
  aliases: ["example-ai"],
  uiAlias: "ex",
  category: "apikey",

  authType: "apikey",
  hasOAuth: false,
  authModes: ["apikey"],

  display: {
    name: "Example",
    icon: "bolt",
    color: "#3B82F6",
    textIcon: "EX",
    website: "https://example.com",
    notice: { apiKeyUrl: "https://example.com/keys" },
  },

  transport: {
    baseUrl: "https://api.example.com/v1/chat/completions",
    format: "openai",
  },



  models: [
    { id: "example-large", name: "Example Large" },
  ],

};
