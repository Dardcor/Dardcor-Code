"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function fmtTime(iso) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function SortIcon({ field, currentSort, currentOrder }) {
  if (currentSort !== field) return <span className="ml-1 opacity-20">↕</span>;
  return <span className="ml-1">{currentOrder === "asc" ? "↑" : "↓"}</span>;
}

SortIcon.propTypes = {
  field: PropTypes.string.isRequired,
  currentSort: PropTypes.string.isRequired,
  currentOrder: PropTypes.string.isRequired,
};

function ValueCells({ item, viewMode, isSummary = false }) {
  if (viewMode === "tokens") {
    return (
      <>
        <td className="px-3 sm:px-6 py-2.5 sm:py-3 text-right text-text-muted">
          {isSummary && item.promptTokens === undefined ? "—" : fmt(item.promptTokens)}
        </td>
        <td className="px-3 sm:px-6 py-2.5 sm:py-3 text-right text-text-muted">
          {item.cachedTokens ? fmt(item.cachedTokens) : "—"}
        </td>
        <td className="px-3 sm:px-6 py-2.5 sm:py-3 text-right text-text-muted">
          {isSummary && item.completionTokens === undefined ? "—" : fmt(item.completionTokens)}
        </td>
        <td className="px-3 sm:px-6 py-2.5 sm:py-3 text-right font-medium">
          {fmt(item.totalTokens)}
        </td>
      </>
    );
  }
  return (
    <>
      <td className="px-3 sm:px-6 py-2.5 sm:py-3 text-right text-text-muted">
        {isSummary && item.inputCost === undefined ? "—" : fmtCost(item.inputCost)}
      </td>
      <td className="px-3 sm:px-6 py-2.5 sm:py-3 text-right text-text-muted">
        {item.cachedCost ? fmtCost(item.cachedCost) : "—"}
      </td>
      <td className="px-3 sm:px-6 py-2.5 sm:py-3 text-right text-text-muted">
        {isSummary && item.outputCost === undefined ? "—" : fmtCost(item.outputCost)}
      </td>
      <td className="px-3 sm:px-6 py-2.5 sm:py-3 text-right font-medium text-warning">
        {fmtCost(item.totalCost || item.cost)}
      </td>
    </>
  );
}

ValueCells.propTypes = {
  item: PropTypes.object.isRequired,
  viewMode: PropTypes.string.isRequired,
  isSummary: PropTypes.bool,
};

export default function UsageTable({
  title,
  columns,
  groupedData,
  tableType,
  sortBy,
  sortOrder,
  onToggleSort,
  viewMode,
  storageKey,
  renderDetailCells,
  renderSummaryCells,
  emptyMessage,
}) {
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setExpanded(new Set(JSON.parse(saved)));
    } catch (e) {
      console.error(`Failed to load ${storageKey}:`, e);
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch (e) {
      console.error(`Failed to save ${storageKey}:`, e);
    }
  }, [expanded, storageKey]);

  const toggleGroup = useCallback((groupKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });
  }, []);

  const valueColumns = useMemo(() => {
    if (viewMode === "tokens") {
      return [
        { field: "promptTokens", label: "Input Tokens" },
        { field: "cachedTokens", label: "Cached" },
        { field: "completionTokens", label: "Output Tokens" },
        { field: "totalTokens", label: "Total Tokens" },
      ];
    }
    return [
      { field: "promptTokens", label: "Input Cost" },
      { field: "cachedCost", label: "Cached Cost" },
      { field: "completionTokens", label: "Output Cost" },
      { field: "cost", label: "Total Cost" },
    ];
  }, [viewMode]);

  const totalColSpan = columns.length + valueColumns.length;

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-border bg-bg-subtle/50">
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-sm text-left">
          <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.field}
                  className={`px-3 sm:px-6 py-2.5 sm:py-3 cursor-pointer hover:bg-bg-subtle/50 whitespace-nowrap ${col.align === "right" ? "text-right" : ""}`}
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
              {valueColumns.map((col) => (
                <th
                  key={col.field}
                  className="px-3 sm:px-6 py-2.5 sm:py-3 text-right cursor-pointer hover:bg-bg-subtle/50 whitespace-nowrap"
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groupedData.map((group) => (
              <Fragment key={group.groupKey}>
                {}
                <tr
                  className="group-summary cursor-pointer hover:bg-bg-subtle/50 transition-colors"
                  onClick={() => toggleGroup(group.groupKey)}
                >
                  <td className="px-3 sm:px-6 py-2.5 sm:py-3">
                    <div className="flex items-center gap-2">
                      <span className={`material-symbols-outlined text-[18px] text-text-muted transition-transform ${expanded.has(group.groupKey) ? "rotate-90" : ""}`}>
                        chevron_right
                      </span>
                      <span className={`font-medium transition-colors ${group.summary.pending > 0 ? "text-primary" : ""}`}>
                        {group.groupKey}
                      </span>
                    </div>
                  </td>
                  {renderSummaryCells(group)}
                  <ValueCells item={group.summary} viewMode={viewMode} isSummary />
                </tr>
                {}
                {expanded.has(group.groupKey) && group.items.map((item) => (
                  <tr
                    key={`detail-${item.key}`}
                    className="group-detail hover:bg-bg-subtle/20 transition-colors"
                  >
                    {renderDetailCells(item)}
                    <ValueCells item={item} viewMode={viewMode} />
                  </tr>
                ))}
              </Fragment>
            ))}
            {groupedData.length === 0 && (
              <tr>
                <td colSpan={totalColSpan} className="px-6 py-8 text-center text-text-muted">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

UsageTable.propTypes = {
  title: PropTypes.string.isRequired,
  columns: PropTypes.arrayOf(PropTypes.shape({
    field: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    align: PropTypes.string,
  })).isRequired,
  groupedData: PropTypes.array.isRequired,
  tableType: PropTypes.string.isRequired,
  sortBy: PropTypes.string.isRequired,
  sortOrder: PropTypes.string.isRequired,
  onToggleSort: PropTypes.func.isRequired,
  viewMode: PropTypes.string.isRequired,
  storageKey: PropTypes.string.isRequired,
  renderDetailCells: PropTypes.func.isRequired,
  renderSummaryCells: PropTypes.func.isRequired,
  emptyMessage: PropTypes.string.isRequired,
};

export { fmt, fmtCost, fmtTime };
