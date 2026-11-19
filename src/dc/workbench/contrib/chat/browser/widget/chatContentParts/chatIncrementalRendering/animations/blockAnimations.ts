/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IIncrementalRenderingAnimation } from './animation.js';

export const ANIMATION_DURATION_MS = 600;

const STAGGER_DELAY_MS = 150;

export class BlockAnimation implements IIncrementalRenderingAnimation {

	constructor(private readonly _style: 'fade' | 'rise' | 'blur' | 'scale' | 'slide' | 'reveal') { }

	animate(children: HTMLCollection, fromIndex: number, currentCount: number, elapsed: number): void {
		const className = `chat-smooth-animate-${this._style}`;

		for (let i = fromIndex; i < currentCount; i++) {
			const child = children[i] as HTMLElement;
			if (!child.classList) {
				continue;
			}

			const staggerOffset = (i - fromIndex) * STAGGER_DELAY_MS;
			const childDelay = -elapsed + staggerOffset;

			child.classList.add(className);
			child.style.setProperty('--chat-smooth-duration', `${ANIMATION_DURATION_MS}ms`);
			child.style.setProperty('--chat-smooth-delay', `${childDelay}ms`);

			child.addEventListener('animationend', (e) => {
				if (e.target !== child) {
					return;
				}
				child.classList.remove(className);
				child.style.removeProperty('--chat-smooth-duration');
				child.style.removeProperty('--chat-smooth-delay');
			}, { once: true });
		}
	}
}
