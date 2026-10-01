// Shim → re-export from modular Full JSON DB layer (src/lib/db/)
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "@/lib/db/index.js";
