/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import '../media/onboardingTarget.css';

export const ONBOARDING_TARGET_ATTR = 'data-onboarding-id';

export const ONBOARDING_TARGET_PULSE_CLASS = 'onboarding-target-pulse';

export interface IOnboardingTargetOptions {
	readonly open?: () => Promise<void> | void;
}

interface IOnboardingTargetRegistration {
	readonly id: string;
	readonly options: IOnboardingTargetOptions;
}

const onboardingTargetRegistrations = new WeakMap<HTMLElement, IOnboardingTargetRegistration>();

export function markOnboardingTarget(element: HTMLElement, id: string, options: IOnboardingTargetOptions = {}): IDisposable {
	const registration = { id, options };
	element.setAttribute(ONBOARDING_TARGET_ATTR, id);
	onboardingTargetRegistrations.set(element, registration);
	return toDisposable(() => {
		if (onboardingTargetRegistrations.get(element) === registration) {
			onboardingTargetRegistrations.delete(element);
			element.removeAttribute(ONBOARDING_TARGET_ATTR);
		}
	});
}

export function openOnboardingTarget(element: HTMLElement): Promise<void> | void {
	return onboardingTargetRegistrations.get(element)?.options.open?.();
}

export function pulseOnboardingTarget(element: HTMLElement): IDisposable {
	element.classList.add(ONBOARDING_TARGET_PULSE_CLASS);
	return toDisposable(() => element.classList.remove(ONBOARDING_TARGET_PULSE_CLASS));
}

export function findOnboardingTarget(targetWindow: Window, id: string): HTMLElement | undefined {
	const selector = `[${ONBOARDING_TARGET_ATTR}="${CSS.escape(id)}"]`;
	// eslint-disable-next-line no-restricted-syntax -- matching only our own onboarding attribute (never foreign classes/structure) is the whole point of this helper
	const targets = Array.from(targetWindow.document.querySelectorAll<HTMLElement>(selector));
	return targets.find(target => isVisibleOnboardingTarget(targetWindow, target));
}

function isVisibleOnboardingTarget(targetWindow: Window, target: HTMLElement): boolean {
	if (!target.isConnected) {
		return false;
	}
	const style = targetWindow.getComputedStyle(target);
	if (style.display === 'none' || style.visibility === 'hidden') {
		return false;
	}
	const rect = target.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}
