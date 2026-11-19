/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { SimilarFilesOptions } from './snippetInclusion/similarFiles';


export const DEFAULT_MAX_COMPLETION_LENGTH = 500;

export const DEFAULT_MAX_PROMPT_LENGTH = 8192 - DEFAULT_MAX_COMPLETION_LENGTH;

export const DEFAULT_NUM_SNIPPETS = 4;

export const DEFAULT_SUFFIX_MATCH_THRESHOLD = 10;

export const DEFAULT_PROMPT_ALLOCATION_PERCENT = {
	prefix: 35,
	suffix: 15,
	stableContext: 35,
	volatileContext: 15,
} as const;

export type PromptComponentId = keyof typeof DEFAULT_PROMPT_ALLOCATION_PERCENT;
export type PromptComponentAllocation = Record<PromptComponentId, number>;

export interface DocumentInfo {
	relativePath?: string;
	uri: string;
	source: string;
	languageId: string;
}

export interface DocumentInfoWithOffset extends DocumentInfo {
	offset: number;
}

export type SimilarFileInfo = Omit<DocumentInfo, 'languageId'> & {
	isFromRelatedFile?: boolean;
};

export type PromptOptions = {
	maxPromptLength: number;
	numberOfSnippets: number;
	suffixPercent: number;
	suffixMatchThreshold: number;
	similarFilesOptions: SimilarFilesOptions;
};

const languageNormalizationMap: { [language: string]: string } = {
	javascriptreact: 'javascript',
	jsx: 'javascript',
	typescriptreact: 'typescript',
	jade: 'pug',
	cshtml: 'razor',
	c: 'cpp',
};

export function normalizeLanguageId(languageId: string): string {
	languageId = languageId.toLowerCase();
	return languageNormalizationMap[languageId] ?? languageId;
}
