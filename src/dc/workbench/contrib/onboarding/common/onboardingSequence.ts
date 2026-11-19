/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IOnboardingRunContext } from './onboardingPresentation.js';
import { OnboardingDismissReason } from './onboardingScenario.js';

export const ONBOARDING_SEQUENCE_PRESENTATION_KIND = 'sequence';

export interface IOnboardingSequenceStep<TPayload = unknown> {
	readonly id: string;
	readonly kind: string;
	readonly payload: TPayload;
}

export interface IOnboardingSequencePayload {
	readonly steps: readonly IOnboardingSequenceStep[];
}

export interface IOnboardingSequenceStepContext extends IOnboardingRunContext {
	readonly cancellationToken: CancellationToken;
	readonly stepIndex: number;
	readonly visualStepIndex: number;
	readonly visualStepCount: number;
	readonly canGoBack: boolean;
	readonly isLastVisualStep: boolean;
}

export interface IOnboardingSequenceStepResult {
	readonly action: 'next' | 'back' | 'skipStep' | 'skipSequence' | 'abort';
	readonly shown: boolean;
	readonly dismissReason?: OnboardingDismissReason;
}

export interface IOnboardingSequenceStepPresentation {
	readonly kind: string;
	readonly countsAsVisualStep: boolean;
	readonly runOnce?: boolean;
	runStep(step: IOnboardingSequenceStep, context: IOnboardingSequenceStepContext): Promise<IOnboardingSequenceStepResult>;
}

export interface IOnboardingSequenceStepPresentationRegistry {
	register(presentation: IOnboardingSequenceStepPresentation): IDisposable;
	get(kind: string): IOnboardingSequenceStepPresentation | undefined;
}

class OnboardingSequenceStepPresentationRegistry implements IOnboardingSequenceStepPresentationRegistry {
	private readonly _presentations = new Map<string, IOnboardingSequenceStepPresentation>();

	register(presentation: IOnboardingSequenceStepPresentation): IDisposable {
		if (this._presentations.has(presentation.kind)) {
			throw new Error(`An onboarding sequence step presentation with kind '${presentation.kind}' is already registered.`);
		}
		this._presentations.set(presentation.kind, presentation);
		return {
			dispose: () => {
				if (this._presentations.get(presentation.kind) === presentation) {
					this._presentations.delete(presentation.kind);
				}
			}
		};
	}

	get(kind: string): IOnboardingSequenceStepPresentation | undefined {
		return this._presentations.get(kind);
	}
}

export const onboardingSequenceStepPresentationRegistry: IOnboardingSequenceStepPresentationRegistry = new OnboardingSequenceStepPresentationRegistry();
