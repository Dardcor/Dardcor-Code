export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "none", label: "No connection" },
];

export function getConnectionStatus(stats, isNoAuth = false, providerEnabled = true) {
  if (providerEnabled === false) return "inactive";
  if (isNoAuth) return "active";
  if (!stats || stats.total === 0) return "none";
  if (stats.allDisabled) return "inactive";
  return stats.connected > 0 ? "active" : "inactive";
}

export function matchesStatusFilter(statusFilter, stats, isNoAuth = false, providerEnabled = true) {
  if (statusFilter === "all") return true;
  return getConnectionStatus(stats, isNoAuth, providerEnabled) === statusFilter;
}
