/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FuzzyScore } from '../../../../base/common/filters.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

export interface CompletionItemLabel {
	label: string;
	detail?: string;
	description?: string;
}

export interface ISimpleCompletion {
	label: string | CompletionItemLabel;

	provider: string;

	icon?: ThemeIcon;

	kindLabel?: string;

	detail?: string;

	documentation?: string | IMarkdownString;

	replacementRange: readonly [number, number] | undefined;
}

export class SimpleCompletionItem {
	labelLow: string;
	textLabel: string;

	score: FuzzyScore = FuzzyScore.Default;
	idx?: number;
	word?: string;

	isInvalid: boolean = false;

	constructor(
		readonly completion: ISimpleCompletion
	) {
		this.textLabel = typeof completion.label === 'string'
			? completion.label
			: completion.label?.label;
		this.labelLow = this.textLabel.toLowerCase();
	}
}
