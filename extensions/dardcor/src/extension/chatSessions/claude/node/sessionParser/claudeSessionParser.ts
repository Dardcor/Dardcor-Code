/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import {
	AssistantMessageEntry,
	ChainNode,
	CustomTitleEntry,
	ISubagentSession,
	StoredMessage,
	SummaryEntry,
	UserMessageEntry,
	vAssistantMessageEntry,
	vChainNodeFields,
	vCustomTitleEntry,
	vSummaryEntry,
	vUserMessageEntry,
} from './claudeSessionSchema';


interface ParseError {
	lineNumber: number;
	message: string;
	line: string;
	parsedType?: string;
}

export interface LinkedListParseResult {
	readonly nodes: ReadonlyMap<string, ChainNode>;
	readonly summaries: ReadonlyMap<string, SummaryEntry>;
	readonly customTitle: CustomTitleEntry | undefined;
	readonly errors: readonly ParseError[];
	readonly stats: ParseStats;
}

interface ParseStats {
	readonly totalLines: number;
	readonly chainNodes: number;
	readonly summaries: number;
	readonly customTitles: number;
	readonly queueOperations: number;
	readonly errors: number;
	readonly skippedEmpty: number;
}



export function parseSessionFileContent(
	content: string,
	fileIdentifier?: string
): LinkedListParseResult {
	const nodes = new Map<string, ChainNode>();
	const summaries = new Map<string, SummaryEntry>();
	const errors: ParseError[] = [];
	let customTitle: CustomTitleEntry | undefined;

	const stats = {
		totalLines: 0,
		chainNodes: 0,
		summaries: 0,
		customTitles: 0,
		queueOperations: 0,
		errors: 0,
		skippedEmpty: 0,
	};

	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		stats.totalLines++;

		if (line.length === 0) {
			stats.skippedEmpty++;
			continue;
		}

		const lineNumber = i + 1;

		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (e) {
			stats.errors++;
			const message = e instanceof Error ? e.message : String(e);
			errors.push({
				lineNumber,
				message: fileIdentifier
					? `[${fileIdentifier}:${lineNumber}] JSON parse error: ${message}`
					: `JSON parse error: ${message}`,
				line: line.length > 100 ? line.substring(0, 100) + '...' : line,
			});
			continue;
		}

		if (typeof parsed !== 'object' || parsed === null) {
			stats.errors++;
			errors.push({
				lineNumber,
				message: fileIdentifier
					? `[${fileIdentifier}:${lineNumber}] Expected object, got ${typeof parsed}`
					: `Expected object, got ${typeof parsed}`,
				line: line.length > 100 ? line.substring(0, 100) + '...' : line,
			});
			continue;
		}

		const raw = parsed as Record<string, unknown>;

		const customTitleResult = vCustomTitleEntry.validate(parsed);
		if (!customTitleResult.error) {
			stats.customTitles++;
			customTitle = customTitleResult.content;
			continue;
		}

		const summaryResult = vSummaryEntry.validate(parsed);
		if (!summaryResult.error) {
			stats.summaries++;
			const summary = summaryResult.content.summary.toLowerCase();
			if (!summary.startsWith('api error:') && !summary.startsWith('invalid api key')) {
				summaries.set(summaryResult.content.leafUuid, summaryResult.content);
			}
			continue;
		}

		const chainResult = vChainNodeFields.validate(parsed);
		if (!chainResult.error) {
			stats.chainNodes++;
			const { uuid, logicalParentUuid, parentUuid } = chainResult.content;
			nodes.set(uuid, {
				uuid,
				parentUuid: logicalParentUuid ?? parentUuid ?? null,
				raw,
				lineNumber,
			});
			continue;
		}

		if ('type' in raw && raw.type === 'queue-operation') {
			stats.queueOperations++;
		} else {
			stats.queueOperations++;
		}
	}

	return {
		nodes,
		summaries,
		customTitle,
		errors,
		stats,
	};
}



function isVisibleNode(raw: Record<string, unknown>): boolean {
	const hasMessage = 'message' in raw && (raw.type === 'user' || raw.type === 'assistant');
	const hasSystemContent = typeof raw.content === 'string' && (raw.content as string).length > 0 && raw.type !== 'user' && raw.type !== 'assistant';
	if (!hasMessage && !hasSystemContent) {
		return false;
	}
	if (raw.isCompactSummary === true) {
		return false;
	}
	if (raw.isVisibleInTranscriptOnly === true) {
		return false;
	}
	if (raw.isMeta === true) {
		return false;
	}
	return true;
}

function validateAndReviveNode(node: ChainNode): StoredMessage | null {
	const raw = node.raw;

	if (raw.type === 'user') {
		const result = vUserMessageEntry.validate(raw);
		if (result.error) {
			return null;
		}
		return reviveUserMessage(result.content);
	}

	if (raw.type === 'assistant') {
		const result = vAssistantMessageEntry.validate(raw);
		if (result.error) {
			return null;
		}
		return reviveAssistantMessage(result.content);
	}

	if (typeof raw.content === 'string') {
		return reviveSystemMessage(node);
	}

	return null;
}



function reviveUserMessage(entry: UserMessageEntry): StoredMessage {
	return {
		uuid: entry.uuid,
		sessionId: entry.sessionId,
		timestamp: new Date(entry.timestamp),
		parentUuid: entry.parentUuid ?? null,
		type: 'user',
		message: entry.message,
		isSidechain: entry.isSidechain,
		userType: entry.userType,
		cwd: entry.cwd,
		version: entry.version,
		gitBranch: entry.gitBranch,
		slug: entry.slug,
		agentId: entry.agentId,
	};
}

function reviveAssistantMessage(entry: AssistantMessageEntry): StoredMessage {
	return {
		uuid: entry.uuid,
		sessionId: entry.sessionId,
		timestamp: new Date(entry.timestamp),
		parentUuid: entry.parentUuid ?? null,
		type: 'assistant',
		message: entry.message,
		isSidechain: entry.isSidechain,
		userType: entry.userType,
		cwd: entry.cwd,
		version: entry.version,
		gitBranch: entry.gitBranch,
		slug: entry.slug,
		agentId: entry.agentId,
	};
}

function reviveSystemMessage(node: ChainNode): StoredMessage | null {
	const raw = node.raw;
	const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : undefined;
	const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : undefined;
	const content = typeof raw.content === 'string' ? raw.content : undefined;

	if (!sessionId || !timestamp || !content) {
		return null;
	}

	return {
		uuid: node.uuid,
		sessionId,
		timestamp: new Date(timestamp),
		parentUuid: node.parentUuid,
		type: 'system',
		message: { role: 'system', content },
		version: typeof raw.version === 'string' ? raw.version : undefined,
	};
}



export function buildSubagentSession(
	agentId: string,
	parseResult: LinkedListParseResult
): ISubagentSession | null {
	const { nodes } = parseResult;

	const referencedAsParent = new Set<string>();
	for (const node of nodes.values()) {
		if (node.parentUuid !== null) {
			referencedAsParent.add(node.parentUuid);
		}
	}

	const leafUuids: string[] = [];
	for (const uuid of nodes.keys()) {
		if (!referencedAsParent.has(uuid)) {
			leafUuids.push(uuid);
		}
	}

	if (leafUuids.length === 0) {
		return null;
	}

	let bestChain: StoredMessage[] = [];

	for (const leafUuid of leafUuids) {
		const chain: StoredMessage[] = [];
		const visited = new Set<string>();
		let currentUuid: string | null = leafUuid;

		while (currentUuid !== null) {
			if (visited.has(currentUuid)) {
				break;
			}
			visited.add(currentUuid);

			const node = nodes.get(currentUuid);
			if (node === undefined) {
				break;
			}

			if (isVisibleNode(node.raw)) {
				const storedMessage = validateAndReviveNode(node);
				if (storedMessage !== null) {
					chain.unshift(storedMessage);
				}
			}

			currentUuid = node.parentUuid;
		}

		if (chain.length > bestChain.length) {
			bestChain = chain;
		}
	}

	if (bestChain.length === 0) {
		return null;
	}

	return {
		agentId,
		messages: bestChain,
		timestamp: bestChain[bestChain.length - 1].timestamp,
	};
}

