// Shim → re-export from modular Full JSON DB layer (src/lib/db/)
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "@/lib/db/index.js";
