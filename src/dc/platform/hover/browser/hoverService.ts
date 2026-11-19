/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { registerThemingParticipant } from '../../theme/common/themeService.js';
import { editorHoverBorder } from '../../theme/common/colorRegistry.js';
import { IHoverService } from './hover.js';
import { IContextMenuService } from '../../contextview/browser/contextView.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { HoverWidget } from './hoverWidget.js';
import { ContextView, ContextViewDOMPosition, IDelegate } from '../../../base/browser/ui/contextview/contextview.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { addDisposableListener, EventType, getActiveElement, isAncestorOfActiveElement, isAncestor, getWindow, isHTMLElement, isEditableElement } from '../../../base/browser/dom.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { StandardKeyboardEvent } from '../../../base/browser/keyboardEvent.js';
import { ResultKind } from '../../keybinding/common/keybindingResolver.js';
import { IAccessibilityService } from '../../accessibility/common/accessibility.js';
import { ILayoutService } from '../../layout/browser/layoutService.js';
import { mainWindow } from '../../../base/browser/window.js';
import { HoverStyle, isManagedHoverTooltipMarkdownString, type IHoverLifecycleOptions, type IHoverOptions, type IHoverTarget, type IHoverWidget, type IManagedHover, type IManagedHoverContentOrFactory, type IManagedHoverOptions } from '../../../base/browser/ui/hover/hover.js';
import type { IHoverDelegate, IHoverDelegateTarget } from '../../../base/browser/ui/hover/hoverDelegate.js';
import { ManagedHoverWidget } from './updatableHoverWidget.js';
import { timeout, TimeoutTimer } from '../../../base/common/async.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { isNumber, isString } from '../../../base/common/types.js';
import { KeyChord, KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../keybinding/common/keybindingsRegistry.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';
import { stripIcons } from '../../../base/common/iconLabels.js';

const MAX_HOVER_NESTING_DEPTH = 3;

interface IHoverStackEntry {
	readonly hover: HoverWidget;
	readonly options: IHoverOptions;
	readonly contextView: ContextView;
	readonly lastFocusedElementBeforeOpen: HTMLElement | undefined;
}

interface ICreateHoverResult {
	readonly hover: HoverWidget;
	readonly store: DisposableStore;
	readonly lastFocusedElementBeforeOpen: HTMLElement | undefined;
}

export class HoverService extends Disposable implements IHoverService {
	declare readonly _serviceBrand: undefined;

	private readonly _hoverStack: IHoverStackEntry[] = [];

	private _currentDelayedHover: HoverWidget | undefined;
	private _currentDelayedHoverWasShown: boolean = false;
	private _currentDelayedHoverGroupId: number | string | undefined;
	private _lastHoverOptions: IHoverOptions | undefined;
	private readonly _delayedHovers = new Map<HTMLElement, { show: (focus: boolean) => void }>();
	private readonly _managedHovers = new Map<HTMLElement, IManagedHover>();

	private get _currentHover(): HoverWidget | undefined {
		return this._hoverStack.at(-1)?.hover;
	}

	private get _currentHoverOptions(): IHoverOptions | undefined {
		return this._hoverStack.at(-1)?.options;
	}

	private _getContainingHoverIndex(target: HTMLElement | IHoverTarget): number {
		const targetElements = isHTMLElement(target) ? [target] : target.targetElements;
		for (let i = this._hoverStack.length - 1; i >= 0; i--) {
			for (const targetElement of targetElements) {
				if (isAncestor(targetElement, this._hoverStack[i].hover.domNode)) {
					return i;
				}
			}
		}
		return -1;
	}

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService
	) {
		super();

		this._register(contextMenuService.onDidShowContextMenu(() => this.hideHover()));

		this._register(KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: 'workbench.action.showHover',
			weight: KeybindingWeight.EditorCore,
			primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyI),
			handler: () => { this._showAndFocusHoverForActiveElement(); },
		}));
	}

	showInstantHover(options: IHoverOptions, focus?: boolean, skipLastFocusedUpdate?: boolean, dontShow?: boolean): IHoverWidget | undefined {
		const hover = this._createHover(options, skipLastFocusedUpdate);
		if (!hover) {
			return undefined;
		}
		this._showHover(hover, options, focus);
		return hover.hover;
	}

	showDelayedHover(
		options: IHoverOptions,
		lifecycleOptions: Pick<IHoverLifecycleOptions, 'groupId' | 'reducedDelay'>,
	): IHoverWidget | undefined {
		if (options.id === undefined) {
			options.id = getHoverIdFromContent(options.content);
		}

		if (!this._currentDelayedHover || this._currentDelayedHoverWasShown) {
			if (this._currentHover?.isLocked && this._getContainingHoverIndex(options.target) < 0) {
				return undefined;
			}

			if (getHoverOptionsIdentity(this._currentHoverOptions) === getHoverOptionsIdentity(options)) {
				return this._currentHover;
			}

			if (this._currentHover && !this._currentHover.isDisposed && this._currentDelayedHoverGroupId !== undefined && this._currentDelayedHoverGroupId === lifecycleOptions?.groupId) {
				return this.showInstantHover({
					...options,
					appearance: {
						...options.appearance,
						skipFadeInAnimation: true
					}
				});
			}
		} else if (this._currentDelayedHover && getHoverOptionsIdentity(this._currentHoverOptions) === getHoverOptionsIdentity(options)) {
			return this._currentDelayedHover;
		}

		const hover = this._createHover(options, undefined);
		if (!hover) {
			this._currentDelayedHover = undefined;
			this._currentDelayedHoverWasShown = false;
			this._currentDelayedHoverGroupId = undefined;
			return undefined;
		}

		this._currentDelayedHover = hover.hover;
		this._currentDelayedHoverWasShown = false;
		this._currentDelayedHoverGroupId = lifecycleOptions?.groupId;

		const delay = lifecycleOptions?.reducedDelay
			? this._configurationService.getValue<number>('workbench.hover.reducedDelay')
			: this._configurationService.getValue<number>('workbench.hover.delay');
		timeout(delay).then(() => {
			if (hover.hover && !hover.hover.isDisposed) {
				this._currentDelayedHoverWasShown = true;
				this._showHover(hover, options);
			}
		});

		return hover.hover;
	}

	setupDelayedHover(
		target: HTMLElement,
		options: (() => Omit<IHoverOptions, 'target'>) | Omit<IHoverOptions, 'target'>,
		lifecycleOptions?: IHoverLifecycleOptions,
	): IDisposable {
		const resolveHoverOptions = (e?: MouseEvent) => {
			const resolved: IHoverOptions = {
				...typeof options === 'function' ? options() : options,
				target
			};
			if (resolved.style === HoverStyle.Mouse && e) {
				resolved.target = resolveMouseStyleHoverTarget(target, e);
			}
			return resolved;
		};
		return this._setupDelayedHover(target, resolveHoverOptions, lifecycleOptions);
	}

	setupDelayedHoverAtMouse(
		target: HTMLElement,
		options: (() => Omit<IHoverOptions, 'target' | 'position'>) | Omit<IHoverOptions, 'target' | 'position'>,
		lifecycleOptions?: IHoverLifecycleOptions,
	): IDisposable {
		const resolveHoverOptions = (e?: MouseEvent) => ({
			...typeof options === 'function' ? options() : options,
			target: e ? resolveMouseStyleHoverTarget(target, e) : target
		} satisfies IHoverOptions);
		return this._setupDelayedHover(target, resolveHoverOptions, lifecycleOptions);
	}

	private _setupDelayedHover(
		target: HTMLElement,
		resolveHoverOptions: ((e?: MouseEvent) => IHoverOptions),
		lifecycleOptions?: IHoverLifecycleOptions,
	) {
		const store = new DisposableStore();
		store.add(addDisposableListener(target, EventType.MOUSE_OVER, e => {
			this.showDelayedHover(resolveHoverOptions(e), {
				groupId: lifecycleOptions?.groupId,
				reducedDelay: lifecycleOptions?.reducedDelay,
			});
		}));
		if (lifecycleOptions?.setupKeyboardEvents) {
			store.add(addDisposableListener(target, EventType.KEY_DOWN, e => {
				const evt = new StandardKeyboardEvent(e);
				if (evt.equals(KeyCode.Space) || evt.equals(KeyCode.Enter)) {
					this.showInstantHover(resolveHoverOptions(), true);
				}
			}));
		}

		this._delayedHovers.set(target, { show: (focus: boolean) => { this.showInstantHover(resolveHoverOptions(), focus); } });
		store.add(toDisposable(() => this._delayedHovers.delete(target)));

		return store;
	}

	private _createHover(options: IHoverOptions, skipLastFocusedUpdate?: boolean): ICreateHoverResult | undefined {
		this._currentDelayedHover?.dispose();
		this._currentDelayedHover = undefined;

		if (options.content === '') {
			return undefined;
		}

		if (options.id === undefined) {
			options.id = getHoverIdFromContent(options.content);
		}

		const containingHoverIndex = this._getContainingHoverIndex(options.target);
		const isNesting = containingHoverIndex >= 0;

		if (isNesting) {
			if (this._hoverStack.length >= MAX_HOVER_NESTING_DEPTH) {
				return undefined;
			}
		} else {
			if (this._currentHover?.isLocked) {
				return undefined;
			}

			if (getHoverOptionsIdentity(this._currentHoverOptions) === getHoverOptionsIdentity(options)) {
				return undefined;
			}
		}

		this._lastHoverOptions = options;
		const trapFocus = options.trapFocus || this._accessibilityService.isScreenReaderOptimized();
		const activeElement = getActiveElement();
		let lastFocusedElementBeforeOpen: HTMLElement | undefined;
		if (!skipLastFocusedUpdate) {
			if (trapFocus && activeElement) {
				if (!activeElement.classList.contains('monaco-hover')) {
					lastFocusedElementBeforeOpen = activeElement as HTMLElement;
				}
			}
		}

		const hoverDisposables = new DisposableStore();
		const hover = this._instantiationService.createInstance(HoverWidget, options);
		if (options.persistence?.sticky) {
			hover.isLocked = true;
		}

		if (options.position?.hoverPosition && !isNumber(options.position.hoverPosition)) {
			options.target = {
				targetElements: isHTMLElement(options.target) ? [options.target] : options.target.targetElements,
				x: options.position.hoverPosition.x + 10
			};
		}

		hover.onDispose(() => {
			const stackIndex = this._hoverStack.findIndex(entry => entry.hover === hover);
			if (stackIndex >= 0) {
				const entry = this._hoverStack[stackIndex];
				const hoverWasFocused = isAncestorOfActiveElement(hover.domNode);
				if (hoverWasFocused && entry.lastFocusedElementBeforeOpen) {
					entry.lastFocusedElementBeforeOpen.focus();
				}
				while (this._hoverStack.length > stackIndex + 1) {
					const nestedEntry = this._hoverStack.pop()!;
					nestedEntry.contextView.dispose();
					nestedEntry.hover.dispose();
				}
				this._hoverStack.splice(stackIndex, 1);
				entry.contextView.dispose();
			}
			hoverDisposables.dispose();
		}, undefined, hoverDisposables);

		if (!options.container) {
			const targetElement = isHTMLElement(options.target) ? options.target : options.target.targetElements[0];
			options.container = this._layoutService.getContainer(getWindow(targetElement));
		}

		hoverDisposables.add(addDisposableListener(getWindow(options.container).document, EventType.MOUSE_DOWN, e => {
			if (!isAncestor(e.target as HTMLElement, hover.domNode)) {
				this._hideHoverAndDescendants(hover);
			}
		}));

		if (!options.persistence?.sticky) {
			if ('targetElements' in options.target) {
				for (const element of options.target.targetElements) {
					hoverDisposables.add(addDisposableListener(element, EventType.CLICK, () => this._hideHoverAndDescendants(hover)));
				}
			} else {
				hoverDisposables.add(addDisposableListener(options.target, EventType.CLICK, () => this._hideHoverAndDescendants(hover)));
			}
			const focusedElement = getActiveElement();
			if (focusedElement) {
				const focusedElementDocument = getWindow(focusedElement).document;
				hoverDisposables.add(addDisposableListener(focusedElement, EventType.KEY_DOWN, e => this._keyDown(e, hover, !!options.persistence?.hideOnKeyDown)));
				hoverDisposables.add(addDisposableListener(focusedElementDocument, EventType.KEY_DOWN, e => this._keyDown(e, hover, !!options.persistence?.hideOnKeyDown)));
				hoverDisposables.add(addDisposableListener(focusedElement, EventType.KEY_UP, e => this._keyUp(e, hover)));
				hoverDisposables.add(addDisposableListener(focusedElementDocument, EventType.KEY_UP, e => this._keyUp(e, hover)));
			}
		}

		if ('IntersectionObserver' in mainWindow) {
			const observer = new IntersectionObserver(e => this._intersectionChange(e, hover), { threshold: 0 });
			const firstTargetElement = 'targetElements' in options.target ? options.target.targetElements[0] : options.target;
			observer.observe(firstTargetElement);
			hoverDisposables.add(toDisposable(() => observer.disconnect()));
		}

		return { hover, lastFocusedElementBeforeOpen, store: hoverDisposables };
	}

	private _showHover(result: ICreateHoverResult, options: IHoverOptions, focus?: boolean) {
		const { hover, lastFocusedElementBeforeOpen, store } = result;

		const containingHoverIndex = this._getContainingHoverIndex(options.target);
		const isNesting = containingHoverIndex >= 0;

		if (!isNesting) {
			this._hideAllHovers();
		} else {
			for (let i = this._hoverStack.length - 1; i > containingHoverIndex; i--) {
				this._hoverStack[i].hover.dispose();
			}
			this._hoverStack.length = containingHoverIndex + 1;
		}

		if (isNesting) {
			for (let i = 0; i <= containingHoverIndex; i++) {
				store.add(this._hoverStack[i].hover.addMouseTrackingElement(hover.domNode));
			}
		}

		const container = options.container ?? this._layoutService.getContainer(getWindow(isHTMLElement(options.target) ? options.target : options.target.targetElements[0]));
		const contextView = new ContextView(container, ContextViewDOMPosition.ABSOLUTE);

		const stackEntry: IHoverStackEntry = {
			hover,
			options,
			contextView,
			lastFocusedElementBeforeOpen
		};
		this._hoverStack.push(stackEntry);

		const delegate = new HoverContextViewDelegate(hover, focus, this._hoverStack.length);
		contextView.show(delegate);

		store.add(hover.onRequestLayout(() => contextView.layout()));

		if (focus || options.persistence?.sticky) {
			const targetWindow = getWindow(container);
			store.add(addDisposableListener(targetWindow, EventType.RESIZE, () => contextView.layout()));
		}

		if (options.onDidHide) {
			const onDidHide = options.onDidHide;
			store.add(toDisposable(() => onDidHide()));
		}
		options.onDidShow?.();
	}

	private _hideHoverAndDescendants(hover: HoverWidget): void {
		const stackIndex = this._hoverStack.findIndex(entry => entry.hover === hover);
		if (stackIndex < 0) {
			return;
		}

		for (let i = this._hoverStack.length - 1; i >= stackIndex; i--) {
			this._hoverStack[i].hover.dispose();
		}
		this._hoverStack.length = stackIndex;
	}

	private _hideAllHovers(): void {
		for (let i = this._hoverStack.length - 1; i >= 0; i--) {
			this._hoverStack[i].hover.dispose();
		}
		this._hoverStack.length = 0;
	}

	hideHover(force?: boolean): void {
		if (this._hoverStack.length === 0) {
			return;
		}

		if (!force && this._currentHover?.isLocked) {
			return;
		}

		this.doHideHover();
	}

	private doHideHover(): void {
		const length = this._hoverStack.length;
		this._hoverStack[length - 1]?.hover.dispose();
		this._hoverStack.length = length - 1;

	}

	private _intersectionChange(entries: IntersectionObserverEntry[], hover: IDisposable): void {
		const entry = entries[entries.length - 1];
		if (!entry.isIntersecting) {
			hover.dispose();
		}
	}

	showAndFocusLastHover(): void {
		if (!this._lastHoverOptions) {
			return;
		}
		this.showInstantHover(this._lastHoverOptions, true, true);
	}

	private _showAndFocusHoverForActiveElement(): void {

		let activeElement = getActiveElement() as HTMLElement | null;
		while (activeElement) {
			const hover = this._delayedHovers.get(activeElement) ?? this._managedHovers.get(activeElement);
			if (hover) {
				hover.show(true);
				return;
			}

			activeElement = activeElement.parentElement;
		}
	}

	private _keyDown(e: KeyboardEvent, hover: HoverWidget, hideOnKeyDown: boolean) {
		if (e.key === 'Alt') {
			for (const entry of this._hoverStack) {
				entry.hover.isLocked = true;
			}
			return;
		}
		const event = new StandardKeyboardEvent(e);
		const keybinding = this._keybindingService.resolveKeyboardEvent(event);
		if (keybinding.getSingleModifierDispatchChords().some(value => !!value) || this._keybindingService.softDispatch(event, event.target).kind !== ResultKind.NoMatchingKb) {
			return;
		}
		if (hideOnKeyDown && (!this._currentHoverOptions?.trapFocus || e.key !== 'Tab')) {
			const stackEntry = this._hoverStack.find(entry => entry.hover === hover);
			this._hideHoverAndDescendants(hover);
			stackEntry?.lastFocusedElementBeforeOpen?.focus();
		}
	}

	private _keyUp(e: KeyboardEvent, hover: HoverWidget) {
		if (e.key === 'Alt') {
			for (const entry of this._hoverStack) {
				if (!entry.options.persistence?.sticky) {
					entry.hover.isLocked = false;
				}
			}
			const anyMouseIn = this._hoverStack.some(entry => entry.hover.isMouseIn);
			if (!anyMouseIn) {
				const topEntry = this._hoverStack[this._hoverStack.length - 1];
				this._hideAllHovers();
				topEntry?.lastFocusedElementBeforeOpen?.focus();
			}
		}
	}

	setupManagedHover(hoverDelegate: IHoverDelegate, targetElement: HTMLElement, content: IManagedHoverContentOrFactory, options?: IManagedHoverOptions | undefined): IManagedHover {
		if (hoverDelegate.showNativeHover) {
			return setupNativeHover(targetElement, content);
		}

		targetElement.setAttribute('custom-hover', 'true');

		if (targetElement.title !== '') {
			console.warn('HTML element already has a title attribute, which will conflict with the custom hover. Please remove the title attribute.');
			targetElement.title = '';
		}

		let hoverPreparation: IDisposable | undefined;
		let hoverWidget: ManagedHoverWidget | undefined;

		const hideHover = (disposeWidget: boolean, disposePreparation: boolean) => {
			const hadHover = hoverWidget !== undefined;
			if (disposeWidget) {
				hoverWidget?.dispose();
				hoverWidget = undefined;
			}
			if (disposePreparation) {
				hoverPreparation?.dispose();
				hoverPreparation = undefined;
			}
			if (hadHover) {
				hoverDelegate.onDidHideHover?.();
				hoverWidget = undefined;
			}
		};

		const triggerShowHover = (delay: number, focus?: boolean, target?: IHoverDelegateTarget, trapFocus?: boolean) => {
			return new TimeoutTimer(async () => {
				if (!hoverWidget || hoverWidget.isDisposed) {
					hoverWidget = new ManagedHoverWidget(hoverDelegate, target || targetElement, delay > 0);
					await hoverWidget.update(typeof content === 'function' ? content() : content, focus, { ...options, trapFocus });
				}
			}, delay);
		};

		const store = new DisposableStore();
		let isMouseDown = false;
		store.add(addDisposableListener(targetElement, EventType.MOUSE_DOWN, () => {
			isMouseDown = true;
			hideHover(true, true);
		}, true));
		store.add(addDisposableListener(targetElement, EventType.MOUSE_UP, () => {
			isMouseDown = false;
		}, true));
		store.add(addDisposableListener(targetElement, EventType.MOUSE_LEAVE, (e: MouseEvent) => {
			isMouseDown = false;
			interface MouseEventWithFrom extends MouseEvent {
				fromElement: Element | null;
			}
			hideHover(false, (e as MouseEventWithFrom).fromElement === targetElement);
		}, true));
		store.add(addDisposableListener(targetElement, EventType.MOUSE_OVER, (e: MouseEvent) => {
			if (hoverPreparation) {
				return;
			}

			const mouseOverStore: DisposableStore = new DisposableStore();

			const target: IHoverDelegateTarget = {
				targetElements: [targetElement],
				dispose: () => { }
			};
			if (hoverDelegate.placement === undefined || hoverDelegate.placement === 'mouse') {
				const onMouseMove = (e: MouseEvent) => {
					target.x = e.x + 10;
					if (!eventIsRelatedToTarget(e, targetElement)) {
						hideHover(true, true);
					}
				};
				mouseOverStore.add(addDisposableListener(targetElement, EventType.MOUSE_MOVE, onMouseMove, true));
			}

			hoverPreparation = mouseOverStore;

			if (!eventIsRelatedToTarget(e, targetElement)) {
				return;
			}

			mouseOverStore.add(triggerShowHover(typeof hoverDelegate.delay === 'function' ? hoverDelegate.delay(content) : hoverDelegate.delay, false, target));
		}, true));

		const onFocus = (e: FocusEvent) => {
			if (isMouseDown || hoverPreparation) {
				return;
			}
			if (hoverWidget?.isDisposed) {
				hoverWidget = undefined;
			}
			const fromHover = isHTMLElement(e.relatedTarget) && e.relatedTarget.closest('.monaco-hover');
			if (fromHover || !e.relatedTarget) {
				return;
			}
			if (!eventIsRelatedToTarget(e, targetElement)) {
				return;
			}

			const target: IHoverDelegateTarget = {
				targetElements: [targetElement],
				dispose: () => { }
			};
			const toDispose: DisposableStore = new DisposableStore();
			const onBlur = () => hideHover(true, true);
			toDispose.add(addDisposableListener(targetElement, EventType.BLUR, onBlur, true));
			toDispose.add(triggerShowHover(typeof hoverDelegate.delay === 'function' ? hoverDelegate.delay(content) : hoverDelegate.delay, false, target));
			hoverPreparation = toDispose;
		};

		if (!isEditableElement(targetElement)) {
			store.add(addDisposableListener(targetElement, EventType.FOCUS, onFocus, true));
		}

		const hover: IManagedHover = {
			show: focus => {
				hideHover(false, true);
				triggerShowHover(0, focus, undefined, focus);
			},
			hide: () => {
				hideHover(true, true);
			},
			update: async (newContent, hoverOptions) => {
				content = newContent;
				await hoverWidget?.update(content, undefined, hoverOptions);
			},
			dispose: () => {
				this._managedHovers.delete(targetElement);
				store.dispose();
				hideHover(true, true);
			}
		};
		this._managedHovers.set(targetElement, hover);
		return hover;
	}

	showManagedHover(target: HTMLElement): void {
		const hover = this._managedHovers.get(target);
		if (hover) {
			hover.show(true);
		}
	}

	public override dispose(): void {
		this._managedHovers.forEach(hover => hover.dispose());
		super.dispose();
	}
}

function getHoverOptionsIdentity(options: IHoverOptions | undefined): IHoverOptions | number | string | undefined {
	if (options === undefined) {
		return undefined;
	}
	return options?.id ?? options;
}

function getHoverIdFromContent(content: string | HTMLElement | IMarkdownString): string | undefined {
	if (isHTMLElement(content)) {
		return undefined;
	}
	if (typeof content === 'string') {
		return content.toString();
	}
	return content.value;
}

function getStringContent(contentOrFactory: IManagedHoverContentOrFactory): string | undefined {
	const content = typeof contentOrFactory === 'function' ? contentOrFactory() : contentOrFactory;
	if (isString(content)) {
		return stripIcons(content);
	}
	if (isManagedHoverTooltipMarkdownString(content)) {
		return content.markdownNotSupportedFallback;
	}
	return undefined;
}

function setupNativeHover(targetElement: HTMLElement, content: IManagedHoverContentOrFactory): IManagedHover {
	function updateTitle(title: string | undefined) {
		if (title) {
			targetElement.setAttribute('title', title);
		} else {
			targetElement.removeAttribute('title');
		}
	}

	updateTitle(getStringContent(content));
	return {
		update: (content) => updateTitle(getStringContent(content)),
		show: () => { },
		hide: () => { },
		dispose: () => updateTitle(undefined),
	};
}

class HoverContextViewDelegate implements IDelegate {

	public readonly layer: number;

	get anchorPosition() {
		return this._hover.anchor;
	}

	constructor(
		private readonly _hover: HoverWidget,
		private readonly _focus: boolean = false,
		stackDepth: number = 1
	) {
		this.layer = stackDepth;
	}

	render(container: HTMLElement) {
		this._hover.render(container);
		if (this._focus) {
			this._hover.focus();
		}
		return this._hover;
	}

	getAnchor() {
		return {
			x: this._hover.x,
			y: this._hover.y
		};
	}

	layout() {
		this._hover.layout();
	}
}

function eventIsRelatedToTarget(event: UIEvent, target: HTMLElement): boolean {
	return isHTMLElement(event.target) && getHoverTargetElement(event.target, target) === target;
}

function getHoverTargetElement(element: HTMLElement, stopElement?: HTMLElement): HTMLElement {
	stopElement = stopElement ?? getWindow(element).document.body;
	while (!element.hasAttribute('custom-hover') && element !== stopElement) {
		element = element.parentElement!;
	}
	return element;
}

function resolveMouseStyleHoverTarget(target: HTMLElement, e: MouseEvent): IHoverTarget {
	return {
		targetElements: [target],
		x: e.x + 10
	};
}

registerSingleton(IHoverService, HoverService, InstantiationType.Delayed);

registerThemingParticipant((theme, collector) => {
	const hoverBorder = theme.getColor(editorHoverBorder);
	if (hoverBorder) {
		collector.addRule(`.monaco-hover.workbench-hover .hover-row:not(:first-child):not(:empty) { border-top: 1px solid ${hoverBorder.transparent(0.5)}; }`);
		collector.addRule(`.monaco-hover.workbench-hover hr { border-top: 1px solid ${hoverBorder.transparent(0.5)}; }`);
	}
});
