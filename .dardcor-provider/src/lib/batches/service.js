import { DATA_DIR } from "@/lib/dataDir.js";
import { createBatchService } from "./core.js";
import { createBatch, deleteBatch, getBatch, listBatches, removeExpiredBatches, updateBatch } from "@/lib/db/repos/batchesRepo.js";

// Provider execution is intentionally empty until a real, tested executor exists.
export const batchExecutors = Object.freeze({});
export const batchService = createBatchService({
  dataDir: DATA_DIR,
  executors: batchExecutors,
  store: { create: createBatch, get: getBatch, list: listBatches, update: updateBatch, delete: deleteBatch, removeExpired: removeExpiredBatches },
});
