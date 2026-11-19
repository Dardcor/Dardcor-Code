/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface ParsedClaudeModelId {
	readonly name: string;
	readonly version: string;
	readonly modifiers: string;
	toSdkModelId(): string;
	toEndpointModelId(): string;
}

const VALID_SUFFIXES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	['opus', new Set(['1m'])],
]);

const cache = new Map<string, ParsedClaudeModelId | undefined>();

export function parseClaudeModelId(modelId: string): ParsedClaudeModelId {
	const result = tryParseClaudeModelId(modelId);
	if (!result) {
		throw new Error(`Unable to parse Claude model ID: '${modelId}'`);
	}
	return result;
}

export function toSdkModelId(modelId: string): string;
export function toSdkModelId(modelId: string | undefined): string | undefined;
export function toSdkModelId(modelId: string | undefined): string | undefined {
	if (modelId === undefined) {
		return undefined;
	}
	return tryParseClaudeModelId(modelId)?.toSdkModelId() ?? modelId;
}

export function tryParseClaudeModelId(modelId: string): ParsedClaudeModelId | undefined {
	const cacheKey = modelId.toLowerCase();
	if (cache.has(cacheKey)) {
		return cache.get(cacheKey);
	}

	const result = doParse(cacheKey);
	cache.set(cacheKey, result);
	return result;
}

const DATE_SUFFIX_RE = /^(?<base>.*)-(?<date>\d{8})$/;

function doParse(lower: string): ParsedClaudeModelId | undefined {
	let dateSuffix = '';
	let base = lower;

	const dateMatch = DATE_SUFFIX_RE.exec(lower);
	if (dateMatch?.groups) {
		base = dateMatch.groups.base;
		dateSuffix = dateMatch.groups.date;
	}

	const p1 = base.match(/^claude-(?<name>\w+)-(?<major>\d+)-(?<minor>\d+)(?:-(?<mod>.+))?$/);
	if (p1?.groups) {
		return makeResult(p1.groups.name, p1.groups.major, p1.groups.minor, joinModifiers(p1.groups.mod, dateSuffix));
	}

	const p2 = base.match(/^claude-(?<major>\d+)-(?<minor>\d+)-(?<name>\w+)(?:-(?<mod>.+))?$/);
	if (p2?.groups) {
		return makeResult(p2.groups.name, p2.groups.major, p2.groups.minor, joinModifiers(p2.groups.mod, dateSuffix));
	}

	const p3 = base.match(/^claude-(?<name>\w+)-(?<major>\d+)\.(?<minor>\d+)(?:-(?<mod>.+))?$/);
	if (p3?.groups) {
		return makeResult(p3.groups.name, p3.groups.major, p3.groups.minor, joinModifiers(p3.groups.mod, dateSuffix));
	}

	const p4 = base.match(/^claude-(?<name>\w+)-(?<major>\d+)(?:-(?<mod>.+))?$/);
	if (p4?.groups) {
		return makeResult(p4.groups.name, p4.groups.major, undefined, joinModifiers(p4.groups.mod, dateSuffix));
	}

	const p5 = base.match(/^claude-(?<major>\d+)-(?<name>\w+)(?:-(?<mod>.+))?$/);
	if (p5?.groups) {
		return makeResult(p5.groups.name, p5.groups.major, undefined, joinModifiers(p5.groups.mod, dateSuffix));
	}

	const p6 = base.match(/^(?<name>\w+)$/);
	if (p6?.groups) {
		return makeBareResult(p6.groups.name);
	}

	return undefined;
}

function joinModifiers(mod: string | undefined, dateSuffix: string): string {
	if (mod && dateSuffix) {
		return `${mod}-${dateSuffix}`;
	}
	return mod || dateSuffix;
}

function formatModelId(name: string, major: string, minor: string | undefined, versionSep: string, validSuffix: string): string {
	const base = minor !== undefined
		? `claude-${name}-${major}${versionSep}${minor}`
		: `claude-${name}-${major}`;
	return validSuffix ? `${base}-${validSuffix}` : base;
}

function makeBareResult(name: string): ParsedClaudeModelId {
	return {
		name,
		version: '',
		modifiers: '',
		toSdkModelId: () => name,
		toEndpointModelId: () => name,
	};
}

function makeResult(name: string, major: string, minor: string | undefined, modifiers: string): ParsedClaudeModelId {
	const version = minor !== undefined ? `${major}.${minor}` : major;
	const validSuffix = extractValidSuffix(name, modifiers);
	return {
		name,
		version,
		modifiers,
		toSdkModelId: () => formatModelId(name, major, minor, '-', validSuffix),
		toEndpointModelId: () => formatModelId(name, major, minor, '.', validSuffix),
	};
}

function extractValidSuffix(name: string, modifiers: string): string {
	if (!modifiers) {
		return '';
	}
	const allowedSuffixes = VALID_SUFFIXES.get(name);
	if (!allowedSuffixes) {
		return '';
	}
	if (allowedSuffixes.has(modifiers)) {
		return modifiers;
	}
	const firstSegment = modifiers.split('-')[0];
	if (allowedSuffixes.has(firstSegment)) {
		return firstSegment;
	}
	return '';
}
