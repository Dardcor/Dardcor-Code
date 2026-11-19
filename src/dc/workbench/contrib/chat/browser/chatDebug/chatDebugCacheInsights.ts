/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { safeIntl } from '../../../../../base/common/date.js';
import { localize } from '../../../../../nls.js';
import { CacheDiffKind, ICacheDiffResult, INormalizedMessage } from './chatDebugCacheDiff.js';

const numberFormatter = safeIntl.NumberFormat();

function fmt(n: number): string {
	return numberFormatter.value.format(n);
}

export const enum CacheInsightSeverity {
	Ok = 'ok',
	Info = 'info',
	Warning = 'warning',
	Critical = 'critical',
}

export const enum CacheBreakCategory {
	Healthy = 'healthy',
	Expiration = 'expiration',
	Model = 'model',
	Tools = 'tools',
	System = 'system',
	Options = 'options',
	History = 'history',
	Unknown = 'unknown',
}

export interface ICacheInsight {
	readonly severity: CacheInsightSeverity;
	readonly title: string;
	readonly detail?: string;
	readonly hint?: string;
	readonly component?: string;
	readonly category?: CacheBreakCategory;
}

export interface ICacheInsightOptionDelta {
	readonly key: string;
	readonly previousLabel: string;
	readonly currentLabel: string;
}

export interface ICacheInsightsInput {
	readonly aModel: string | undefined;
	readonly bModel: string | undefined;
	readonly aSystem: string | undefined;
	readonly bSystem: string | undefined;
	readonly aTools: string | undefined;
	readonly bTools: string | undefined;
	readonly aMessages: readonly INormalizedMessage[];
	readonly bMessages: readonly INormalizedMessage[];
	readonly diff: ICacheDiffResult;
	readonly optionsDiff: readonly ICacheInsightOptionDelta[];
	readonly hitPct: number;
	readonly inputTokens: number;
	readonly minutesSincePrevious: number | undefined;
	readonly isContinuation: boolean;
	readonly previousIsContinuation: boolean;
	readonly compareInputMessages: boolean;
}

export const enum StringDivergenceShape {
	LeadingRemoved = 'leadingRemoved',
	LeadingAdded = 'leadingAdded',
	TrailingRemoved = 'trailingRemoved',
	TrailingAdded = 'trailingAdded',
	InnerEdit = 'innerEdit',
}

const CHANGED_EXCERPT_CAP = 120;

export interface IStringDivergence {
	readonly shape: StringDivergenceShape;
	readonly commonPrefix: number;
	readonly commonSuffix: number;
	readonly aLength: number;
	readonly bLength: number;
	readonly aChanged: string;
	readonly bChanged: string;
}

export function analyzeStringDivergence(a: string, b: string): IStringDivergence | undefined {
	if (a === b) {
		return undefined;
	}
	const aLength = a.length;
	const bLength = b.length;
	const minLength = Math.min(aLength, bLength);
	let commonPrefix = 0;
	while (commonPrefix < minLength && a.charCodeAt(commonPrefix) === b.charCodeAt(commonPrefix)) {
		commonPrefix++;
	}
	let commonSuffix = 0;
	while (commonSuffix < minLength - commonPrefix && a.charCodeAt(aLength - 1 - commonSuffix) === b.charCodeAt(bLength - 1 - commonSuffix)) {
		commonSuffix++;
	}

	let shape: StringDivergenceShape;
	if (commonPrefix === bLength && bLength < aLength) {
		shape = StringDivergenceShape.TrailingRemoved;
	} else if (commonPrefix === aLength && aLength < bLength) {
		shape = StringDivergenceShape.TrailingAdded;
	} else if (commonSuffix === bLength && bLength < aLength) {
		shape = StringDivergenceShape.LeadingRemoved;
	} else if (commonSuffix === aLength && aLength < bLength) {
		shape = StringDivergenceShape.LeadingAdded;
	} else {
		shape = StringDivergenceShape.InnerEdit;
	}

	return {
		shape,
		commonPrefix,
		commonSuffix,
		aLength,
		bLength,
		aChanged: a.substring(commonPrefix, aLength - commonSuffix).slice(0, CHANGED_EXCERPT_CAP),
		bChanged: b.substring(commonPrefix, bLength - commonSuffix).slice(0, CHANGED_EXCERPT_CAP),
	};
}

export function describeStringDivergence(d: IStringDivergence): string {
	switch (d.shape) {
		case StringDivergenceShape.TrailingAdded:
			return localize('chatDebug.cache.div.appended', "{0} chars appended — the previous content survives as a shared prefix", fmt(d.bLength - d.aLength));
		case StringDivergenceShape.TrailingRemoved:
			return localize('chatDebug.cache.div.truncated', "last {0} chars removed — the remaining content still matches the previous bytes", fmt(d.aLength - d.bLength));
		case StringDivergenceShape.LeadingAdded:
			return localize('chatDebug.cache.div.prepended', "{0} chars prepended — this block no longer starts with the same bytes", fmt(d.bLength - d.aLength));
		case StringDivergenceShape.LeadingRemoved:
			return localize('chatDebug.cache.div.leadingRemoved', "first {0} chars removed — this block no longer starts with the same bytes", fmt(d.aLength - d.bLength));
		case StringDivergenceShape.InnerEdit:
			return localize('chatDebug.cache.div.innerEdit', "edited in place — first difference at char {0} ({1} leading and {2} trailing chars unchanged)", fmt(d.commonPrefix), fmt(d.commonPrefix), fmt(d.commonSuffix));
	}
}

export const enum VolatileValueKind {
	Timestamp = 'timestamp',
	Uuid = 'uuid',
	Counter = 'counter',
}

interface IVolatilePattern {
	readonly kind: VolatileValueKind;
	readonly re: RegExp;
}

const VOLATILE_PATTERNS: readonly IVolatilePattern[] = [
	{ kind: VolatileValueKind.Uuid, re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/ },
	{ kind: VolatileValueKind.Timestamp, re: /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b/ },
	{ kind: VolatileValueKind.Timestamp, re: /\b\d{1,2}:\d{2}:\d{2}\b/ },
	{ kind: VolatileValueKind.Counter, re: /\b\d{10,13}\b/ },
];

export function detectVolatileValue(aChanged: string, bChanged: string): VolatileValueKind | undefined {
	for (const { kind, re } of VOLATILE_PATTERNS) {
		const aMatch = re.exec(aChanged)?.[0];
		const bMatch = re.exec(bChanged)?.[0];
		if (aMatch !== undefined && bMatch !== undefined && aMatch !== bMatch) {
			return kind;
		}
	}
	return undefined;
}

const VOLATILE_CONTEXT = 24;
const VOLATILE_WINDOW_CAP = 240;

function detectVolatileValueAround(a: string, b: string, dv: IStringDivergence): VolatileValueKind | undefined {
	const start = Math.max(0, dv.commonPrefix - VOLATILE_CONTEXT);
	const aWindow = a.substring(start, Math.min(dv.aLength - dv.commonSuffix + VOLATILE_CONTEXT, start + VOLATILE_WINDOW_CAP));
	const bWindow = b.substring(start, Math.min(dv.bLength - dv.commonSuffix + VOLATILE_CONTEXT, start + VOLATILE_WINDOW_CAP));
	return detectVolatileValue(aWindow, bWindow);
}

function volatileValueLabel(kind: VolatileValueKind): string {
	switch (kind) {
		case VolatileValueKind.Timestamp: return localize('chatDebug.cache.volatile.timestamp', "timestamp");
		case VolatileValueKind.Uuid: return localize('chatDebug.cache.volatile.uuid', "unique id (UUID)");
		case VolatileValueKind.Counter: return localize('chatDebug.cache.volatile.counter', "large changing number");
	}
}

export interface IToolCatalogDelta {
	readonly added: readonly string[];
	readonly removed: readonly string[];
	readonly modified: readonly string[];
	readonly reorderedOnly: boolean;
	readonly aCount: number;
	readonly bCount: number;
}

function parseToolList(toolsJson: string | undefined): Map<string, string> | undefined {
	if (!toolsJson) {
		return undefined;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(toolsJson);
	} catch {
		return undefined;
	}
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const out = new Map<string, string>();
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i] as { name?: unknown; type?: unknown; function?: { name?: unknown } } | null;
		const name =
			(item && typeof item.name === 'string' && item.name) ||
			(item && item.function && typeof item.function.name === 'string' && item.function.name) ||
			(item && typeof item.type === 'string' && item.type) ||
			`#${i}`;
		let serialized: string;
		try {
			serialized = JSON.stringify(item);
		} catch {
			serialized = String(item);
		}
		out.set(name, (out.get(name) ?? '') + serialized);
	}
	return out;
}

export function analyzeToolCatalog(aTools: string | undefined, bTools: string | undefined): IToolCatalogDelta | undefined {
	const a = parseToolList(aTools);
	const b = parseToolList(bTools);
	if (!a || !b) {
		return undefined;
	}
	const added: string[] = [];
	const removed: string[] = [];
	const modified: string[] = [];
	for (const [name, def] of b) {
		const aDef = a.get(name);
		if (aDef === undefined) {
			added.push(name);
		} else if (aDef !== def) {
			modified.push(name);
		}
	}
	for (const name of a.keys()) {
		if (!b.has(name)) {
			removed.push(name);
		}
	}
	return {
		added,
		removed,
		modified,
		reorderedOnly: added.length === 0 && removed.length === 0 && modified.length === 0,
		aCount: a.size,
		bCount: b.size,
	};
}

const severityRank: Record<CacheInsightSeverity, number> = {
	[CacheInsightSeverity.Ok]: 0,
	[CacheInsightSeverity.Info]: 1,
	[CacheInsightSeverity.Warning]: 2,
	[CacheInsightSeverity.Critical]: 3,
};

export function maxInsightSeverity(insights: readonly ICacheInsight[]): CacheInsightSeverity {
	let max = CacheInsightSeverity.Ok;
	for (const i of insights) {
		if (severityRank[i.severity] > severityRank[max]) {
			max = i.severity;
		}
	}
	return max;
}

export function primaryInsight(insights: readonly ICacheInsight[]): ICacheInsight | undefined {
	return insights.find(i => i.severity === CacheInsightSeverity.Critical)
		?? insights.find(i => i.severity === CacheInsightSeverity.Warning);
}

const EFFECTIVE_MISS_PCT = 1;
const TYPICAL_TTL_MINUTES = 5;
const LOOKBACK_WINDOW_BLOCKS = 20;
const MIN_CACHEABLE_TOKENS = 4096;

export function computeCacheInsights(input: ICacheInsightsInput): ICacheInsight[] {
	const out: ICacheInsight[] = [];
	const modelChanged = input.aModel !== input.bModel;
	const toolsChanged = (input.aTools ?? '') !== (input.bTools ?? '');
	const systemChanged = (input.aSystem ?? '') !== (input.bSystem ?? '');

	if (modelChanged) {
		out.push({
			severity: CacheInsightSeverity.Critical,
			title: localize('chatDebug.cache.insight.model.title', "Model changed"),
			detail: localize('chatDebug.cache.insight.model.detail', "{0} → {1}", input.aModel ?? '—', input.bModel ?? '—'),
			hint: localize('chatDebug.cache.insight.model.hint', "Prompt caches are scoped to a model — switching models recomputes the entire prompt. Route sub-tasks that need a different model through a separate request chain so the main loop keeps its cache."),
			category: CacheBreakCategory.Model,
		});
	}

	if (toolsChanged) {
		out.push(toolsInsight(input.aTools, input.bTools));
	}

	if (systemChanged) {
		out.push(systemInsight(input.aSystem, input.bSystem));
	}

	if (input.optionsDiff.length > 0) {
		out.push({
			severity: CacheInsightSeverity.Warning,
			title: localize('chatDebug.cache.insight.options.title', "Request options changed"),
			detail: input.optionsDiff.map(d => `${d.key}: ${d.previousLabel} → ${d.currentLabel}`).join(' · '),
			hint: localize('chatDebug.cache.insight.options.hint', "Options are part of the cache key on most providers. Keep per-request options stable when cache reuse matters."),
			category: CacheBreakCategory.Options,
		});
	}

	if (input.compareInputMessages) {
		out.push(...messageInsights(input, modelChanged || toolsChanged || systemChanged));
		if (!modelChanged && !toolsChanged && !systemChanged && input.optionsDiff.length === 0 && !input.diff.break) {
			out.push(stablePrefixInsight(input));
		}
	} else if (input.isContinuation) {
		out.push({
			severity: CacheInsightSeverity.Info,
			title: localize('chatDebug.cache.insight.continuation.title', "Responses API continuation"),
			detail: localize('chatDebug.cache.insight.continuation.detail', "Only the wire delta is captured for this request; prior context is referenced by previous_response_id and reconstructed provider-side. Analysis is limited to system, tools, and request options."),
			category: CacheBreakCategory.Unknown,
		});
	} else if (input.previousIsContinuation) {
		out.push({
			severity: CacheInsightSeverity.Info,
			title: localize('chatDebug.cache.insight.prevContinuation.title', "Message comparison suppressed"),
			detail: localize('chatDebug.cache.insight.prevContinuation.detail', "The previous request was a Responses API continuation (delta-only wire input); positionally diffing this full request against it would be misleading."),
			category: CacheBreakCategory.Unknown,
		});
	}

	return out;
}

function toolsInsight(aTools: string | undefined, bTools: string | undefined): ICacheInsight {
	const delta = analyzeToolCatalog(aTools, bTools);
	const component = 'tools';
	if (delta?.reorderedOnly) {
		return {
			severity: CacheInsightSeverity.Critical,
			title: localize('chatDebug.cache.insight.toolsReorder.title', "Tool definitions reordered"),
			detail: localize('chatDebug.cache.insight.toolsReorder.detail', "Same {0} tools with identical definitions, sent in a different order.", fmt(delta.bCount)),
			hint: localize('chatDebug.cache.insight.toolsReorder.hint', "Tools render at the very start of the prompt — a pure reorder still changes the bytes and invalidates the entire cache. Serialize the tool list deterministically (e.g. sort by name)."),
			component,
			category: CacheBreakCategory.Tools,
		};
	}
	if (delta && (delta.added.length > 0 || delta.removed.length > 0)) {
		const parts: string[] = [];
		if (delta.added.length > 0) {
			parts.push(localize('chatDebug.cache.insight.toolsAdded', "added: {0}", delta.added.join(', ')));
		}
		if (delta.removed.length > 0) {
			parts.push(localize('chatDebug.cache.insight.toolsRemoved', "removed: {0}", delta.removed.join(', ')));
		}
		if (delta.modified.length > 0) {
			parts.push(localize('chatDebug.cache.insight.toolsModified', "modified: {0}", delta.modified.join(', ')));
		}
		return {
			severity: CacheInsightSeverity.Critical,
			title: localize('chatDebug.cache.insight.toolsSet.title', "Tool catalog changed ({0} → {1} tools)", fmt(delta.aCount), fmt(delta.bCount)),
			detail: parts.join(' · '),
			hint: localize('chatDebug.cache.insight.toolsSet.hint', "Tool definitions render before everything else, so adding or removing a tool mid-session invalidates the whole prompt. Keep the tool set stable for the life of a session, or use deferred/appended tool loading instead of swapping the catalog."),
			component,
			category: CacheBreakCategory.Tools,
		};
	}
	if (delta && delta.modified.length > 0) {
		return {
			severity: CacheInsightSeverity.Critical,
			title: localize('chatDebug.cache.insight.toolsDef.title', "Tool definitions modified"),
			detail: localize('chatDebug.cache.insight.toolsDef.detail', "changed: {0}", delta.modified.join(', ')),
			hint: localize('chatDebug.cache.insight.toolsDef.hint', "A changed tool description or schema rewrites the prompt from the tools block onward. Check for dynamic content (counts, paths, timestamps) inside tool descriptions."),
			component,
			category: CacheBreakCategory.Tools,
		};
	}
	const dv = analyzeStringDivergence(aTools ?? '', bTools ?? '');
	return {
		severity: CacheInsightSeverity.Critical,
		title: localize('chatDebug.cache.insight.tools.title', "Tool catalog changed"),
		detail: dv ? describeStringDivergence(dv) : undefined,
		hint: localize('chatDebug.cache.insight.tools.hint', "The tool catalog is the first block of the prompt — any byte change here invalidates the entire cache."),
		component,
		category: CacheBreakCategory.Tools,
	};
}

function systemInsight(aSystem: string | undefined, bSystem: string | undefined): ICacheInsight {
	const dv = analyzeStringDivergence(aSystem ?? '', bSystem ?? '');
	const volatile = dv ? detectVolatileValueAround(aSystem ?? '', bSystem ?? '', dv) : undefined;
	return {
		severity: CacheInsightSeverity.Critical,
		title: localize('chatDebug.cache.insight.system.title', "System prompt changed"),
		detail: dv
			? localize('chatDebug.cache.insight.system.detail', "{0} → {1} chars · {2}", fmt(dv.aLength), fmt(dv.bLength), describeStringDivergence(dv))
			: undefined,
		hint: volatile
			? localize('chatDebug.cache.insight.system.volatileHint', "The changed region looks like a {0} — volatile values interpolated into the system prompt break the cache on every request. Move dynamic content after the conversation history or drop it.", volatileValueLabel(volatile))
			: localize('chatDebug.cache.insight.system.hint', "A system prompt change invalidates everything after the tools block. Keep the system prompt byte-stable for the life of a session and inject per-turn context into the newest message instead."),
		component: 'system',
		category: CacheBreakCategory.System,
	};
}

function messageInsights(input: ICacheInsightsInput, hasEarlierBreak: boolean): ICacheInsight[] {
	const { diff } = input;
	if (!diff.break) {
		return [];
	}
	const out: ICacheInsight[] = [];
	const idx = diff.break.index;
	const component = `messages[${idx}]`;
	const counts = diff.counts;

	if (diff.break.kind === CacheDiffKind.OnlyInB) {
		out.push({
			severity: hasEarlierBreak ? CacheInsightSeverity.Info : CacheInsightSeverity.Ok,
			title: localize('chatDebug.cache.insight.append.title', "New messages appended — expected growth"),
			detail: localize('chatDebug.cache.insight.append.detail', "{0} new message(s) after {1} unchanged — the shared prefix was extended, not broken. The uncached tokens are the new suffix being written to the cache for the next request.", fmt(counts.onlyInB), fmt(counts.identical)),
			component,
			category: CacheBreakCategory.Healthy,
		});
		if (counts.onlyInB > LOOKBACK_WINDOW_BLOCKS) {
			out.push({
				severity: CacheInsightSeverity.Warning,
				title: localize('chatDebug.cache.insight.lookback.title', "{0} blocks appended — beyond the typical cache lookback window", fmt(counts.onlyInB)),
				detail: localize('chatDebug.cache.insight.lookback.detail', "Providers typically look back ~{0} content blocks for a prior cache entry; a turn that appends more can silently miss it even though the prefix matches.", LOOKBACK_WINDOW_BLOCKS),
				hint: localize('chatDebug.cache.insight.lookback.hint', "During long tool loops, place intermediate cache breakpoints every ~15 blocks so the next request can still find a cache entry."),
			});
		}
		return out;
	}

	if (diff.break.kind === CacheDiffKind.OnlyInA) {
		out.push({
			severity: CacheInsightSeverity.Critical,
			title: localize('chatDebug.cache.insight.truncated.title', "History truncated at messages[{0}]", idx),
			detail: localize('chatDebug.cache.insight.truncated.detail', "{0} message(s) present in the previous request are missing from this one.", fmt(counts.onlyInA)),
			hint: localize('chatDebug.cache.insight.truncated.hint', "History slicing or compaction shortens the prefix — the cache can only match up to the cut, and everything after it is recomputed."),
			component,
			category: CacheBreakCategory.History,
		});
		return out;
	}

	const tok = diff.signature.find(t => t.index === idx);
	const role = tok?.bRole ?? tok?.aRole ?? 'message';
	const aMsg = input.aMessages[idx];
	const bMsg = input.bMessages[idx];
	const dv = aMsg && bMsg ? analyzeStringDivergence(aMsg.text, bMsg.text) : undefined;
	const volatile = dv && aMsg && bMsg ? detectVolatileValueAround(aMsg.text, bMsg.text, dv) : undefined;
	const detailParts: string[] = [];
	if (aMsg && bMsg) {
		detailParts.push(localize('chatDebug.cache.insight.drift.sizes', "{0} message, {1} → {2} chars", role, fmt(aMsg.charLength), fmt(bMsg.charLength)));
	}
	if (dv) {
		detailParts.push(describeStringDivergence(dv));
	}
	out.push({
		severity: CacheInsightSeverity.Critical,
		title: localize('chatDebug.cache.insight.drift.title', "History rewritten at messages[{0}]", idx),
		detail: detailParts.join(' · '),
		hint: volatile
			? localize('chatDebug.cache.insight.drift.volatileHint', "The changed region looks like a {0} — a volatile value re-rendered into the conversation history breaks the prefix on every request.", volatileValueLabel(volatile))
			: localize('chatDebug.cache.insight.drift.hint', "Conversation history must be byte-identical between requests to reuse the cached prefix. A re-serialized {0} turn — trimmed whitespace, dropped reasoning or preamble text, reformatted tool calls — silently invalidates everything after it.", role),
		component,
		category: CacheBreakCategory.History,
	});

	const changedAfterBreak = counts.contentDrift + counts.lengthChange + counts.onlyInA + counts.onlyInB - 1;
	if (changedAfterBreak > 0) {
		out.push({
			severity: CacheInsightSeverity.Info,
			title: localize('chatDebug.cache.insight.afterBreak.title', "{0} more changed position(s) after the break", fmt(changedAfterBreak)),
			detail: localize('chatDebug.cache.insight.afterBreak.detail', "Once the prefix breaks at messages[{0}], everything after it is recomputed regardless — fix the first break first.", idx),
		});
	}
	return out;
}

function stablePrefixInsight(input: ICacheInsightsInput): ICacheInsight {
	if (input.hitPct < EFFECTIVE_MISS_PCT) {
		if (input.inputTokens > 0 && input.inputTokens < MIN_CACHEABLE_TOKENS) {
			return {
				severity: CacheInsightSeverity.Warning,
				title: localize('chatDebug.cache.insight.tooSmall.title', "Prompt may be below the minimum cacheable size"),
				detail: localize('chatDebug.cache.insight.tooSmall.detail', "{0} input tokens — providers only cache prompts above a minimum prefix size (roughly 1,024-4,096 tokens depending on model), and smaller prompts silently never cache.", fmt(input.inputTokens)),
				hint: localize('chatDebug.cache.insight.tooSmall.hint', "Small utility requests (titles, summaries) often sit below the threshold; a 0% hit on them is normal and not worth optimizing."),
				category: CacheBreakCategory.Expiration,
			};
		}
		const minutes = input.minutesSincePrevious;
		const gap = minutes !== undefined && minutes >= 1
			? localize('chatDebug.cache.insight.expired.gap', " {0} minute(s) elapsed since the previous request.", fmt(Math.round(minutes)))
			: '';
		return {
			severity: CacheInsightSeverity.Warning,
			title: localize('chatDebug.cache.insight.expired.title', "Likely cache expiration"),
			detail: localize('chatDebug.cache.insight.expired.detail', "The prompt is byte-identical to the previous request but only {0}% was served from cache.{1}", input.hitPct.toFixed(2), gap),
			hint: localize('chatDebug.cache.insight.expired.hint', "Provider prompt caches expire after a few minutes of inactivity (typically ~{0} min). Long gaps between requests recompute the full prompt even when nothing changed.", TYPICAL_TTL_MINUTES),
			category: CacheBreakCategory.Expiration,
		};
	}
	return {
		severity: CacheInsightSeverity.Ok,
		title: localize('chatDebug.cache.insight.stable.title', "Prompt prefix fully stable"),
		detail: localize('chatDebug.cache.insight.stable.detail', "No divergence detected — {0}% of input tokens were served from cache.", input.hitPct.toFixed(2)),
		category: CacheBreakCategory.Healthy,
	};
}

export function categorizeCacheBreak(insights: readonly ICacheInsight[]): CacheBreakCategory {
	const primary = primaryInsight(insights);
	if (primary?.category) {
		return primary.category;
	}
	for (const i of insights) {
		if (i.category) {
			return i.category;
		}
	}
	return CacheBreakCategory.Unknown;
}

export function cacheBreakCategoryLabel(category: CacheBreakCategory): string {
	switch (category) {
		case CacheBreakCategory.Healthy: return localize('chatDebug.cache.category.healthy', "healthy growth");
		case CacheBreakCategory.Expiration: return localize('chatDebug.cache.category.expiration', "expiration / not cacheable");
		case CacheBreakCategory.Model: return localize('chatDebug.cache.category.model', "model changed");
		case CacheBreakCategory.Tools: return localize('chatDebug.cache.category.tools', "tool catalog changed");
		case CacheBreakCategory.System: return localize('chatDebug.cache.category.system', "system prompt changed");
		case CacheBreakCategory.Options: return localize('chatDebug.cache.category.options', "request options changed");
		case CacheBreakCategory.History: return localize('chatDebug.cache.category.history', "history rewritten");
		case CacheBreakCategory.Unknown: return localize('chatDebug.cache.category.unknown', "not classified");
	}
}

const AVOIDABLE_CATEGORIES: readonly CacheBreakCategory[] = [
	CacheBreakCategory.Model,
	CacheBreakCategory.Tools,
	CacheBreakCategory.System,
	CacheBreakCategory.Options,
	CacheBreakCategory.History,
];

export interface ISessionPairOutcome {
	readonly turnIndex: number;
	readonly category: CacheBreakCategory;
	readonly lostTokens: number;
}

export interface ISessionCategoryStat {
	readonly category: CacheBreakCategory;
	readonly count: number;
	readonly lostTokens: number;
}

export interface ISessionTurnTokens {
	readonly inputTokens: number;
	readonly cachedTokens: number;
}

export interface ISessionOverallHit {
	readonly inputTokens: number;
	readonly cachedTokens: number;
	readonly hitPct: number;
	readonly turnCount: number;
}

export interface ISessionCacheReport {
	readonly pairCount: number;
	readonly healthyCount: number;
	readonly avoidableLostTokens: number;
	readonly overall: ISessionOverallHit | undefined;
	readonly byCategory: readonly ISessionCategoryStat[];
	readonly causeByTurnIndex: ReadonlyMap<number, CacheBreakCategory>;
	readonly findings: readonly ICacheInsight[];
}

const RECURRING_THRESHOLD = 2;

export function buildSessionCacheReport(pairs: readonly ISessionPairOutcome[], turnTokens: readonly ISessionTurnTokens[] = []): ISessionCacheReport {
	let overallInput = 0;
	let overallCached = 0;
	let overallTurns = 0;
	for (const t of turnTokens) {
		if (t.inputTokens > 0) {
			overallInput += t.inputTokens;
			overallCached += Math.min(t.cachedTokens, t.inputTokens);
			overallTurns++;
		}
	}
	const overall: ISessionOverallHit | undefined = overallInput > 0
		? { inputTokens: overallInput, cachedTokens: overallCached, hitPct: (overallCached / overallInput) * 100, turnCount: overallTurns }
		: undefined;

	const stats = new Map<CacheBreakCategory, { count: number; lostTokens: number }>();
	const causeByTurnIndex = new Map<number, CacheBreakCategory>();
	let healthyCount = 0;
	let avoidableLostTokens = 0;
	for (const pair of pairs) {
		causeByTurnIndex.set(pair.turnIndex, pair.category);
		if (pair.category === CacheBreakCategory.Healthy) {
			healthyCount++;
			continue;
		}
		const stat = stats.get(pair.category) ?? { count: 0, lostTokens: 0 };
		stat.count++;
		stat.lostTokens += pair.lostTokens;
		stats.set(pair.category, stat);
		if (AVOIDABLE_CATEGORIES.includes(pair.category)) {
			avoidableLostTokens += pair.lostTokens;
		}
	}

	const byCategory = [...stats.entries()]
		.map(([category, s]) => ({ category, count: s.count, lostTokens: s.lostTokens }))
		.sort((a, b) => b.lostTokens - a.lostTokens);

	const findings: ICacheInsight[] = [];
	for (const stat of byCategory) {
		if (stat.count < RECURRING_THRESHOLD) {
			continue;
		}
		if (AVOIDABLE_CATEGORIES.includes(stat.category)) {
			findings.push({
				severity: CacheInsightSeverity.Critical,
				title: localize('chatDebug.cache.session.recurring.title', "Recurring invalidator: {0} in {1} of {2} request pairs", cacheBreakCategoryLabel(stat.category), fmt(stat.count), fmt(pairs.length)),
				detail: localize('chatDebug.cache.session.recurring.detail', "~{0} tokens recomputed across those requests. A break that repeats is systemic — look for the same root cause on every occurrence.", fmt(stat.lostTokens)),
				category: stat.category,
			});
		} else if (stat.category === CacheBreakCategory.Expiration) {
			findings.push({
				severity: CacheInsightSeverity.Warning,
				title: localize('chatDebug.cache.session.expiration.title', "Cache likely expired {0} times", fmt(stat.count)),
				detail: localize('chatDebug.cache.session.expiration.detail', "~{0} tokens recomputed after idle gaps or on prompts below the cacheable minimum.", fmt(stat.lostTokens)),
				hint: localize('chatDebug.cache.session.expiration.hint', "If long gaps are inherent to the workflow, consider a longer-TTL cache or pre-warming before the user returns."),
				category: stat.category,
			});
		}
	}
	if (findings.length === 0 && pairs.length > 0 && healthyCount === pairs.length) {
		findings.push({
			severity: CacheInsightSeverity.Ok,
			title: localize('chatDebug.cache.session.allHealthy.title', "All request pairs grew the prefix cleanly"),
			detail: localize('chatDebug.cache.session.allHealthy.detail', "Every request either appended new messages or matched the previous prompt exactly — no avoidable cache breaks in this session."),
			category: CacheBreakCategory.Healthy,
		});
	}

	return { pairCount: pairs.length, healthyCount, avoidableLostTokens, overall, byCategory, causeByTurnIndex, findings };
}
