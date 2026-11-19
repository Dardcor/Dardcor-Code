/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface INormalizedMessage {
	readonly role: string;
	readonly name?: string;
	readonly text: string;
	readonly charLength: number;
}

export const enum CacheDiffKind {
	Identical = 'identical',
	ContentDrift = 'contentDrift',
	LengthChange = 'lengthChange',
	OnlyInA = 'onlyInA',
	OnlyInB = 'onlyInB',
}

export interface ICacheSignatureToken {
	readonly index: number;
	readonly kind: CacheDiffKind;
	readonly aRole?: string;
	readonly aName?: string;
	readonly aCharLength?: number;
	readonly bRole?: string;
	readonly bName?: string;
	readonly bCharLength?: number;
}

export interface ICacheBreak {
	readonly index: number;
	readonly kind: Exclude<CacheDiffKind, CacheDiffKind.Identical>;
}

export interface IComponentDrift {
	readonly name: string;
	readonly role?: string;
	readonly status: CacheDiffKind;
	readonly aSize: number;
	readonly bSize: number;
}

export interface ICacheDiffResult {
	readonly signature: readonly ICacheSignatureToken[];
	readonly break: ICacheBreak | undefined;
	readonly drift: readonly IComponentDrift[];
	readonly counts: {
		readonly identical: number;
		readonly contentDrift: number;
		readonly lengthChange: number;
		readonly onlyInA: number;
		readonly onlyInB: number;
	};
}

interface IRawPart {
	readonly type?: string;
	readonly content?: unknown;
	readonly name?: string;
	readonly id?: string;
	readonly arguments?: unknown;
	readonly response?: unknown;
	readonly tools?: unknown;
	readonly status?: string;
}

interface IRawMessage {
	readonly role?: string;
	readonly name?: string;
	readonly parts?: readonly IRawPart[];
}

export function parseInputMessages(inputMessagesJson: string | undefined): readonly INormalizedMessage[] {
	if (!inputMessagesJson) {
		return [];
	}
	let raw: unknown;
	try {
		raw = JSON.parse(inputMessagesJson);
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) {
		return [];
	}

	const toolNameByCallId = new Map<string, string>();
	for (const m of raw as readonly IRawMessage[]) {
		if (!m || typeof m !== 'object' || !Array.isArray(m.parts)) {
			continue;
		}
		for (const p of m.parts) {
			if (p && typeof p === 'object' && p.type === 'tool_call' && typeof p.id === 'string' && typeof p.name === 'string' && p.name) {
				toolNameByCallId.set(p.id, p.name);
			}
		}
	}

	const out: INormalizedMessage[] = [];
	for (const m of raw as readonly IRawMessage[]) {
		if (!m || typeof m !== 'object') {
			continue;
		}
		let role = typeof m.role === 'string' ? m.role : 'unknown';
		let name = typeof m.name === 'string' && m.name ? m.name : undefined;
		let text = '';
		let toolResponseName: string | undefined;
		let hasToolResponse = false;
		let hasToolCall = false;
		let hasToolSearchOutput = false;
		let hasText = false;
		if (Array.isArray(m.parts)) {
			for (const p of m.parts) {
				if (!p || typeof p !== 'object') {
					continue;
				}
				switch (p.type) {
					case undefined:
					case 'text':
					case 'reasoning':
						if (typeof p.content === 'string') {
							text += p.content;
							hasText = true;
						}
						break;
					case 'tool_call_response':
					case 'tool_result':
						if (typeof p.response === 'string') {
							text += p.response;
						} else if (p.response !== undefined) {
							text += stableStringify(p.response);
						} else if (typeof p.content === 'string') {
							text += p.content;
						} else if (p.content !== undefined) {
							text += stableStringify(p.content);
						}
						if (toolResponseName === undefined && typeof p.id === 'string') {
							toolResponseName = toolNameByCallId.get(p.id);
						}
						hasToolResponse = true;
						break;
					case 'tool_call':
						if (p.name) { text += `call:${p.name}`; }
						if (p.arguments !== undefined) { text += stableStringify(p.arguments); }
						hasToolCall = true;
						break;
					case 'tool_search_output':
						text += stableStringify({
							id: p.id,
							status: p.status,
							tools: p.tools,
						});
						hasToolSearchOutput = true;
						break;
				}
			}
		}
		if (hasToolSearchOutput && !hasText) {
			role = 'tool_search';
		} else if (hasToolResponse && !hasText) {
			role = 'tool';
			name = name ?? toolResponseName;
		} else if (hasToolCall && !hasText && role === 'assistant') {
			role = 'assistant';
		}
		if (text.length === 0 && role === 'unknown') {
			text = stableStringify(m);
		}
		out.push({ role, name, text, charLength: text.length });
	}
	return out;
}

function stableStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function messagesEqual(a: INormalizedMessage, b: INormalizedMessage): boolean {
	return a.role === b.role && a.name === b.name && a.charLength === b.charLength && a.text === b.text;
}

export function diffPromptSignature(a: readonly INormalizedMessage[], b: readonly INormalizedMessage[]): ICacheDiffResult {
	const signature: ICacheSignatureToken[] = [];
	const drift: IComponentDrift[] = [];
	const counts = { identical: 0, contentDrift: 0, lengthChange: 0, onlyInA: 0, onlyInB: 0 };
	let breakResult: ICacheBreak | undefined;
	let broken = false;

	const max = Math.max(a.length, b.length);
	for (let i = 0; i < max; i++) {
		const ai = a[i];
		const bi = b[i];

		if (ai && !bi) {
			counts.onlyInA++;
			signature.push({ index: i, kind: CacheDiffKind.OnlyInA, aRole: ai.role, aName: ai.name, aCharLength: ai.charLength });
			drift.push({ name: `messages[${i}]`, role: ai.role, status: CacheDiffKind.OnlyInA, aSize: ai.charLength, bSize: 0 });
			if (!broken) {
				broken = true;
				breakResult = { index: i, kind: CacheDiffKind.OnlyInA };
			}
			continue;
		}
		if (bi && !ai) {
			counts.onlyInB++;
			signature.push({ index: i, kind: CacheDiffKind.OnlyInB, bRole: bi.role, bName: bi.name, bCharLength: bi.charLength });
			drift.push({ name: `messages[${i}]`, role: bi.role, status: CacheDiffKind.OnlyInB, aSize: 0, bSize: bi.charLength });
			if (!broken) {
				broken = true;
				breakResult = { index: i, kind: CacheDiffKind.OnlyInB };
			}
			continue;
		}
		if (!ai || !bi) {
			continue;
		}
		if (messagesEqual(ai, bi)) {
			counts.identical++;
			signature.push({
				index: i, kind: CacheDiffKind.Identical,
				aRole: ai.role, aName: ai.name, aCharLength: ai.charLength,
				bRole: bi.role, bName: bi.name, bCharLength: bi.charLength,
			});
			continue;
		}
		const kind = ai.charLength === bi.charLength ? CacheDiffKind.ContentDrift : CacheDiffKind.LengthChange;
		if (kind === CacheDiffKind.ContentDrift) {
			counts.contentDrift++;
		} else {
			counts.lengthChange++;
		}
		signature.push({
			index: i, kind,
			aRole: ai.role, aName: ai.name, aCharLength: ai.charLength,
			bRole: bi.role, bName: bi.name, bCharLength: bi.charLength,
		});
		drift.push({ name: `messages[${i}]`, role: ai.role, status: kind, aSize: ai.charLength, bSize: bi.charLength });
		if (!broken) {
			broken = true;
			breakResult = { index: i, kind };
		}
	}

	return { signature, break: breakResult, drift, counts };
}

const PREFIX_COMPONENT_ORDER: readonly string[] = ['system', 'tools'];

function insertPrefixComponent(drift: readonly IComponentDrift[], entry: IComponentDrift): IComponentDrift[] {
	const prefixEntries: IComponentDrift[] = [];
	const rest: IComponentDrift[] = [];
	for (const d of drift) {
		if (PREFIX_COMPONENT_ORDER.includes(d.name)) {
			if (d.name !== entry.name) {
				prefixEntries.push(d);
			}
		} else {
			rest.push(d);
		}
	}
	prefixEntries.push(entry);
	prefixEntries.sort((a, b) => PREFIX_COMPONENT_ORDER.indexOf(a.name) - PREFIX_COMPONENT_ORDER.indexOf(b.name));
	return [...prefixEntries, ...rest];
}

function classifyStringDrift(a: string | undefined, b: string | undefined): CacheDiffKind | undefined {
	if (a === b) {
		return undefined;
	}
	if (!a) {
		return CacheDiffKind.OnlyInB;
	}
	if (!b) {
		return CacheDiffKind.OnlyInA;
	}
	return a.length === b.length ? CacheDiffKind.ContentDrift : CacheDiffKind.LengthChange;
}

export function appendSystemDrift(
	drift: IComponentDrift[],
	aSystem: string | undefined,
	bSystem: string | undefined,
): IComponentDrift[] {
	const status = classifyStringDrift(aSystem, bSystem);
	if (status === undefined) {
		return drift;
	}
	return insertPrefixComponent(drift, { name: 'system', status, aSize: aSystem?.length ?? 0, bSize: bSystem?.length ?? 0 });
}

export function appendToolsDrift(
	drift: IComponentDrift[],
	aTools: string | undefined,
	bTools: string | undefined,
): IComponentDrift[] {
	const status = classifyStringDrift(aTools, bTools);
	if (status === undefined) {
		return drift;
	}
	return insertPrefixComponent(drift, { name: 'tools', status, aSize: aTools?.length ?? 0, bSize: bTools?.length ?? 0 });
}

export function formatSignatureToken(token: ICacheSignatureToken): string {
	const role = token.bRole ?? token.aRole ?? 'unknown';
	const name = token.bName ?? token.aName;
	const a = token.aCharLength;
	const b = token.bCharLength;
	const sizeText = a !== undefined && b !== undefined && a !== b
		? `${a}\u2192${b}`
		: a !== undefined && b === undefined
			? `${a}\u21920`
			: a === undefined && b !== undefined
				? `0\u2192${b}`
				: `${b ?? a ?? 0}`;
	return name ? `${role}-${name}:${sizeText}` : `${role}:${sizeText}`;
}
