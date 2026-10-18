/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';

export const SPOTLIGHT_PRESENTATION_KIND = 'spotlight';

export type SpotlightPlacement = 'above' | 'below' | 'left' | 'right' | 'auto';

export type SpotlightMissingTargetBehavior =
	| { readonly kind: 'skip' }
	| { readonly kind: 'wait'; readonly timeoutMs: number };

export interface ISpotlightStep {
	readonly id: string;

	readonly targetId: string;

	readonly title: string;

	readonly description: string | IMarkdownString;

	readonly placement?: SpotlightPlacement;

	readonly when?: ContextKeyExpression;

	readonly missingTarget?: SpotlightMissingTargetBehavior;

	readonly openTarget?: boolean;

	readonly allowTargetInteraction?: boolean;

	readonly advanceOnTargetClick?: boolean;

	readonly advanceWhen?: ContextKeyExpression;

	readonly padding?: number;

	readonly onBeforeShow?: () => Promise<void> | void;
}

export interface ISpotlightPayload {
	readonly steps: readonly ISpotlightStep[];
}
