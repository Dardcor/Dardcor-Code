/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface LanguageModelChatInformation {
		readonly pricing?: string;

		readonly inputCost?: number;

		readonly outputCost?: number;

		readonly cacheCost?: number;

		readonly cacheWriteCost?: number;

		readonly longContextInputCost?: number;

		readonly longContextOutputCost?: number;

		readonly longContextCacheCost?: number;

		readonly longContextCacheWriteCost?: number;

		readonly priceCategory?: string;

		readonly category?: string;
	}

	export interface LanguageModelChat {
		readonly pricing?: string;

		readonly inputCost?: number;

		readonly outputCost?: number;

		readonly cacheCost?: number;

		readonly cacheWriteCost?: number;

		readonly longContextInputCost?: number;

		readonly longContextOutputCost?: number;

		readonly longContextCacheCost?: number;

		readonly longContextCacheWriteCost?: number;

		readonly priceCategory?: string;

		readonly category?: string;
	}
}
