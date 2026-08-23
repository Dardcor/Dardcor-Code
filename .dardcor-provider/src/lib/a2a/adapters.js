import { mcpDependencies } from "@/lib/mcp/adapters";
import { getUsageStats } from "@/lib/usageDb";

export const a2aDependencies = {
  listProviders: mcpDependencies.listProviders,
  listModels: mcpDependencies.listModels,
  getQuotaSnapshot: mcpDependencies.getQuotaSnapshot,
  getCurrentStatus: mcpDependencies.getCurrentStatus,
  async getHealth() {
    const status = await mcpDependencies.getCurrentStatus();
    return { ok: status.status === "ready", status: status.status, checkedAt: status.checkedAt };
  },
  async getCostSummary({ period }) { return getUsageStats(period); },
};
