export default {
  id: "ai21",
  alias: "ai21",
  category: "freeTier",
  hasFree: true,
  authType: "apikey",
  display: {
    name: "AI21 Labs",
    icon: "psychology_alt",
    color: "#0284C7",
    textIcon: "AI21",
    website: "https://www.ai21.com",
  },
  transport: {
    baseUrl: "https://api.ai21.com/studio/v1/chat/completions",
    validateUrl: "https://api.ai21.com/studio/v1/models",
  },
  models: [
    { id: "jamba-1.5-large", name: "Jamba 1.5 Large", contextLength: 256000 },
    { id: "jamba-1.5-mini", name: "Jamba 1.5 Mini", contextLength: 256000 },
    { id: "jamba-large-1.7", name: "Jamba Large 1.7", contextLength: 256000 },
    { id: "jamba-mini-2", name: "Jamba Mini 2", contextLength: 256000 },
  ],
  passthroughModels: true,
};
