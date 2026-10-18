/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ILanguageModelChatMetadata } from './languageModels.js';

const MAX_SELECTORS = 32;

export const MAX_ID_LENGTH = 64;

export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseExpPayloadEnvelope(raw: string | undefined, version: number): Record<string, unknown> | string {
	if (typeof raw !== 'string' || !raw.trim()) {
		return 'empty payload';
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		return `payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
	}

	if (!isObject(parsed)) {
		return 'payload is not an object';
	}
	if (parsed.version !== version) {
		return `unsupported version ${JSON.stringify(parsed.version)}, expected ${version}`;
	}
	return parsed;
}

export function readText(raw: unknown, maxLength: number, pattern?: RegExp): string | undefined {
	if (typeof raw !== 'string') {
		return undefined;
	}
	const trimmed = pattern ? raw.trim().toLowerCase() : raw.trim();
	if (!trimmed || trimmed.length > maxLength || (pattern && !pattern.test(trimmed))) {
		return undefined;
	}
	return trimmed;
}

export function normalizeSelector(value: string): string {
	return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function readSelectorList(raw: unknown, path: string): string[] | string {
	if (raw === undefined) {
		return [];
	}
	if (!Array.isArray(raw)) {
		return `${path} must be an array of strings`;
	}
	if (raw.length > MAX_SELECTORS) {
		return `${path} exceeds ${MAX_SELECTORS} entries`;
	}
	const out: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== 'string') {
			return `${path} must contain only strings`;
		}
		const normalized = normalizeSelector(entry);
		if (!normalized) {
			return `${path} must not contain empty strings`;
		}
		out.push(normalized);
	}
	return out;
}

export function expandModelMatchCandidates(modelId: string | undefined, aliases?: readonly string[]): Set<string> {
	const candidates = new Set<string>();
	const add = (value: string | undefined): void => {
		const normalized = value === undefined ? '' : normalizeSelector(value);
		if (normalized) {
			candidates.add(normalized);
		}
	};

	if (modelId) {
		add(modelId);
		for (const segment of modelId.split(/[/:]/)) {
			add(segment);
		}
	}
	for (const alias of aliases ?? []) {
		add(alias);
	}

	return candidates;
}

export function modelSelectorAliases(metadata: ILanguageModelChatMetadata): string[] {
	return [metadata.id, metadata.family, metadata.name, metadata.vendor];
}
