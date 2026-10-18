/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../../../base/common/platform.js';


export const FONT_SIZE = {
	micro: '10px',
	body: '12px',
	base: '13px',
	iconSm: '14px',
	iconMd: '16px',
} as const;

export const FONT_WEIGHT = {
	normal: '400',
	medium: '500',
	semibold: '600',
	bold: '700',
} as const;

export const COLOR = {
	userTranscript: 'rgb(88,166,255)',
	assistantTranscript: 'rgb(163,113,247)',
} as const;

export function addKeyboardActivation(el: HTMLElement): void {
	el.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			el.click();
		}
	});
}

export function isSecondaryPointerGesture(e: MouseEvent): boolean {
	return e.button !== 0 || (isMacintosh && e.ctrlKey);
}
