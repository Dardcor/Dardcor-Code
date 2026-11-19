/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { LineRange0Based } from './lineRange';

export interface INeighborFileSnippet {
	readonly uri: string;
	readonly relativePath: string | undefined;
	readonly snippet: string;
	readonly lineRange: LineRange0Based;
	readonly score: number;
	readonly isFromRelatedFile: boolean;
}

export interface ISimilarFilesContextService {
	readonly _serviceBrand: undefined;

	compute(uri: string, languageId: string, source: string, cursorOffset: number, includeRelatedFiles: boolean): Promise<string | undefined>;

	getSnippetsForPrompt(uri: string, languageId: string, source: string, cursorOffset: number, includeRelatedFiles: boolean): Promise<readonly INeighborFileSnippet[] | undefined>;
}

export const ISimilarFilesContextService = createServiceIdentifier<ISimilarFilesContextService>('ISimilarFilesContextService');

export class NullSimilarFilesContextService implements ISimilarFilesContextService {
	declare readonly _serviceBrand: undefined;

	async compute(): Promise<undefined> {
		return undefined;
	}

	async getSnippetsForPrompt(): Promise<undefined> {
		return undefined;
	}
}
