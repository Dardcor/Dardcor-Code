/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IToolResult } from './languageModelToolsService.js';

export const IToolResultCompressor = createDecorator<IToolResultCompressor>('IToolResultCompressor');

export interface IToolResultFilterOutput {
	readonly text: string;
	readonly compressed: boolean;
}

export interface IToolResultFilter {
	readonly id: string;
	readonly toolIds: readonly string[];
	matches(toolId: string, input: unknown): boolean;
	apply(text: string, input: unknown): IToolResultFilterOutput;
}

export interface IToolResultCacheHit {
	readonly text: string;
	readonly timestamp: number;
}

export interface IToolResultCache {
	readonly id: string;
	readonly toolIds: readonly string[];
	observe(toolId: string, input: unknown): void;
	lookup(toolId: string, input: unknown): IToolResultCacheHit | undefined;
	record(toolId: string, input: unknown, text: string): void;
}

export interface IToolResultCompressor {
	readonly _serviceBrand: undefined;
	registerFilter(filter: IToolResultFilter): void;
	registerCache(cache: IToolResultCache): void;
	maybeCompress(toolId: string, input: unknown, result: IToolResult): IToolResult | undefined;
}

export function isProtectedFromCompression(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '{' && last === '}') || (first === '[' && last === ']')) {
		try {
			JSON.parse(trimmed);
			return true;
		} catch {
		}
	}
	if (/^---\s*\n/.test(trimmed) || /^\[[A-Za-z_][A-Za-z0-9_.-]*\]\s*\n/.test(trimmed)) {
		return true;
	}
	return false;
}

export const MIN_COMPRESSIBLE_LENGTH = 1024;

export function formatCompressionBanner(filterIds: readonly string[], beforeChars: number, afterChars: number): string {
	const ids = filterIds.length > 0 ? filterIds.join(', ') : 'unknown';
	return `[Output compressed by ${ids} (${beforeChars} → ${afterChars} chars). To disable, set chat.tools.compressOutput.enabled to false.]`;
}
