/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { $, addDisposableListener, AnimationFrameScheduler, EventType, isHTMLInputElement } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IQuickInputService, IQuickPick, IQuickPickItem, IQuickPickSeparator, QuickInputHideReason } from '../../../../../platform/quickinput/common/quickInput.js';
import { BrowserEditorInput } from '../../common/browserEditorInput.js';
import {
	BrowserEditorContribution,
	BrowserWidgetLocation,
	IBrowserEditorWidget,
	IBrowserUrlPickerAction,
	IBrowserUrlPickerActionProvider,
	IBrowserUrlRenderer,
	IBrowserUrlSuggestion,
	IBrowserUrlSuggestionAction,
	IBrowserUrlSuggestionProvider,
} from '../browserEditor.js';

export type IUrlPickerItem = IQuickPickItem & {
	apply?(input: BrowserEditorInput): void | Promise<void>;
};

export interface IBrowserUrlBarHost {
	readonly input: BrowserEditorInput | undefined;
	ensureBrowserFocus(): void;
	getPrimaryActions?(text: string): readonly IUrlPickerItem[];
	getPlaceholder?(): string;
}

export class BrowserUrlBarWidget extends Disposable {
	readonly element: HTMLElement;
	private readonly _urlDisplay: HTMLElement;
	private readonly _preUrlWidgetsContainer: HTMLElement;
	private readonly _urlBarWidgetsContainer: HTMLElement;
	private readonly _urlRenderers: IBrowserUrlRenderer[] = [];
	private readonly _suggestionProviders: IBrowserUrlSuggestionProvider[] = [];
	private readonly _pickerActionProviders: IBrowserUrlPickerActionProvider[] = [];
	private readonly _picker = this._register(new MutableDisposable<IQuickPick<IUrlPickerItem, { useSeparators: true }>>());

	private _suppressFocusOpen = false;
	private _suppressBlurRevert = false;
	private _pickerEdited = false;
	private _isSettingPickerValue = false;

	constructor(
		private readonly _host: IBrowserUrlBarHost,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
	) {
		super();

		this.element = $('.browser-url-container');
		this._preUrlWidgetsContainer = $('.browser-pre-url-widgets');

		this._urlDisplay = $('div.browser-url-display');
		this._urlDisplay.contentEditable = 'plaintext-only';
		this._urlDisplay.spellcheck = false;
		this._urlDisplay.setAttribute('data-placeholder', this._placeholder);

		this._urlBarWidgetsContainer = $('.browser-url-bar-widgets');

		this.element.appendChild(this._preUrlWidgetsContainer);
		this.element.appendChild(this._urlDisplay);
		this.element.appendChild(this._urlBarWidgetsContainer);

		this._registerDisplayListeners();
	}

	refreshUrl(): void {
		const isEditing = !!this._picker.value || this._urlDisplay.ownerDocument.activeElement === this._urlDisplay;
		if (!isEditing) {
			this._renderUrl();
		}
		this._urlDisplay.setAttribute('data-placeholder', this._placeholder);
		const picker = this._picker.value;
		if (picker && !this._pickerEdited) {
			this._isSettingPickerValue = true;
			try {
				picker.value = this._canonicalUrl;
			} finally {
				this._isSettingPickerValue = false;
			}
		}
	}

	previewUrl(url: string): void {
		const isEditing = !!this._picker.value || this._urlDisplay.ownerDocument.activeElement === this._urlDisplay;
		if (!isEditing) {
			this._renderUrl(url);
		}
	}

	focusUrlInput(): void {
		this._suppressFocusOpen = true;
		this._urlDisplay.focus();
		this._selectAll();
	}

	openUrlPicker(): void {
		this._openPicker();
	}

	clear(): void {
		this._renderUrl();
		this._picker.value?.hide();
	}

	mountContributions(contributions: readonly BrowserEditorContribution[]): void {
		const preUrl: IBrowserEditorWidget[] = [];
		const postUrl: IBrowserEditorWidget[] = [];
		for (const contribution of contributions) {
			for (const widget of contribution.widgets) {
				if (widget.location === BrowserWidgetLocation.PreUrl) {
					preUrl.push(widget);
				} else if (widget.location === BrowserWidgetLocation.PostUrl) {
					postUrl.push(widget);
				}
			}
			for (const renderer of contribution.urlRenderers) {
				this._urlRenderers.push(renderer);
				this._register(renderer.onDidChange(() => this._renderUrl()));
			}
			this._suggestionProviders.push(...contribution.urlSuggestionProviders);
			this._pickerActionProviders.push(...contribution.urlPickerActionProviders);
		}
		for (const widget of preUrl.sort((a, b) => a.order - b.order)) {
			this._preUrlWidgetsContainer.appendChild(widget.element);
		}
		for (const widget of postUrl.sort((a, b) => a.order - b.order)) {
			this._urlBarWidgetsContainer.appendChild(widget.element);
		}
		this._suggestionProviders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		this._pickerActionProviders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		this._renderUrl();
	}

	private get _canonicalUrl(): string {
		return this._host.input?.url ?? '';
	}

	private get _placeholder(): string {
		return this._host.getPlaceholder?.() ?? localize('browser.urlPlaceholder', "Enter a URL");
	}

	private _registerDisplayListeners(): void {
		let pendingMouseFocus = false;
		this._register(addDisposableListener(this._urlDisplay, EventType.POINTER_DOWN, () => {
			if (this._urlDisplay.ownerDocument.activeElement !== this._urlDisplay) {
				pendingMouseFocus = true;
			}
		}));
		this._register(addDisposableListener(this._urlDisplay, EventType.FOCUS, (event: FocusEvent) => {
			if (this._suppressFocusOpen) {
				this._suppressFocusOpen = false;
				pendingMouseFocus = false;
				return;
			}
			if (!(event.relatedTarget instanceof Element) || event.relatedTarget.closest('.quick-input-widget')) {
				return;
			}
			if (pendingMouseFocus) {
				return;
			}
			this._openPicker();
		}));
		this._register(addDisposableListener(this._urlDisplay, EventType.BLUR, () => {
			pendingMouseFocus = false;
			this._urlDisplay.scrollLeft = 0;
			const sel = this._urlDisplay.ownerDocument.getSelection();
			if (sel && sel.anchorNode && this._urlDisplay.contains(sel.anchorNode)) {
				sel.removeAllRanges();
			}
			if (this._picker.value) {
				return;
			}
			if (this._suppressBlurRevert) {
				this._suppressBlurRevert = false;
				return;
			}
			if ((this._urlDisplay.textContent ?? '') !== this._canonicalUrl) {
				this._renderUrl();
			}
		}));
		this._register(addDisposableListener(this._urlDisplay, EventType.CLICK, () => {
			const isMouseFocusClick = pendingMouseFocus;
			pendingMouseFocus = false;
			if (!isMouseFocusClick) {
				return;
			}
			const selection = this._urlDisplay.ownerDocument.getSelection();
			if (selection && !selection.isCollapsed && selection.anchorNode && this._urlDisplay.contains(selection.anchorNode)) {
				return;
			}
			const value = this._urlDisplay.textContent ?? '';
			this._openPicker({ value, selection: [0, value.length], edited: false });
		}));

		this._register(addDisposableListener(this._urlDisplay, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Enter) {
				e.preventDefault();
				const value = this._urlDisplay.textContent?.trim() ?? '';
				if (value) {
					this._suppressBlurRevert = true;
					this._navigateText(value);
					this._host.ensureBrowserFocus();
				}
				return;
			}
			if (event.keyCode === KeyCode.Escape) {
				e.preventDefault();
				this._renderUrl();
				this._host.ensureBrowserFocus();
				return;
			}
			// The workbench captures Ctrl/Cmd+A as a global command before
			if (event.keyCode === KeyCode.KeyA && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
				e.preventDefault();
				event.stopPropagation();
				this._selectAll();
				return;
			}
		}));

		this._register(addDisposableListener(this._urlDisplay, 'input', () => {
			if (this._picker.value) {
				return;
			}
			const value = this._urlDisplay.textContent ?? '';
			const caret = this._getCaretOffset();
			this._openPicker({ value, selection: [caret, caret], edited: true });
		}));
	}

	private _selectAll(): void {
		const doc = this._urlDisplay.ownerDocument;
		const sel = doc.getSelection();
		if (!sel) {
			return;
		}
		const range = doc.createRange();
		range.selectNodeContents(this._urlDisplay);
		sel.removeAllRanges();
		sel.addRange(range);
	}

	private _getCaretOffset(): number {
		const doc = this._urlDisplay.ownerDocument;
		const sel = doc.getSelection();
		const total = this._urlDisplay.textContent?.length ?? 0;
		if (!sel || sel.rangeCount === 0) {
			return total;
		}
		const range = sel.getRangeAt(0);
		if (!this._urlDisplay.contains(range.startContainer)) {
			return total;
		}
		const pre = doc.createRange();
		pre.selectNodeContents(this._urlDisplay);
		pre.setEnd(range.startContainer, range.startOffset);
		return pre.toString().length;
	}

	private _setSelection(start: number, end: number, direction: 'forward' | 'backward' = 'forward'): void {
		const doc = this._urlDisplay.ownerDocument;
		const sel = doc.getSelection();
		if (!sel) {
			return;
		}
		const total = this._urlDisplay.textContent?.length ?? 0;
		const s = Math.max(0, Math.min(start, total));
		const e = Math.max(0, Math.min(end, total));
		const startPos = this._offsetToPosition(s);
		const endPos = this._offsetToPosition(e);
		if (direction === 'backward') {
			sel.setBaseAndExtent(endPos.node, endPos.offset, startPos.node, startPos.offset);
		} else {
			sel.setBaseAndExtent(startPos.node, startPos.offset, endPos.node, endPos.offset);
		}
	}

	private _offsetToPosition(offset: number): { node: Node; offset: number } {
		const walker = this._urlDisplay.ownerDocument.createTreeWalker(this._urlDisplay, NodeFilter.SHOW_TEXT);
		let remaining = offset;
		let lastNode: Text | null = null;
		for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
			lastNode = node;
			if (remaining <= node.data.length) {
				return { node, offset: remaining };
			}
			remaining -= node.data.length;
		}
		if (lastNode) {
			return { node: lastNode, offset: lastNode.data.length };
		}
		return { node: this._urlDisplay, offset: 0 };
	}

	private _renderUrl(override?: string): void {
		const url = override ?? this._canonicalUrl;

		this._urlDisplay.textContent = '';

		for (const renderer of this._urlRenderers) {
			if (renderer.render(url, this._urlDisplay)) {
				return;
			}
		}

		if (url) {
			this._urlDisplay.textContent = url;
		}
	}

	private _buildSuggestionItems(value: string): (IUrlPickerItem | IQuickPickSeparator)[] {
		const items: (IUrlPickerItem | IQuickPickSeparator)[] = [];
		const trimmed = value.trim();
		if (trimmed) {
			const primaryItems = this._host.getPrimaryActions?.(trimmed) ?? [];
			if (primaryItems.length > 0) {
				items.push(...primaryItems);
			} else {
				items.push({
					id: trimmed,
					label: localize('browser.goTo', "Go to {0}", trimmed),
					iconClass: ThemeIcon.asClassName(Codicon.arrowRight),
				});
			}
		}
		return items;
	}

	private _navigateText(text: string): void {
		const input = this._host.input;
		const trimmed = text.trim();
		if (!trimmed || !input) {
			return;
		}
		const primaryItems = this._host.getPrimaryActions?.(trimmed);
		const defaultItem = primaryItems?.[0];
		if (defaultItem?.apply) {
			void Promise.resolve(defaultItem.apply(input));
		} else {
			input.navigate(trimmed);
		}
	}

	private _toPickerItem(s: IBrowserUrlSuggestion): IUrlPickerItem {
		const item: IUrlPickerItem = {
			id: s.id,
			label: s.label,
			description: s.description,
			apply: s.apply,
		};
		if (s.iconPath) {
			item.iconPath = s.iconPath;
		} else if (s.icon) {
			item.iconClass = ThemeIcon.asClassName(s.icon);
		}
		if (s.actions && s.actions.length > 0) {
			item.buttons = s.actions;
		}
		return item;
	}

	private _openPicker(initial?: { value: string; selection: [number, number]; edited: boolean }): void {
		if (this._picker.value) {
			return;
		}

		this._urlDisplay.style.visibility = 'hidden';

		const picker = this._quickInputService.createQuickPick<IUrlPickerItem>({ useSeparators: true });
		picker.placeholder = this._placeholder;
		picker.ignoreFocusOut = false;
		picker.sortByLabel = false;
		picker.matchOnDescription = true;
		picker.anchor = this.element;
		picker.anchorPosition = 'overlay';
		picker.filterValue = (filter) => filter.substring(0, 1000);
		if (initial !== undefined) {
			picker.value = initial.value;
			picker.valueSelection = initial.selection;
		} else {
			picker.value = this._canonicalUrl;
			picker.valueSelection = [0, this._canonicalUrl.length];
		}
		this._pickerEdited = initial?.edited ?? false;
		const disposables = new DisposableStore();

		type ProviderState = {
			suggestions: readonly IBrowserUrlSuggestion[];
			cts: MutableDisposable<CancellationTokenSource>;
		};
		const providerStates = new Map<IBrowserUrlSuggestionProvider, ProviderState>();
		disposables.add(toDisposable(() => {
			for (const state of providerStates.values()) {
				state.cts.value?.cancel();
			}
		}));
		for (const provider of this._suggestionProviders) {
			providerStates.set(provider, {
				suggestions: [],
				cts: disposables.add(new MutableDisposable<CancellationTokenSource>()),
			});
		}

		let currentValue = picker.value;

		const render = (preserveSelection: boolean) => {
			const previousActiveId = preserveSelection ? picker.activeItems[0]?.id : undefined;
			const defaultItems = this._buildSuggestionItems(currentValue);
			const items: (IUrlPickerItem | IQuickPickSeparator)[] = [...defaultItems];
			for (const provider of this._suggestionProviders) {
				const state = providerStates.get(provider);
				if (!state || state.suggestions.length === 0) {
					continue;
				}
				if (provider.label) {
					items.push({
						type: 'separator',
						label: provider.label,
						description: provider.description,
						buttons: provider.actions,
					});
				}
				for (const s of state.suggestions) {
					items.push(this._toPickerItem(s));
				}
			}
			picker.items = items;

			const defaultActive = defaultItems.find((i): i is IUrlPickerItem => i.type !== 'separator');
			const restored = previousActiveId !== undefined
				? items.find((i): i is IUrlPickerItem => i.type !== 'separator' && i.id === previousActiveId)
				: undefined;
			const active = restored ?? defaultActive;
			if (picker.activeItems[0] !== active || picker.activeItems.length !== (active ? 1 : 0)) {
				picker.activeItems = active ? [active] : [];
			}
		};

		const renderScheduler = disposables.add(new AnimationFrameScheduler(this.element, () => render(true)));

		const refreshProvider = (provider: IBrowserUrlSuggestionProvider) => {
			const state = providerStates.get(provider);
			const input = this._host.input;
			if (!state || !input) {
				return;
			}
			state.cts.value?.cancel();
			const cts = new CancellationTokenSource();
			state.cts.value = cts;
			void provider.getSuggestions({ text: currentValue, input }, cts.token).then(
				results => {
					if (cts.token.isCancellationRequested || this._picker.value !== picker) {
						return;
					}
					state.suggestions = results;
					renderScheduler.schedule();
				},
				() => { }
			);
		};

		const refreshAllProviders = () => {
			for (const provider of this._suggestionProviders) {
				refreshProvider(provider);
			}
		};

		render(false);
		refreshAllProviders();

		for (const provider of this._suggestionProviders) {
			if (provider.onDidChange) {
				disposables.add(provider.onDidChange(() => refreshProvider(provider)));
			}
		}

		let selectionAtHide: { start: number; end: number; direction: 'forward' | 'backward' } | undefined;
		disposables.add(picker.onWillHide(() => {
			const active = this._urlDisplay.ownerDocument.activeElement;
			if (isHTMLInputElement(active) && active.selectionStart !== null && active.selectionEnd !== null) {
				selectionAtHide = {
					start: active.selectionStart,
					end: active.selectionEnd,
					direction: active.selectionDirection === 'backward' ? 'backward' : 'forward',
				};
			}
		}));
		disposables.add(picker.onDidChangeValue(value => {
			if (!this._isSettingPickerValue) {
				this._pickerEdited = true;
			}
			currentValue = value;
			renderScheduler.cancel();
			render(false);
			refreshAllProviders();
			this._renderUrl(value);
		}));

		const refreshButtons = () => {
			const input = this._host.input;
			if (!input) {
				picker.buttons = [];
				return;
			}
			const buttons: IBrowserUrlPickerAction[] = [];
			for (const provider of this._pickerActionProviders) {
				buttons.push(...provider.getActions(input));
			}
			picker.buttons = buttons;
		};
		refreshButtons();
		for (const provider of this._pickerActionProviders) {
			if (provider.onDidChange) {
				disposables.add(provider.onDidChange(refreshButtons));
			}
		}
		let actionTaken = false;
		disposables.add(picker.onDidTriggerButton(button => {
			actionTaken = true;
			const action = button as IBrowserUrlPickerAction;
			const input = this._host.input;
			if (typeof action.run === 'function' && input) {
				void Promise.resolve(action.run(input));
			}
		}));

		disposables.add(picker.onDidTriggerItemButton(({ button }) => {
			const action = button as IBrowserUrlSuggestionAction;
			const input = this._host.input;
			if (typeof action.run === 'function' && input) {
				void Promise.resolve(action.run(input));
			}
		}));
		disposables.add(picker.onDidTriggerSeparatorButton(({ button }) => {
			const action = button as IBrowserUrlSuggestionAction;
			const input = this._host.input;
			if (typeof action.run === 'function' && input) {
				void Promise.resolve(action.run(input));
			}
		}));
		disposables.add(picker.onDidAccept(() => {
			actionTaken = true;
			const active = picker.activeItems[0];
			const fallbackUrl = picker.value;
			const input = this._host.input;
			picker.hide();
			if (active?.apply) {
				if (input) {
					void Promise.resolve(active.apply(input));
				}
				return;
			}
			this._navigateText(active?.id ?? fallbackUrl);
		}));
		disposables.add(picker.onDidHide(({ reason }) => {
			this._urlDisplay.style.visibility = '';
			const replaced = this._quickInputService.currentQuickInput !== undefined
				&& this._quickInputService.currentQuickInput !== picker;
			const refocusDisplay = !actionTaken && reason !== QuickInputHideReason.Blur && !replaced;

			if (refocusDisplay) {
				this._urlDisplay.focus();
				if (selectionAtHide !== undefined) {
					this._setSelection(selectionAtHide.start, selectionAtHide.end, selectionAtHide.direction);
				}
			} else {
				this._renderUrl();
				if (actionTaken) {
					this._host.ensureBrowserFocus();
				}
			}
			disposables.dispose();
			this._pickerEdited = false;
			this._isSettingPickerValue = false;
			this._picker.clear();
		}));
		disposables.add(picker);

		this._picker.value = picker;
		picker.show();
	}
}
