/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable } from '../../../../base/common/observable.js';
import { ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';

export type OnboardingTrigger =
	| { readonly kind: 'auto' }
	| { readonly kind: 'command'; readonly commandId: string }
	| { readonly kind: 'observable'; readonly signal: IObservable<boolean> };

export interface IOnboardingPresentationRef<TPayload = unknown> {
	readonly kind: string;
	readonly payload: TPayload;
}

export const ONBOARDING_ASSIGNMENT_CONTEXT_PREFIX = 'onb-';

export interface IOnboardingExperiment {
	readonly behaviorFlag: string;

	readonly assignmentContextIdFlag: string;
}

export interface IOnboardingScenario<TPayload = unknown> {
	readonly id: string;

	readonly seenKey?: string;

	readonly when?: ContextKeyExpression;

	readonly trigger: OnboardingTrigger;

	readonly priority?: number;

	readonly presentation: IOnboardingPresentationRef<TPayload>;

	readonly experiment?: IOnboardingExperiment;

	readonly developerModeVariations?: readonly string[];

	readonly repeatable?: boolean;
}

export const enum OnboardingOutcome {
	Completed = 'completed',
	Skipped = 'skipped',
	Dismissed = 'dismissed',
	Aborted = 'aborted'
}

export const enum OnboardingDismissReason {
	Completed = 'completed',
	SkipButton = 'skipButton',
	EscapeKey = 'escapeKey',
	TargetClick = 'targetClick',
	Aborted = 'aborted'
}

export interface IOnboardingRunResult {
	readonly outcome: OnboardingOutcome;

	readonly shown: boolean;

	readonly dismissReason: OnboardingDismissReason;

	readonly lastStepIndex: number;

	readonly stepCount: number;
}
