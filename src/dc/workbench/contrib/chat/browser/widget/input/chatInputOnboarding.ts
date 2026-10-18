/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../../../base/common/errors.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IChatInputNoticeClaimOptions, IChatInputNoticeFocusTarget, IChatInputSurface, pickActiveChatInput, trackChatInputRecency } from './chatInputNoticeHost.js';
import { ChatInputStackSlot, setChatInputStackSlot } from './chatInputStack.js';

export type ChatInputNoticeClaim = (options: IChatInputNoticeClaimOptions) => IDisposable;

export interface IChatInputOnboardingHostOptions {
	readonly container: HTMLElement;
	readonly focusRoot: HTMLElement;
	readonly focus?: () => void;
	readonly claimNotice?: ChatInputNoticeClaim;
}

interface IChatInputOnboardingHost extends IChatInputOnboardingHostOptions, IChatInputSurface {
	lastFocused: number;
}

type ChatInputOnboardingFactory = (context: IChatInputOnboardingContext) => IChatInputOnboardingBanner;

export interface IChatInputOnboardingOptions {
	readonly storageKey: string;
}

export interface IChatInputOnboardingContext {
	readonly container: HTMLElement;
	readonly dismiss: (restoreFocus?: boolean) => void;
}

export interface IChatInputOnboardingBanner extends IDisposable, IChatInputNoticeFocusTarget {
	announce(): void;
	setVisible?(visible: boolean): void;
}

export class ChatInputOnboarding extends Disposable {

	private readonly hosts = new Set<IChatInputOnboardingHost>();
	private readonly currentOnboarding = this._register(new MutableDisposable<IDisposable>());
	private claim: IDisposable | undefined;
	private activeHost: IChatInputOnboardingHost | undefined;
	private activeBanner: IChatInputOnboardingBanner | undefined;
	private wanted: ChatInputOnboardingFactory | undefined;
	private leading = false;
	private generation = 0;

	get isVisible(): boolean {
		return !!this.currentOnboarding.value && this.leading;
	}

	constructor(
		private readonly options: IChatInputOnboardingOptions,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this._register(toDisposable(() => {
			const claim = this.claim;
			this.claim = undefined;
			claim?.dispose();
		}));
	}

	registerHost(options: IChatInputOnboardingHostOptions): IDisposable {
		const host: IChatInputOnboardingHost = { ...options, lastFocused: 0 };
		this.hosts.add(host);

		const store = new DisposableStore();
		store.add(trackChatInputRecency(host));
		store.add(toDisposable(() => {
			this.hosts.delete(host);
			if (this.activeHost === host) {
				this.hide(false);
			}
		}));
		return store;
	}

	showIfNeeded(createOnboarding: ChatInputOnboardingFactory): boolean {
		if (this.wanted) {
			return true;
		}
		if (this.storageService.getBoolean(this.options.storageKey, StorageScope.APPLICATION, false)) {
			return false;
		}
		return this.request(createOnboarding);
	}

	show(createOnboarding: ChatInputOnboardingFactory): boolean {
		return this.request(createOnboarding);
	}

	private request(createOnboarding: ChatInputOnboardingFactory): boolean {
		const host = this.getActiveHost();
		if (!host) {
			return false;
		}

		const previousClaim = this.claim;
		this.claim = undefined;
		this.hideCard(false);

		const generation = ++this.generation;
		this.activeHost = host;
		this.wanted = createOnboarding;

		if (!host.claimNotice) {
			previousClaim?.dispose();
			this.setLeading(true);
			return true;
		}

		const claim = host.claimNotice({
			focusTarget: {
				hasFocus: () => this.activeBanner?.hasFocus() ?? false,
				focus: () => this.activeBanner?.focus(),
				canFocus: () => !!this.activeBanner,
			},
			onDidChangeLeading: leading => {
				if (this.generation === generation) {
					this.setLeading(leading);
				}
			},
		});

		if (this.wanted === createOnboarding) {
			this.claim = claim;
		} else {
			claim.dispose();
		}
		previousClaim?.dispose();
		return true;
	}

	private setLeading(leading: boolean): void {
		if (this.leading === leading || !this.wanted) {
			return;
		}

		this.leading = leading;
		if (leading) {
			this.build();
		} else {
			this.standDown();
		}
	}

	private standDown(): void {
		const host = this.activeHost;
		if (!host || !this.currentOnboarding.value) {
			return;
		}

		this.activeBanner?.setVisible?.(false);
		setChatInputStackSlot(host.container, ChatInputStackSlot.Empty);
	}

	private build(): void {
		const host = this.activeHost;
		const createOnboarding = this.wanted;
		if (!host || !createOnboarding) {
			return;
		}

		if (this.currentOnboarding.value) {
			setChatInputStackSlot(host.container, ChatInputStackSlot.Standalone);
			this.activeBanner?.setVisible?.(true);
			return;
		}

		const onboardingStore = new DisposableStore();

		let banner: IChatInputOnboardingBanner;
		try {
			banner = createOnboarding({
				container: host.container,
				dismiss: (restoreFocus = true) => this.hide(restoreFocus),
			});
			onboardingStore.add(banner);
		} catch (error) {
			onboardingStore.dispose();
			this.hide(false);
			onUnexpectedError(error);
			return;
		}

		if (this.activeHost !== host || this.wanted !== createOnboarding || !this.leading) {
			onboardingStore.dispose();
			return;
		}

		this.currentOnboarding.value = onboardingStore;
		this.activeBanner = banner;
		setChatInputStackSlot(host.container, ChatInputStackSlot.Standalone);
		this.storageService.store(this.options.storageKey, true, StorageScope.APPLICATION, StorageTarget.USER);
		banner.announce();
	}

	private getActiveHost(): IChatInputOnboardingHost | undefined {
		return pickActiveChatInput(this.hosts, host => host.container.isConnected);
	}

	private hide(restoreFocus: boolean): void {
		const claim = this.claim;
		this.claim = undefined;
		this.hideCard(restoreFocus);
		claim?.dispose();
	}

	private hideCard(restoreFocus: boolean): void {
		const host = this.activeHost;
		const wasVisible = this.isVisible;
		this.activeHost = undefined;
		this.activeBanner = undefined;
		this.wanted = undefined;
		this.leading = false;
		this.currentOnboarding.clear();
		if (host) {
			setChatInputStackSlot(host.container, ChatInputStackSlot.Empty);
		}
		if (wasVisible && restoreFocus) {
			host?.focus?.();
		}
	}
}
