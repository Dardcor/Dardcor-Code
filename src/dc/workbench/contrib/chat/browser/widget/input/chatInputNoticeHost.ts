/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveWindow, isAncestorOfActiveElement, trackFocus } from '../../../../../../base/browser/dom.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';

export const enum ChatInputNoticeLane {
	Notification = 0,
	Onboarding = 1,
	Tip = 2,
}

const LANE_COUNT = 3;

export interface IChatInputNoticeFocusTarget {
	hasFocus(): boolean;
	focus(): void;
	canFocus?(): boolean;
}

export interface IChatInputSurface {
	readonly focusRoot: HTMLElement;
	lastFocused: number;
}

export function trackChatInputRecency(surface: IChatInputSurface): IDisposable {
	const store = new DisposableStore();
	const focusTracker = store.add(trackFocus(surface.focusRoot));
	store.add(focusTracker.onDidFocus(() => surface.lastFocused = Date.now()));
	return store;
}

export function pickActiveChatInput<T extends IChatInputSurface>(surfaces: Iterable<T>, isEligible?: (surface: T) => boolean): T | undefined {
	const activeDocument = getActiveWindow().document;
	let mostRecent: T | undefined;
	for (const surface of surfaces) {
		const focusRoot = surface.focusRoot;
		if (focusRoot.ownerDocument !== activeDocument || !focusRoot.isConnected || focusRoot.getClientRects().length === 0) {
			continue;
		}
		if (isEligible && !isEligible(surface)) {
			continue;
		}
		if (isAncestorOfActiveElement(focusRoot)) {
			return surface;
		}
		if (!mostRecent || surface.lastFocused > mostRecent.lastFocused) {
			mostRecent = surface;
		}
	}
	return mostRecent;
}

export interface IChatInputNoticeClaimOptions {
	readonly focusTarget?: IChatInputNoticeFocusTarget;
	readonly onDidChangeLeading?: (leading: boolean) => void;
}

interface IClaim extends IChatInputNoticeClaimOptions { }

export class ChatInputNoticeHost extends Disposable {

	private readonly _claims: IClaim[][] = Array.from({ length: LANE_COUNT }, () => []);
	private readonly _leases = this._register(new DisposableMap<ChatInputNoticeLane>());
	private _leadingClaim: IClaim | undefined;
	private _notifying = false;
	private _isDisposed = false;
	private _leaseToken = 0;

	constructor(private readonly _focusInput: () => void) {
		super();
	}

	occupy(lane: ChatInputNoticeLane, options?: IChatInputNoticeClaimOptions): IDisposable {
		if (this._isDisposed) {
			return Disposable.None;
		}

		const claim: IClaim = options ?? {};
		this._claims[lane].push(claim);
		this._notifyLeading();

		let released = false;
		return toDisposable(() => {
			if (released) {
				return;
			}
			released = true;
			const claims = this._claims[lane];
			const index = claims.indexOf(claim);
			if (index !== -1) {
				claims.splice(index, 1);
			}
			this._notifyLeading();
		});
	}

	setOccupied(lane: ChatInputNoticeLane, occupied: boolean, focusTarget?: IChatInputNoticeFocusTarget): void {
		const token = ++this._leaseToken;
		if (!occupied) {
			this._leases.deleteAndLeak(lane)?.dispose();
			return;
		}

		const lease = this.occupy(lane, { focusTarget });
		if (this._isDisposed || this._leaseToken !== token) {
			lease.dispose();
			return;
		}
		this._leases.set(lane, lease);
	}

	toggleFocus(): boolean {
		if (!this.hasFocusableNotice()) {
			return false;
		}

		const focusTarget = this._leadingClaim!.focusTarget!;
		if (focusTarget.hasFocus()) {
			this._focusInput();
		} else {
			focusTarget.focus();
		}
		return true;
	}

	hasFocusableNotice(): boolean {
		const focusTarget = this._leadingClaim?.focusTarget;
		return !!focusTarget && (focusTarget.canFocus?.() ?? true);
	}

	private _notifyLeading(): void {
		if (this._notifying) {
			return;
		}

		this._notifying = true;
		try {
			while (!this._isDisposed) {
				const lane = this._claims.findIndex(claims => claims.length > 0);
				const leading = lane === -1 ? undefined : this._claims[lane].at(-1);
				if (leading === this._leadingClaim) {
					return;
				}

				if (this._leadingClaim) {
					const previous = this._leadingClaim;
					this._leadingClaim = undefined;
					this._standDown(previous);
				} else {
					this._leadingClaim = leading;
					leading?.onDidChangeLeading?.(true);
				}
			}
		} finally {
			this._notifying = false;
		}
	}

	private _standDown(claim: IClaim): void {
		const hadFocus = claim.focusTarget?.hasFocus() ?? false;
		claim.onDidChangeLeading?.(false);
		if (hadFocus && !this._isDisposed) {
			this._focusInput();
		}
	}

	override dispose(): void {
		this._isDisposed = true;
		const leading = this._leadingClaim;
		this._leadingClaim = undefined;
		for (const claims of this._claims) {
			claims.length = 0;
		}
		leading?.onDidChangeLeading?.(false);
		super.dispose();
	}
}
