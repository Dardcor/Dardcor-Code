/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './hover.css';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../base/common/event.js';
import * as dom from '../../../base/browser/dom.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { HoverAction, HoverPosition, HoverWidget as BaseHoverWidget, getHoverAccessibleViewHint } from '../../../base/browser/ui/hover/hoverWidget.js';
import { Widget } from '../../../base/browser/ui/widget.js';
import { AnchorAlignment, AnchorPosition } from '../../../base/browser/ui/contextview/contextview.js';
import { IMarkdownRendererService } from '../../markdown/browser/markdownRenderer.js';
import { isMarkdownString } from '../../../base/common/htmlContent.js';
import { localize } from '../../../nls.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { IAccessibilityService } from '../../accessibility/common/accessibility.js';
import { status } from '../../../base/browser/ui/aria/aria.js';
import { HoverStyle, type IHoverOptions, type IHoverTarget, type IHoverWidget } from '../../../base/browser/ui/hover/hover.js';
import { TimeoutTimer } from '../../../base/common/async.js';
import { isNumber } from '../../../base/common/types.js';

const $ = dom.$;
type TargetRect = {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
	center: { x: number; y: number };
};

const enum Constants {
	PointerSize = 3,
	HoverBorderWidth = 2,
	HoverWindowEdgeMargin = 2,
}

export class HoverWidget extends Widget implements IHoverWidget {
	private readonly _messageListeners = new DisposableStore();
	private readonly _lockMouseTracker: CompositeMouseTracker;

	private readonly _hover: BaseHoverWidget;
	private readonly _hoverPointer: HTMLElement | undefined;
	private readonly _hoverContainer: HTMLElement;
	private readonly _target: IHoverTarget;
	private readonly _anchorAlignment: AnchorAlignment;
	private readonly _linkHandler: ((url: string) => void) | undefined;

	private _isDisposed: boolean = false;
	private _hoverPosition: HoverPosition;
	private _forcePosition: boolean = false;
	private _x: number = 0;
	private _y: number = 0;
	private _isLocked: boolean = false;
	private _enableFocusTraps: boolean = false;
	private _addedFocusTrap: boolean = false;
	private _maxHeightRatioRelativeToWindow: number = 0.5;
	private _mouseTracker: CompositeMouseTracker | undefined;

	private get _targetWindow(): Window {
		return dom.getWindow(this._target.targetElements[0]);
	}
	private get _targetDocumentElement(): HTMLElement {
		return dom.getWindow(this._target.targetElements[0]).document.documentElement;
	}

	get isDisposed(): boolean { return this._isDisposed; }
	get isMouseIn(): boolean { return this._lockMouseTracker.isMouseIn; }
	get domNode(): HTMLElement { return this._hover.containerDomNode; }

	private readonly _onDispose = this._register(new Emitter<void>());
	get onDispose(): Event<void> { return this._onDispose.event; }
	private readonly _onRequestLayout = this._register(new Emitter<void>());
	get onRequestLayout(): Event<void> { return this._onRequestLayout.event; }

	get anchor(): AnchorPosition { return this._hoverPosition === HoverPosition.BELOW ? AnchorPosition.BELOW : AnchorPosition.ABOVE; }
	get x(): number { return this._x; }
	get y(): number { return this._y; }

	get isLocked(): boolean { return this._isLocked; }
	set isLocked(value: boolean) {
		if (this._isLocked === value) {
			return;
		}
		this._isLocked = value;
		this._hoverContainer.classList.toggle('locked', this._isLocked);
	}

	addMouseTrackingElement(element: HTMLElement): IDisposable {
		return this._lockMouseTracker.addElement(element);
	}

	constructor(
		options: IHoverOptions,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IMarkdownRendererService private readonly _markdownRenderer: IMarkdownRendererService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService
	) {
		super();

		this._linkHandler = options.linkHandler;

		this._target = 'targetElements' in options.target ? options.target : new ElementHoverTarget(options.target);
		this._anchorAlignment = options.position?.anchorAlignment ?? AnchorAlignment.LEFT;

		if (options.style) {
			switch (options.style) {
				case HoverStyle.Pointer: {
					options.appearance ??= {};
					options.appearance.compact ??= true;
					options.appearance.showPointer ??= true;
					break;
				}
				case HoverStyle.Mouse: {
					options.appearance ??= {};
					options.appearance.compact ??= true;
					break;
				}
			}
		}

		this._hoverPointer = options.appearance?.showPointer ? $('div.workbench-hover-pointer') : undefined;
		this._hover = this._register(new BaseHoverWidget(!options.appearance?.skipFadeInAnimation));
		this._hover.containerDomNode.classList.add('workbench-hover');
		if (options.appearance?.compact) {
			this._hover.containerDomNode.classList.add('workbench-hover', 'compact');
		}
		if (this._hoverPointer) {
			this._hover.containerDomNode.classList.add('with-pointer');
		}
		if (options.additionalClasses) {
			this._hover.containerDomNode.classList.add(...options.additionalClasses);
		}
		if (options.position?.forcePosition) {
			this._forcePosition = true;
		}
		if (options.trapFocus) {
			this._enableFocusTraps = true;
		}

		const maxHeightRatio = options.appearance?.maxHeightRatio;
		if (maxHeightRatio !== undefined && maxHeightRatio > 0 && maxHeightRatio <= 1) {
			this._maxHeightRatioRelativeToWindow = maxHeightRatio;
		}

		this._hoverPosition = options.position?.hoverPosition === undefined
			? HoverPosition.ABOVE
			: isNumber(options.position.hoverPosition)
				? options.position.hoverPosition
				: HoverPosition.BELOW;

		this.onmousedown(this._hover.containerDomNode, e => e.stopPropagation());

		this.onkeydown(this._hover.containerDomNode, e => {
			if (e.equals(KeyCode.Escape)) {
				this.dispose();
			}
		});

		this._register(dom.addDisposableListener(this._targetWindow, 'blur', () => this.dispose()));

		const rowElement = $('div.hover-row.markdown-hover');
		const contentsElement = $('div.hover-contents');
		if (typeof options.content === 'string') {
			contentsElement.textContent = options.content;
			contentsElement.style.whiteSpace = 'pre-wrap';

		} else if (dom.isHTMLElement(options.content)) {
			contentsElement.appendChild(options.content);
			contentsElement.classList.add('html-hover-contents');

			const resizeObserver = new ResizeObserver(() => {
				this.layout();
				this._onRequestLayout.fire();
			});
			resizeObserver.observe(contentsElement);
			this._register(toDisposable(() => resizeObserver.disconnect()));

		} else {
			const markdown = options.content;

			const { element } = this._register(this._markdownRenderer.render(markdown, {
				actionHandler: this._linkHandler,
				asyncRenderCallback: () => {
					contentsElement.classList.add('code-hover-contents');
					this.layout();
					this._onRequestLayout.fire();
				}
			}));
			contentsElement.appendChild(element);
		}
		rowElement.appendChild(contentsElement);
		this._hover.contentsDomNode.appendChild(rowElement);

		if (options.actions && options.actions.length > 0) {
			const statusBarElement = $('div.hover-row.status-bar');
			const actionsElement = $('div.actions');
			options.actions.forEach(action => {
				const keybinding = this._keybindingService.lookupKeybinding(action.commandId);
				const keybindingLabel = keybinding ? keybinding.getLabel() : null;
				this._register(HoverAction.render(actionsElement, {
					label: action.label,
					commandId: action.commandId,
					run: e => {
						action.run(e);
						this.dispose();
					},
					iconClass: action.iconClass
				}, keybindingLabel));
			});
			statusBarElement.appendChild(actionsElement);
			this._hover.containerDomNode.appendChild(statusBarElement);
		}

		this._hoverContainer = $('div.workbench-hover-container');
		if (this._hoverPointer) {
			this._hoverContainer.appendChild(this._hoverPointer);
		}
		this._hoverContainer.appendChild(this._hover.containerDomNode);

		let hideOnHover: boolean;
		if (options.actions && options.actions.length > 0) {
			hideOnHover = false;
		} else {
			if (options.persistence?.hideOnHover === undefined) {
				hideOnHover = typeof options.content === 'string' ||
					isMarkdownString(options.content) && !options.content.value.includes('](') && !options.content.value.includes('</a>');
			} else {
				hideOnHover = options.persistence.hideOnHover;
			}
		}

		if (options.appearance?.showHoverHint) {
			const statusBarElement = $('div.hover-row.status-bar');
			const infoElement = $('div.info');
			infoElement.textContent = localize('hoverhint', 'Hold {0} key to mouse over', isMacintosh ? 'Option' : 'Alt');
			statusBarElement.appendChild(infoElement);
			this._hover.containerDomNode.appendChild(statusBarElement);
		}

		const mouseTrackerTargets = [...this._target.targetElements];
		if (!hideOnHover) {
			mouseTrackerTargets.push(this._hoverContainer);
		}
		const mouseTracker = this._mouseTracker = this._register(new CompositeMouseTracker(mouseTrackerTargets));
		this._register(mouseTracker.onMouseOut(() => {
			if (!this._isLocked) {
				this.dispose();
			}
		}));

		if (hideOnHover) {
			const mouseTracker2Targets = [...this._target.targetElements, this._hoverContainer];
			this._lockMouseTracker = this._register(new CompositeMouseTracker(mouseTracker2Targets));
			this._register(this._lockMouseTracker.onMouseOut(() => {
				if (!this._isLocked) {
					this.dispose();
				}
			}));
		} else {
			this._lockMouseTracker = mouseTracker;
		}
	}

	private addFocusTrap() {
		if (!this._enableFocusTraps || this._addedFocusTrap) {
			return;
		}
		this._addedFocusTrap = true;

		const firstContainerFocusElement = this._hover.containerDomNode;
		const lastContainerFocusElement = this.findLastFocusableChild(this._hover.containerDomNode);
		if (lastContainerFocusElement) {
			const beforeContainerFocusElement = dom.prepend(this._hoverContainer, $('div'));
			const afterContainerFocusElement = dom.append(this._hoverContainer, $('div'));
			beforeContainerFocusElement.tabIndex = 0;
			afterContainerFocusElement.tabIndex = 0;
			this._register(dom.addDisposableListener(afterContainerFocusElement, 'focus', (e) => {
				firstContainerFocusElement.focus();
				e.preventDefault();
			}));
			this._register(dom.addDisposableListener(beforeContainerFocusElement, 'focus', (e) => {
				lastContainerFocusElement.focus();
				e.preventDefault();
			}));
		}
	}

	private findLastFocusableChild(root: Node): HTMLElement | undefined {
		if (root.hasChildNodes()) {
			for (let i = 0; i < root.childNodes.length; i++) {
				const node = root.childNodes.item(root.childNodes.length - i - 1);
				if (node.nodeType === node.ELEMENT_NODE) {
					const parsedNode = node as HTMLElement;
					if (typeof parsedNode.tabIndex === 'number' && parsedNode.tabIndex >= 0) {
						return parsedNode;
					}
				}
				const recursivelyFoundElement = this.findLastFocusableChild(node);
				if (recursivelyFoundElement) {
					return recursivelyFoundElement;
				}
			}
		}
		return undefined;
	}

	public render(container: HTMLElement): void {
		container.appendChild(this._hoverContainer);
		const hoverFocused = this._hoverContainer.contains(this._hoverContainer.ownerDocument.activeElement);
		const accessibleViewHint = hoverFocused && getHoverAccessibleViewHint(this._configurationService.getValue('accessibility.verbosity.hover') === true && this._accessibilityService.isScreenReaderOptimized(), this._keybindingService.lookupKeybinding('editor.action.accessibleView')?.getAriaLabel());
		if (accessibleViewHint) {

			status(accessibleViewHint);
		}
		this.layout();
		this.addFocusTrap();
	}

	public layout() {
		this._mouseTracker?.suppressPendingMouseOut();
		if (this._lockMouseTracker !== this._mouseTracker) {
			this._lockMouseTracker?.suppressPendingMouseOut();
		}

		this._hover.containerDomNode.classList.remove('right-aligned');
		this._hover.contentsDomNode.style.maxHeight = '';
		this._hover.containerDomNode.style.maxWidth = '';

		const getZoomAccountedBoundingClientRect = (e: HTMLElement) => {
			const zoom = dom.getDomNodeZoomLevel(e);

			const boundingRect = e.getBoundingClientRect();
			return {
				top: boundingRect.top * zoom,
				bottom: boundingRect.bottom * zoom,
				right: boundingRect.right * zoom,
				left: boundingRect.left * zoom,
			};
		};

		const targetBounds = this._target.targetElements.map(e => getZoomAccountedBoundingClientRect(e));
		const { top, right, bottom, left } = targetBounds[0];
		const width = right - left;
		const height = bottom - top;

		const targetRect: TargetRect = {
			top, right, bottom, left, width, height,
			center: {
				x: left + (width / 2),
				y: top + (height / 2)
			}
		};

		this.adjustHorizontalHoverPosition(targetRect);
		this.adjustVerticalHoverPosition(targetRect);
		this.adjustHoverMaxHeight(targetRect);

		this._hoverContainer.style.padding = '';
		this._hoverContainer.style.margin = '';
		if (this._hoverPointer) {
			switch (this._hoverPosition) {
				case HoverPosition.RIGHT:
					targetRect.left += Constants.PointerSize;
					targetRect.right += Constants.PointerSize;
					this._hoverContainer.style.paddingLeft = `${Constants.PointerSize}px`;
					this._hoverContainer.style.marginLeft = `${-Constants.PointerSize}px`;
					break;
				case HoverPosition.LEFT:
					targetRect.left -= Constants.PointerSize;
					targetRect.right -= Constants.PointerSize;
					this._hoverContainer.style.paddingRight = `${Constants.PointerSize}px`;
					this._hoverContainer.style.marginRight = `${-Constants.PointerSize}px`;
					break;
				case HoverPosition.BELOW:
					targetRect.top += Constants.PointerSize;
					targetRect.bottom += Constants.PointerSize;
					this._hoverContainer.style.paddingTop = `${Constants.PointerSize}px`;
					this._hoverContainer.style.marginTop = `${-Constants.PointerSize}px`;
					break;
				case HoverPosition.ABOVE:
					targetRect.top -= Constants.PointerSize;
					targetRect.bottom -= Constants.PointerSize;
					this._hoverContainer.style.paddingBottom = `${Constants.PointerSize}px`;
					this._hoverContainer.style.marginBottom = `${-Constants.PointerSize}px`;
					break;
			}

			targetRect.center.x = targetRect.left + (width / 2);
			targetRect.center.y = targetRect.top + (height / 2);
		}

		this.computeXCordinate(targetRect);
		this.computeYCordinate(targetRect);

		if (this._hoverPointer) {
			this._hoverPointer.classList.remove('top');
			this._hoverPointer.classList.remove('left');
			this._hoverPointer.classList.remove('right');
			this._hoverPointer.classList.remove('bottom');

			this.setHoverPointerPosition(targetRect);
		}
		this._hover.onContentsChanged();
	}

	private computeXCordinate(target: TargetRect): void {
		const hoverWidth = this._hover.containerDomNode.clientWidth + Constants.HoverBorderWidth;

		if (this._target.x !== undefined) {
			this._x = this._target.x;
		}

		else if (this._hoverPosition === HoverPosition.RIGHT) {
			this._x = target.right;
		}

		else if (this._hoverPosition === HoverPosition.LEFT) {
			this._x = target.left - hoverWidth;
		}

		else {
			if (this._anchorAlignment === AnchorAlignment.RIGHT) {
				this._x = target.right - hoverWidth;
			} else if (this._hoverPointer) {
				this._x = target.center.x - (this._hover.containerDomNode.clientWidth / 2);
			} else {
				this._x = target.left;
			}

			if (this._x + hoverWidth >= this._targetDocumentElement.clientWidth) {
				this._hover.containerDomNode.classList.add('right-aligned');
				this._x = Math.max(this._targetDocumentElement.clientWidth - hoverWidth - Constants.HoverWindowEdgeMargin, this._targetDocumentElement.clientLeft);
			}
		}

		if (this._x < this._targetDocumentElement.clientLeft) {
			this._x = target.left + Constants.HoverWindowEdgeMargin;
		}

	}

	private computeYCordinate(target: TargetRect): void {
		if (this._target.y !== undefined) {
			this._y = this._target.y;
		}

		else if (this._hoverPosition === HoverPosition.ABOVE) {
			this._y = target.top;
		}

		else if (this._hoverPosition === HoverPosition.BELOW) {
			this._y = target.bottom - 2;
		}

		else {
			if (this._hoverPointer) {
				this._y = target.center.y + (this._hover.containerDomNode.clientHeight / 2);
			} else {
				this._y = target.bottom;
			}
		}

		if (this._y > this._targetWindow.innerHeight) {
			this._y = target.bottom;
		}
	}

	private adjustHorizontalHoverPosition(target: TargetRect): void {
		if (this._target.x !== undefined) {
			return;
		}

		if (this._anchorAlignment === AnchorAlignment.RIGHT && (this._hoverPosition === HoverPosition.ABOVE || this._hoverPosition === HoverPosition.BELOW)) {
			const availableWidth = target.right - this._targetDocumentElement.clientLeft - Constants.HoverWindowEdgeMargin - Constants.HoverBorderWidth;
			if (this._hover.containerDomNode.clientWidth > availableWidth) {
				this._hover.containerDomNode.style.maxWidth = `${Math.max(availableWidth, 0)}px`;
			}
			return;
		}

		const hoverPointerOffset = (this._hoverPointer ? Constants.PointerSize : 0);

		if (this._forcePosition) {
			const padding = hoverPointerOffset + Constants.HoverBorderWidth;
			if (this._hoverPosition === HoverPosition.RIGHT) {
				this._hover.containerDomNode.style.maxWidth = `${this._targetDocumentElement.clientWidth - target.right - padding}px`;
			} else if (this._hoverPosition === HoverPosition.LEFT) {
				this._hover.containerDomNode.style.maxWidth = `${target.left - padding}px`;
			}
			return;
		}

		if (this._hoverPosition === HoverPosition.RIGHT) {
			const roomOnRight = this._targetDocumentElement.clientWidth - target.right;
			if (roomOnRight < this._hover.containerDomNode.clientWidth + hoverPointerOffset) {
				const roomOnLeft = target.left;
				if (roomOnLeft >= this._hover.containerDomNode.clientWidth + hoverPointerOffset) {
					this._hoverPosition = HoverPosition.LEFT;
				}
				else {
					this._hoverPosition = HoverPosition.BELOW;
				}
			}
		}
		else if (this._hoverPosition === HoverPosition.LEFT) {

			const roomOnLeft = target.left;
			if (roomOnLeft < this._hover.containerDomNode.clientWidth + hoverPointerOffset) {
				const roomOnRight = this._targetDocumentElement.clientWidth - target.right;
				if (roomOnRight >= this._hover.containerDomNode.clientWidth + hoverPointerOffset) {
					this._hoverPosition = HoverPosition.RIGHT;
				}
				else {
					this._hoverPosition = HoverPosition.BELOW;
				}
			}
			if (target.left - this._hover.containerDomNode.clientWidth - hoverPointerOffset <= this._targetDocumentElement.clientLeft) {
				this._hoverPosition = HoverPosition.RIGHT;
			}
		}
	}

	private adjustVerticalHoverPosition(target: TargetRect): void {
		if (this._target.y !== undefined || this._forcePosition) {
			return;
		}

		const hoverPointerOffset = (this._hoverPointer ? Constants.PointerSize : 0);

		if (this._hoverPosition === HoverPosition.ABOVE) {
			if (target.top - this._hover.containerDomNode.clientHeight - hoverPointerOffset < 0) {
				this._hoverPosition = HoverPosition.BELOW;
			}
		}

		else if (this._hoverPosition === HoverPosition.BELOW) {
			if (target.bottom + this._hover.containerDomNode.offsetHeight + hoverPointerOffset > this._targetWindow.innerHeight) {
				this._hoverPosition = HoverPosition.ABOVE;
			}
		}
	}

	private adjustHoverMaxHeight(target: TargetRect): void {
		let maxHeight = this._targetWindow.innerHeight * this._maxHeightRatioRelativeToWindow;

		if (this._forcePosition) {
			const padding = (this._hoverPointer ? Constants.PointerSize : 0) + Constants.HoverBorderWidth;
			if (this._hoverPosition === HoverPosition.ABOVE) {
				maxHeight = Math.min(maxHeight, target.top - padding);
			} else if (this._hoverPosition === HoverPosition.BELOW) {
				maxHeight = Math.min(maxHeight, this._targetWindow.innerHeight - target.bottom - padding);
			}
		}

		this._hover.containerDomNode.style.maxHeight = `${maxHeight}px`;
		if (this._hover.contentsDomNode.clientHeight < this._hover.contentsDomNode.scrollHeight) {
			const extraRightPadding = `${this._hover.scrollbar.options.verticalScrollbarSize}px`;
			if (this._hover.contentsDomNode.style.paddingRight !== extraRightPadding) {
				this._hover.contentsDomNode.style.paddingRight = extraRightPadding;
			}
		}
	}

	private setHoverPointerPosition(target: TargetRect): void {
		if (!this._hoverPointer) {
			return;
		}

		switch (this._hoverPosition) {
			case HoverPosition.LEFT:
			case HoverPosition.RIGHT: {
				this._hoverPointer.classList.add(this._hoverPosition === HoverPosition.LEFT ? 'right' : 'left');
				const hoverHeight = this._hover.containerDomNode.clientHeight;

				if (hoverHeight > target.height) {
					this._hoverPointer.style.top = `${target.center.y - (this._y - hoverHeight) - Constants.PointerSize}px`;
				}

				else {
					this._hoverPointer.style.top = `${Math.round((hoverHeight / 2)) - Constants.PointerSize}px`;
				}

				break;
			}
			case HoverPosition.ABOVE:
			case HoverPosition.BELOW: {
				this._hoverPointer.classList.add(this._hoverPosition === HoverPosition.ABOVE ? 'bottom' : 'top');
				const hoverWidth = this._hover.containerDomNode.clientWidth;

				let pointerLeftPosition = Math.round((hoverWidth / 2)) - Constants.PointerSize;

				const pointerX = this._x + pointerLeftPosition;
				if (pointerX < target.left || pointerX > target.right) {
					pointerLeftPosition = target.center.x - this._x - Constants.PointerSize;
				}

				this._hoverPointer.style.left = `${pointerLeftPosition}px`;
				break;
			}
		}
	}

	public focus() {
		this._hover.containerDomNode.focus();
	}

	public hide(): void {
		this.dispose();
	}

	public override dispose(): void {
		if (!this._isDisposed) {
			this._onDispose.fire();
			this._target.dispose?.();
			this._hoverContainer.remove();
			this._messageListeners.dispose();
			super.dispose();
		}
		this._isDisposed = true;
	}
}

class CompositeMouseTracker extends Widget {
	private _isMouseIn: boolean = true;
	private _suppressNextMouseOut: boolean = false;
	private readonly _mouseTimer: MutableDisposable<TimeoutTimer> = this._register(new MutableDisposable());

	private readonly _onMouseOut = this._register(new Emitter<void>());
	get onMouseOut(): Event<void> { return this._onMouseOut.event; }

	get isMouseIn(): boolean { return this._isMouseIn; }

	constructor(
		private _elements: HTMLElement[],
		private _eventDebounceDelay: number = 200
	) {
		super();

		for (const element of this._elements) {
			this.onmouseover(element, () => this._onTargetMouseOver());
			this.onmouseleave(element, () => this._onTargetMouseLeave());
		}
	}

	private _onTargetMouseOver(): void {
		this._isMouseIn = true;
		this._suppressNextMouseOut = false;
		this._mouseTimer.clear();
	}

	private _onTargetMouseLeave(): void {
		this._isMouseIn = false;
		this._mouseTimer.value = new TimeoutTimer(() => this._fireIfMouseOutside(), this._eventDebounceDelay);
	}

	private _fireIfMouseOutside(): void {
		if (!this._isMouseIn && !this._suppressNextMouseOut) {
			this._onMouseOut.fire();
		}
	}

	suppressPendingMouseOut(): void {
		if (!this._isMouseIn) {
			this._suppressNextMouseOut = true;
		}
	}

	addElement(element: HTMLElement): IDisposable {
		if (this._elements.includes(element)) {
			return Disposable.None;
		}
		this._elements.push(element);
		const store = new DisposableStore();
		store.add(dom.addDisposableListener(element, dom.EventType.MOUSE_OVER, () => this._onTargetMouseOver()));
		store.add(dom.addDisposableListener(element, dom.EventType.MOUSE_LEAVE, () => this._onTargetMouseLeave()));
		store.add(toDisposable(() => {
			const index = this._elements.indexOf(element);
			if (index >= 0) {
				this._elements.splice(index, 1);
			}
		}));
		return store;
	}
}

class ElementHoverTarget implements IHoverTarget {
	readonly targetElements: readonly HTMLElement[];

	constructor(
		private _element: HTMLElement
	) {
		this.targetElements = [this._element];
	}

	dispose(): void {
	}
}
