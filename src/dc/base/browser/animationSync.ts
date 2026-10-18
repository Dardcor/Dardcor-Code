/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getWindow, onDidUnregisterWindow } from './dom.js';
import { CodeWindow } from './window.js';
import { Disposable, IDisposable, toDisposable } from '../common/lifecycle.js';

export interface ISynchronizeAnimationsOptions {
	readonly subtree?: boolean;

	readonly animationNames?: ReadonlySet<string>;
}

export function synchronizeCSSAnimations(element: HTMLElement, options?: ISynchronizeAnimationsOptions): void {
	if (typeof element.getAnimations !== 'function') {
		return;
	}
	for (const animation of element.getAnimations({ subtree: options?.subtree })) {
		const animationName = (animation as CSSAnimation).animationName;
		if (animationName === undefined) {
			continue;
		}
		if (options?.animationNames && !options.animationNames.has(animationName)) {
			continue;
		}
		try {
			animation.startTime = 0;
		} catch {
		}
	}
}

export interface IPauseCSSAnimationsWhenHiddenOptions extends ISynchronizeAnimationsOptions {
	readonly pausedClass: string;
}

interface ITrackedAnimation {
	readonly options: IPauseCSSAnimationsWhenHiddenOptions;
}

interface IAnimationVisibilityObserver {
	readonly observer: IntersectionObserver;
	readonly trackedAnimations: Map<HTMLElement, ITrackedAnimation>;
	readonly intersectingElements: Set<HTMLElement>;
	readonly visibilityListener: IDisposable;
}

const animationVisibilityObservers = new Map<CodeWindow, IAnimationVisibilityObserver>();
let unregisterWindowListener: IDisposable | undefined;

export function pauseCSSAnimationsWhenHidden(element: HTMLElement, options: IPauseCSSAnimationsWhenHiddenOptions): IDisposable {
	const targetWindow = getWindow(element);
	if (typeof targetWindow.IntersectionObserver !== 'function') {
		return Disposable.None;
	}

	let state = animationVisibilityObservers.get(targetWindow);
	if (!state) {
		const trackedAnimations = new Map<HTMLElement, ITrackedAnimation>();
		const intersectingElements = new Set<HTMLElement>();
		const observer = new targetWindow.IntersectionObserver(entries => {
			const toResync: Array<[HTMLElement, IPauseCSSAnimationsWhenHiddenOptions]> = [];
			for (const entry of entries) {
				const target = entry.target as HTMLElement;
				const trackedAnimation = trackedAnimations.get(target);
				if (!trackedAnimation) {
					continue;
				}
				if (entry.isIntersecting) {
					intersectingElements.add(target);
				} else {
					intersectingElements.delete(target);
				}
				const paused = targetWindow.document.hidden || !entry.isIntersecting;
				target.classList.toggle(trackedAnimation.options.pausedClass, paused);
				if (!paused) {
					toResync.push([target, trackedAnimation.options]);
				}
			}

			for (const [target, trackedOptions] of toResync) {
				synchronizeCSSAnimations(target, trackedOptions);
			}
			disposeVisibilityObserverIfEmpty(targetWindow, animationVisibilityObservers.get(targetWindow));
		});
		const visibilityListener = addDisposableListener(targetWindow.document, 'visibilitychange', () => {
			const documentHidden = targetWindow.document.hidden;
			const toResync: Array<[HTMLElement, IPauseCSSAnimationsWhenHiddenOptions]> = [];
			for (const [target, trackedAnimation] of trackedAnimations) {
				const paused = documentHidden || !intersectingElements.has(target);
				target.classList.toggle(trackedAnimation.options.pausedClass, paused);
				if (!paused) {
					toResync.push([target, trackedAnimation.options]);
				}
			}
			for (const [target, trackedOptions] of toResync) {
				synchronizeCSSAnimations(target, trackedOptions);
			}
			disposeVisibilityObserverIfEmpty(targetWindow, animationVisibilityObservers.get(targetWindow));
		});
		state = { observer, trackedAnimations, intersectingElements, visibilityListener };
		animationVisibilityObservers.set(targetWindow, state);

		if (!unregisterWindowListener) {
			unregisterWindowListener = onDidUnregisterWindow(window => {
				const state = animationVisibilityObservers.get(window);
				if (state) {
					state.observer.disconnect();
					state.visibilityListener.dispose();
					animationVisibilityObservers.delete(window);
					disposeUnregisterWindowListenerIfUnused();
				}
			});
		}
	}

	element.classList.add(options.pausedClass);
	state.trackedAnimations.set(element, { options });
	state.observer.observe(element);

	return toDisposable(() => {
		state.observer.unobserve(element);
		state.trackedAnimations.delete(element);
		state.intersectingElements.delete(element);
		element.classList.remove(options.pausedClass);
		disposeVisibilityObserverIfEmpty(targetWindow, state);
	});
}

function disposeVisibilityObserverIfEmpty(targetWindow: CodeWindow, state: IAnimationVisibilityObserver | undefined): void {
	if (!state || state.trackedAnimations.size !== 0 || animationVisibilityObservers.get(targetWindow) !== state) {
		return;
	}
	state.observer.disconnect();
	state.visibilityListener.dispose();
	animationVisibilityObservers.delete(targetWindow);
	disposeUnregisterWindowListenerIfUnused();
}

function disposeUnregisterWindowListenerIfUnused(): void {
	if (animationVisibilityObservers.size === 0) {
		unregisterWindowListener?.dispose();
		unregisterWindowListener = undefined;
	}
}
