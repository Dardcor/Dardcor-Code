/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { IChatDebugEvent } from '../../common/chatDebugService.js';


export interface FlowNode {
	readonly id: string;
	readonly kind: IChatDebugEvent['kind'];
	readonly category?: string;
	readonly label: string;
	readonly sublabel?: string;
	readonly description?: string;
	readonly tooltip?: string;
	readonly isError?: boolean;
	readonly created: number;
	readonly children: FlowNode[];
	readonly mergedNodes?: FlowNode[];
}

export interface FlowFilterOptions {
	readonly isKindVisible: (kind: string, category?: string) => boolean;
	readonly textFilter: string;
}

export interface LayoutNode {
	readonly id: string;
	readonly kind: IChatDebugEvent['kind'];
	readonly label: string;
	readonly sublabel?: string;
	readonly tooltip?: string;
	readonly isError?: boolean;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly mergedCount?: number;
	readonly isMergedExpanded?: boolean;
}

export interface LayoutEdge {
	readonly fromId?: string;
	readonly toId?: string;
	readonly fromX: number;
	readonly fromY: number;
	readonly toX: number;
	readonly toY: number;
}

export interface SubgraphRect {
	readonly label: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly depth: number;
	readonly nodeId: string;
	readonly collapsedChildCount?: number;
}

export interface FlowLayout {
	readonly nodes: LayoutNode[];
	readonly edges: LayoutEdge[];
	readonly subgraphs: SubgraphRect[];
	readonly width: number;
	readonly height: number;
}

export interface FlowChartRenderResult {
	readonly svg: SVGElement;
	readonly focusableElements: Map<string, SVGElement>;
	readonly adjacency: Map<string, { next: string[]; prev: string[] }>;
	readonly positions: Map<string, { x: number; y: number }>;
}


function truncateLabel(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return text.substring(0, maxLength - 1) + '\u2026';
}

export function buildFlowGraph(events: readonly IChatDebugEvent[]): FlowNode[] {
	const subagentToolNames = ['runSubagent', 'search_subagent'];

	function isSubagentName(name: string): boolean {
		for (const toolName of subagentToolNames) {
			if (name === toolName) {
				return true;
			}
			if (name.startsWith(toolName)) {
				const nextChar = name[toolName.length];
				if (nextChar === '-' || nextChar === ' ' || nextChar === '(' || nextChar === ':') {
					return true;
				}
			}
		}
		return false;
	}

	const emojiPrefixRe = /^\u{1F6E0}\uFE0F?\s*/u;
	function stripToolEmoji(name: string): string {
		return name.replace(emojiPrefixRe, '');
	}

	const completionDescsByParent = new Map<string, string[]>();
	const startedCountByParent = new Map<string, number>();
	for (const e of events) {
		if (e.kind === 'subagentInvocation' && isSubagentName(e.agentName) && e.description && e.parentEventId) {
			let descs = completionDescsByParent.get(e.parentEventId);
			if (!descs) {
				descs = [];
				completionDescsByParent.set(e.parentEventId, descs);
			}
			descs.push(e.description);
		}
	}

	function getSubagentDescription(event: IChatDebugEvent): string | undefined {
		if (event.kind !== 'subagentInvocation' || !event.parentEventId) {
			return undefined;
		}
		const descs = completionDescsByParent.get(event.parentEventId);
		if (!descs || descs.length === 0) {
			return event.description && event.description !== event.agentName ? event.description : undefined;
		}
		const idx = startedCountByParent.get(event.parentEventId) ?? 0;
		startedCountByParent.set(event.parentEventId, idx + 1);
		return descs[idx] ?? descs[0];
	}

	const filtered = events.filter(e => {
		if (e.kind === 'subagentInvocation' && isSubagentName(e.agentName)) {
			return false;
		}
		return true;
	});

	const idToEvent = new Map<string, IChatDebugEvent>();
	const idToChildren = new Map<string, IChatDebugEvent[]>();
	const roots: IChatDebugEvent[] = [];

	for (const event of filtered) {
		if (event.id) {
			idToEvent.set(event.id, event);
		}
	}

	for (const event of filtered) {
		if (event.parentEventId && idToEvent.has(event.parentEventId)) {
			let children = idToChildren.get(event.parentEventId);
			if (!children) {
				children = [];
				idToChildren.set(event.parentEventId, children);
			}
			children.push(event);
		} else {
			roots.push(event);
		}
	}

	const byCreated = (a: IChatDebugEvent, b: IChatDebugEvent): number => a.created.getTime() - b.created.getTime();
	roots.sort(byCreated);
	for (const children of idToChildren.values()) {
		children.sort(byCreated);
	}

	function toFlowNode(event: IChatDebugEvent): FlowNode {
		const children = event.id ? idToChildren.get(event.id) : undefined;

		const effectiveKind = getEffectiveKind(event);

		let label = getEventLabel(event, effectiveKind);
		const sublabel = getEventSublabel(event, effectiveKind);
		let tooltip = getEventTooltip(event);
		let description: string | undefined;
		if (effectiveKind === 'subagentInvocation') {
			description = getSubagentDescription(event);
			const cleanDesc = description?.replace(/^Subagent:\s*/i, '');
			label = cleanDesc
				? localize('subagentWithDesc', "Subagent: {0}", truncateLabel(cleanDesc, 30))
				: localize('subagentLabel', "Subagent");
			if (description) {
				if (tooltip && !tooltip.includes(description)) {
					const lines = tooltip.split('\n');
					lines.splice(1, 0, description);
					tooltip = lines.join('\n');
				}
			}
		}

		return {
			id: event.id ?? `event-${events.indexOf(event)}`,
			kind: effectiveKind,
			category: event.kind === 'generic' ? event.category : undefined,
			label,
			sublabel,
			description,
			tooltip,
			isError: isErrorEvent(event),
			created: event.created.getTime(),
			children: children?.map(toFlowNode) ?? [],
		};
	}

	const rawNodes = roots.map(toFlowNode);

	return collapseSubagentToolCalls(rawNodes);

	function collapseSubagentToolCalls(nodeList: FlowNode[]): FlowNode[] {
		let changed = false;
		const result: FlowNode[] = [];
		for (const node of nodeList) {
			if (node.kind === 'toolCall' && isSubagentName(stripToolEmoji(node.label))) {
				changed = true;
				const flatChildren = flattenChildSessionRefs(node.children);
				const subagentChildren = flatChildren.filter(c => c.kind === 'subagentInvocation');
				if (subagentChildren.length > 0) {
					const otherChildren = flatChildren.filter(c => c.kind !== 'subagentInvocation');
					for (let i = 0; i < subagentChildren.length; i++) {
						const extra = i === 0 ? otherChildren : [];
						result.push({
							...subagentChildren[i],
							children: collapseSubagentToolCalls(
								[...subagentChildren[i].children, ...extra]
							),
						});
					}
				} else {
					result.push(...collapseSubagentToolCalls(flatChildren));
				}
			} else {
				const newChildren = collapseSubagentToolCalls(node.children);
				if (newChildren !== node.children) {
					changed = true;
					result.push({ ...node, children: newChildren });
				} else {
					result.push(node);
				}
			}
		}
		return changed ? result : nodeList;
	}

	function flattenChildSessionRefs(nodeList: FlowNode[]): FlowNode[] {
		if (!nodeList.some(n => n.kind === 'generic' && n.category === 'subagent')) {
			return nodeList;
		}
		const result: FlowNode[] = [];
		for (const node of nodeList) {
			if (node.kind === 'generic' && node.category === 'subagent') {
				const subagentChild = node.children.find(c => c.kind === 'subagentInvocation');
				if (subagentChild) {
					const siblings = node.children.filter(c => c !== subagentChild);
					result.push({
						...subagentChild,
						children: [...subagentChild.children, ...siblings],
					});
				} else {
					result.push(...node.children);
				}
			} else {
				result.push(node);
			}
		}
		return result;
	}
}


export function filterFlowNodes(nodes: FlowNode[], options: FlowFilterOptions): FlowNode[] {
	let result = filterByKind(nodes, options.isKindVisible);
	if (options.textFilter) {
		result = filterByText(result, options.textFilter);
	}
	return result;
}

function filterByKind(nodes: FlowNode[], isKindVisible: (kind: string, category?: string) => boolean): FlowNode[] {
	const result: FlowNode[] = [];
	let changed = false;
	for (const node of nodes) {
		if (!isKindVisible(node.kind, node.category)) {
			changed = true;
			if (node.kind === 'subagentInvocation') {
				continue;
			}
			result.push(...filterByKind(node.children, isKindVisible));
			continue;
		}
		const filteredChildren = filterByKind(node.children, isKindVisible);
		if (filteredChildren !== node.children) {
			changed = true;
			result.push({ ...node, children: filteredChildren });
		} else {
			result.push(node);
		}
	}
	return changed ? result : nodes;
}


function nodeMatchesText(node: FlowNode, text: string): boolean {
	return node.label.toLowerCase().includes(text) ||
		(node.sublabel?.toLowerCase().includes(text) ?? false) ||
		(node.tooltip?.toLowerCase().includes(text) ?? false);
}

function filterByText(nodes: FlowNode[], text: string): FlowNode[] {
	const result: FlowNode[] = [];
	for (const node of nodes) {
		if (nodeMatchesText(node, text)) {
			result.push(node);
			continue;
		}
		const filteredChildren = filterByText(node.children, text);
		if (filteredChildren.length > 0) {
			result.push({ ...node, children: filteredChildren });
		}
	}
	return result;
}


export interface FlowSliceResult {
	readonly nodes: FlowNode[];
	readonly totalCount: number;
	readonly shownCount: number;
}

function countNodes(nodes: readonly FlowNode[]): number {
	let count = 0;
	for (const node of nodes) {
		count += 1 + countNodes(node.children);
	}
	return count;
}

export function sliceFlowNodes(nodes: readonly FlowNode[], maxCount: number): FlowSliceResult {
	const totalCount = countNodes(nodes);
	if (totalCount <= maxCount) {
		return { nodes: nodes as FlowNode[], totalCount, shownCount: totalCount };
	}

	let remaining = maxCount;

	function sliceTree(nodeList: readonly FlowNode[]): FlowNode[] {
		const result: FlowNode[] = [];
		for (const node of nodeList) {
			if (remaining <= 0) {
				break;
			}
			remaining--;
			if (node.children.length === 0 || remaining <= 0) {
				result.push(node.children.length === 0 ? node : { ...node, children: [] });
			} else {
				const slicedChildren = sliceTree(node.children);
				result.push(slicedChildren !== node.children ? { ...node, children: slicedChildren } : node);
			}
		}
		return result;
	}

	const sliced = sliceTree(nodes);
	const shownCount = maxCount - remaining;
	return { nodes: sliced, totalCount, shownCount };
}


function isDiscoveryNode(node: FlowNode): boolean {
	return node.kind === 'generic' && node.category === 'discovery';
}

export function mergeDiscoveryNodes(
	nodes: readonly FlowNode[],
): FlowNode[] {
	const result: FlowNode[] = [];

	let i = 0;
	while (i < nodes.length) {
		const node = nodes[i];

		if (!isDiscoveryNode(node)) {
			const mergedChildren = mergeDiscoveryNodes(node.children);
			result.push(mergedChildren !== node.children ? { ...node, children: mergedChildren } : node);
			i++;
			continue;
		}

		const run: FlowNode[] = [node];
		let j = i + 1;
		while (j < nodes.length && isDiscoveryNode(nodes[j])) {
			run.push(nodes[j]);
			j++;
		}

		if (run.length < 2) {
			result.push(node);
			i = j;
			continue;
		}

		const mergedId = `merged-discovery:${run[0].id}`;

		const labels = run.map(n => n.label);
		const uniqueLabels = [...new Set(labels)];
		const summaryLabel = uniqueLabels.length <= 2
			? uniqueLabels.join(', ')
			: localize('discoveryMergedLabel', "{0} +{1} more", uniqueLabels[0], run.length - 1);

		result.push({
			id: mergedId,
			kind: 'generic',
			category: 'discovery',
			label: summaryLabel,
			sublabel: localize('discoveryStepsCount', "{0} discovery steps", run.length),
			tooltip: run.map(n => n.label + (n.sublabel ? `: ${n.sublabel}` : '')).join('\n'),
			created: run[0].created,
			children: [],
			mergedNodes: run,
		});
		i = j;
	}

	return result;
}


function isToolCallNode(node: FlowNode): boolean {
	return node.kind === 'toolCall';
}

function getToolName(node: FlowNode): string {
	return node.label;
}

export function mergeToolCallNodes(
	nodes: readonly FlowNode[],
): FlowNode[] {
	const result: FlowNode[] = [];

	let i = 0;
	while (i < nodes.length) {
		const node = nodes[i];

		if (!isToolCallNode(node)) {
			const mergedChildren = mergeToolCallNodes(node.children);
			result.push(mergedChildren !== node.children ? { ...node, children: mergedChildren } : node);
			i++;
			continue;
		}

		const toolName = getToolName(node);
		const run: FlowNode[] = [node];
		let j = i + 1;
		while (j < nodes.length && isToolCallNode(nodes[j]) && getToolName(nodes[j]) === toolName) {
			run.push(nodes[j]);
			j++;
		}

		if (run.length < 2) {
			const mergedChildren = mergeToolCallNodes(node.children);
			result.push(mergedChildren !== node.children ? { ...node, children: mergedChildren } : node);
			i = j;
			continue;
		}

		const mergedId = `merged-toolCall:${run[0].id}`;

		result.push({
			id: mergedId,
			kind: 'toolCall',
			label: toolName,
			sublabel: localize('toolCallsCount', "{0} calls", run.length),
			tooltip: run.map(n => n.label + (n.sublabel ? `: ${n.sublabel}` : '')).join('\n'),
			created: run[0].created,
			children: [],
			mergedNodes: run,
		});
		i = j;
	}

	return result;
}


function getEffectiveKind(event: IChatDebugEvent): IChatDebugEvent['kind'] {
	if (event.kind === 'generic') {
		const name = event.name.toLowerCase().replace(/[\s_-]+/g, '');
		if (name === 'usermessage' || name === 'userprompt' || name === 'user' || name.startsWith('usermessage')) {
			return 'userMessage';
		}
		if (name === 'response' || name.startsWith('agentresponse') || name.startsWith('assistantresponse') || name.startsWith('modelresponse')) {
			return 'agentResponse';
		}
		const cat = event.category?.toLowerCase();
		if (cat === 'user' || cat === 'usermessage') {
			return 'userMessage';
		}
		if (cat === 'response' || cat === 'agentresponse') {
			return 'agentResponse';
		}
	}
	return event.kind;
}

function getEventLabel(event: IChatDebugEvent, effectiveKind?: IChatDebugEvent['kind']): string {
	const kind = effectiveKind ?? event.kind;
	switch (kind) {
		case 'userMessage':
			return localize('userLabel', "User Message");
		case 'modelTurn':
			return event.kind === 'modelTurn' ? (event.model ?? localize('modelTurnLabel', "Model Turn")) : localize('modelTurnLabel', "Model Turn");
		case 'toolCall':
			return event.kind === 'toolCall' ? event.toolName : event.kind === 'generic' ? event.name : localize('toolCallLabel', "Tool Call");
		case 'subagentInvocation':
			return event.kind === 'subagentInvocation' ? event.agentName : localize('subagentFallback', "Subagent");
		case 'agentResponse':
			return localize('agentResponseLabel', "Agent Response");
		case 'generic':
			return event.kind === 'generic' ? event.name : localize('genericLabel', "Event");
	}
}

function getEventSublabel(event: IChatDebugEvent, effectiveKind?: IChatDebugEvent['kind']): string | undefined {
	const kind = effectiveKind ?? event.kind;
	switch (kind) {
		case 'modelTurn': {
			const parts: string[] = [];
			if (event.kind === 'modelTurn' && event.requestName) {
				parts.push(event.requestName);
			}
			if (event.kind === 'modelTurn' && event.totalTokens) {
				parts.push(localize('tokenCount', "{0} tokens", event.totalTokens));
			}
			if (event.kind === 'modelTurn' && event.durationInMillis) {
				parts.push(formatDuration(event.durationInMillis));
			}
			return parts.length > 0 ? parts.join(' \u00b7 ') : undefined;
		}
		case 'toolCall': {
			const parts: string[] = [];
			if (event.kind === 'toolCall' && event.result) {
				parts.push(event.result);
			}
			if (event.kind === 'toolCall' && event.durationInMillis) {
				parts.push(formatDuration(event.durationInMillis));
			}
			return parts.length > 0 ? parts.join(' \u00b7 ') : undefined;
		}
		case 'subagentInvocation': {
			const parts: string[] = [];
			if (event.kind === 'subagentInvocation' && event.status) {
				parts.push(event.status);
			}
			if (event.kind === 'subagentInvocation' && event.durationInMillis) {
				parts.push(formatDuration(event.durationInMillis));
			}
			return parts.length > 0 ? parts.join(' \u00b7 ') : undefined;
		}
		case 'userMessage':
		case 'agentResponse': {
			let text: string | undefined;
			if (event.kind === 'userMessage' || event.kind === 'agentResponse') {
				text = event.message;
			} else if (event.kind === 'generic') {
				text = event.details;
			}
			if (!text) {
				return undefined;
			}
			const lines = text.split('\n');
			let firstLine = '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed && trimmed.length > 2) {
					firstLine = trimmed;
					break;
				}
			}
			if (!firstLine) {
				firstLine = text.replace(/\s+/g, ' ').trim();
			}
			if (!firstLine) {
				return undefined;
			}
			return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
		}
		default:
			return undefined;
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

function isErrorEvent(event: IChatDebugEvent): boolean {
	return (event.kind === 'toolCall' && event.result === 'error') ||
		(event.kind === 'generic' && event.level === 3 ) ||
		(event.kind === 'subagentInvocation' && event.status === 'failed');
}

const TOOLTIP_MAX_LENGTH = 500;

function getEventTooltip(event: IChatDebugEvent): string | undefined {
	switch (event.kind) {
		case 'userMessage': {
			const msg = event.message.trim();
			if (msg.length > TOOLTIP_MAX_LENGTH) {
				return msg.substring(0, TOOLTIP_MAX_LENGTH) + '\u2026';
			}
			return msg || undefined;
		}
		case 'toolCall': {
			const parts: string[] = [event.toolName];
			if (event.input) {
				const input = event.input.trim();
				parts.push(localize('tooltipInput', "Input: {0}", input.length > TOOLTIP_MAX_LENGTH ? input.substring(0, TOOLTIP_MAX_LENGTH) + '\u2026' : input));
			}
			if (event.output) {
				const output = event.output.trim();
				parts.push(localize('tooltipOutput', "Output: {0}", output.length > TOOLTIP_MAX_LENGTH ? output.substring(0, TOOLTIP_MAX_LENGTH) + '\u2026' : output));
			}
			if (event.result) {
				parts.push(localize('tooltipResult', "Result: {0}", event.result));
			}
			return parts.join('\n');
		}
		case 'subagentInvocation': {
			const parts: string[] = [event.agentName];
			if (event.description) {
				parts.push(event.description);
			}
			if (event.status) {
				parts.push(localize('tooltipStatus', "Status: {0}", event.status));
			}
			if (event.toolCallCount !== undefined) {
				parts.push(localize('tooltipToolCalls', "Tool calls: {0}", event.toolCallCount));
			}
			if (event.modelTurnCount !== undefined) {
				parts.push(localize('tooltipModelTurns', "Model turns: {0}", event.modelTurnCount));
			}
			return parts.join('\n');
		}
		case 'generic': {
			if (event.details) {
				const details = event.details.trim();
				return details.length > TOOLTIP_MAX_LENGTH ? details.substring(0, TOOLTIP_MAX_LENGTH) + '\u2026' : details;
			}
			return undefined;
		}
		case 'modelTurn': {
			const parts: string[] = [];
			if (event.model) {
				parts.push(event.model);
			}
			if (event.totalTokens !== undefined) {
				parts.push(localize('tooltipTokens', "Tokens: {0}", event.totalTokens));
			}
			if (event.inputTokens !== undefined) {
				parts.push(localize('tooltipInputTokens', "Input tokens: {0}", event.inputTokens));
			}
			if (event.outputTokens !== undefined) {
				parts.push(localize('tooltipOutputTokens', "Output tokens: {0}", event.outputTokens));
			}
			if (event.cachedTokens !== undefined) {
				parts.push(localize('tooltipCachedTokens', "Cached tokens: {0}", event.cachedTokens));
			}
			if (event.durationInMillis !== undefined) {
				parts.push(localize('tooltipDuration', "Duration: {0}", formatDuration(event.durationInMillis)));
			}
			return parts.length > 0 ? parts.join('\n') : undefined;
		}
		default:
			return undefined;
	}
}
