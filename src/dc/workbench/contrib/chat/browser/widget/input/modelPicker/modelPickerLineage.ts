/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageModelChatMetadataAndIdentifier } from '../../../../common/languageModels.js';

const VERSION_TOKEN = /^v?(\d+(?:\.\d+)*)$/;

export interface IModelLine {
	readonly line: string;
	readonly version: readonly number[];
}

export function parseModelLine(id: string): IModelLine {
	const rest: string[] = [];
	let version: readonly number[] | undefined;
	for (const token of id.split('-')) {
		const match = !version ? VERSION_TOKEN.exec(token) : undefined;
		if (match) {
			version = match[1].split('.').map(Number);
		} else {
			rest.push(token);
		}
	}
	return { line: rest.join('-'), version: version ?? [] };
}

const EARLY_ACCESS_TOKENS: ReadonlySet<string> = new Set(['eap', 'experimental']);

export function isEarlyAccessModel(id: string): boolean {
	return id.split('-').some(token => EARLY_ACCESS_TOKENS.has(token));
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

export function latestOfEachLine(
	models: readonly ILanguageModelChatMetadataAndIdentifier[],
): ILanguageModelChatMetadataAndIdentifier[] {
	const newest = new Map<string, { model: ILanguageModelChatMetadataAndIdentifier; version: readonly number[] }>();
	for (const model of models) {
		const { line, version } = parseModelLine(model.metadata.id);
		const key = `${model.metadata.vendor}/${line}`;
		const current = newest.get(key);
		if (!current || compareVersions(version, current.version) > 0) {
			newest.set(key, { model, version });
		}
	}
	return [...newest.values()].map(entry => entry.model);
}
