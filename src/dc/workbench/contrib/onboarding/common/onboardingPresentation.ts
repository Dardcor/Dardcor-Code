/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IOnboardingRunResult, IOnboardingScenario } from './onboardingScenario.js';

export interface IOnboardingRunContext {
	readonly targetWindow: Window;

	readonly onAbort: Event<void>;
}

export interface IOnboardingPresentation {
	readonly kind: string;

	run(scenario: IOnboardingScenario, context: IOnboardingRunContext): Promise<IOnboardingRunResult>;
}

export interface IOnboardingPresentationRegistry {
	register(presentation: IOnboardingPresentation): IDisposable;
	get(kind: string): IOnboardingPresentation | undefined;
}

class OnboardingPresentationRegistry implements IOnboardingPresentationRegistry {

	private readonly _presentations = new Map<string, IOnboardingPresentation>();

	register(presentation: IOnboardingPresentation): IDisposable {
		const kind = presentation.kind;
		if (this._presentations.has(kind)) {
			throw new Error(`An onboarding presentation with kind '${kind}' is already registered.`);
		}
		this._presentations.set(kind, presentation);
		return {
			dispose: () => {
				if (this._presentations.get(kind) === presentation) {
					this._presentations.delete(kind);
				}
			}
		};
	}

	get(kind: string): IOnboardingPresentation | undefined {
		return this._presentations.get(kind);
	}
}

export const onboardingPresentationRegistry: IOnboardingPresentationRegistry = new OnboardingPresentationRegistry();
