/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { InlineCompletionItemProvider } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';

export interface IDardcorInlineCompletionItemProviderService {
	readonly _serviceBrand: undefined;

	getOrCreateInstantiationService(): IInstantiationService;
	getOrCreateProvider(): InlineCompletionItemProvider;
}

export const IDardcorInlineCompletionItemProviderService = createServiceIdentifier<IDardcorInlineCompletionItemProviderService>('IDardcorInlineCompletionItemProviderService');

export class NullDardcorInlineCompletionItemProviderService implements IDardcorInlineCompletionItemProviderService {
	readonly _serviceBrand: undefined;

	getOrCreateInstantiationService(): IInstantiationService {
		throw new Error('Not implemented');
	}
	getOrCreateProvider(): InlineCompletionItemProvider {
		throw new Error('Not implemented');
	}
}
