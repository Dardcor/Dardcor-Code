/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface PromptSectionTokenCounts {
	readonly recentlyViewed: number;
	readonly currentFile: number;
	readonly lintErrors: number;
	readonly editHistory: number;
	readonly areaAroundCodeToEdit: number;
	readonly cursorLocation: number;
	readonly relatedInformation: number;
	readonly postScript: number;
	readonly overhead: number;
	readonly userPromptTotal: number;
	readonly systemPrompt: number;

	readonly recentlyViewedSubsections: RecentlyViewedSubsectionTokenCounts;
}

export interface RecentlyViewedSubsectionTokenCounts {
	readonly recentlyViewedFiles: number;
	readonly languageContext: number;
	readonly neighborFiles: number;
}
