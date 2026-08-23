// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
  saveMetric, saveMetrics, getCacheStats, getSaverStats,
  buildCacheMetricRows, buildSaverMetricRows,
  aggregateCacheMetrics, aggregateSaverMetrics, periodToSince,
} from "@/lib/db/index.js";
