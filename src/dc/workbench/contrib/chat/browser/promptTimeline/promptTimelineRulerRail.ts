/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType, getWindow, scheduleAtNextAnimationFrame } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { disposableTimeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { PromptTimelineCard } from './promptTimelineCard.js';
import { MIN_HOST_WIDTH, spaceMarkCenters } from './promptTimelineLayout.js';
import { IPromptScrollLayout, PromptFileDiff, PromptTick } from './promptTimelineModel.js';
import { IPromptReviewFileEvent, IPromptTimelineRail } from './promptTimelineRail.js';
import './media/promptTimeline.css';

const MIN_TARGET = 24;
const RELAYOUT_MIN_DELTA = 0.5;
const FAN_SIGMA = 40;
const FAN_SPREAD = 14;
const FAN_LINGER = 2000;
const HARD_WHEEL_REVEAL_WINDOW = 200;
const PILL_LAYOUT: 'proportional' | 'even' = 'even';
const EVEN_PILL_SPACING = 26;

interface IMarkEntry {
	tick: PromptTick;
	readonly button: HTMLButtonElement;
	readonly bar: HTMLElement;
	lastTop?: number;
	baseCenter?: number;
}

export class PromptTimelineRulerRail extends Disposable implements IPromptTimelineRail {

	private readonly _domNode: HTMLElement;
	private readonly _marksContainer: HTMLElement;
	private readonly _card: PromptTimelineCard;
	private readonly _markDisposables = this._register(new DisposableStore());
	private readonly _marks: IMarkEntry[] = [];
	private readonly _glideEnabler = this._register(new MutableDisposable());

	private _activeRequestId: string | undefined;
	private _layout: IPromptScrollLayout | undefined;
	private _resizeObserverReady = false;
	private _hostWidth = Number.POSITIVE_INFINITY;
	private _railHeight = 0;
	private readonly _relayoutScheduled = this._register(new MutableDisposable());
	private _fanCenter: number | undefined;
	private _laneTop = 0;
	private _domTop: number | undefined;
	private _hovering = false;
	private _hardWheelAt = 0;
	private _lastScrollTop: number | undefined;
	private readonly _fanHide = this._register(new MutableDisposable());
	private _lastFanActivityAt = 0;
	private _reducedMotion = false;
	private _focused = false;

	private readonly _onDidSelect = this._register(new Emitter<string>());
	readonly onDidSelect: Event<string> = this._onDidSelect.event;

	private readonly _onDidReview = this._register(new Emitter<PromptTick>());
	readonly onDidReview: Event<PromptTick> = this._onDidReview.event;

	private readonly _onDidReviewFile = this._register(new Emitter<IPromptReviewFileEvent>());
	readonly onDidReviewFile: Event<IPromptReviewFileEvent> = this._onDidReviewFile.event;

	get domNode(): HTMLElement { return this._domNode; }

	constructor() {
		super();
		this._domNode = $('nav.prompt-timeline-rail.prompt-timeline-rail-ruler');
		this._domNode.setAttribute('aria-label', localize('promptTimeline.railLabel', "Prompt timeline"));
		this._domNode.setAttribute('role', 'toolbar');
		this._domNode.setAttribute('aria-orientation', 'vertical');
		this._marksContainer = append(this._domNode, $('.prompt-timeline-ruler-marks'));
		this._card = this._register(new PromptTimelineCard(this._domNode));
		this._register(this._card.onDidReview(tick => this._onDidReview.fire(tick)));
		this._register(this._card.onDidReviewFile(e => this._onDidReviewFile.fire(e)));

		this._register(addDisposableListener(this._marksContainer, EventType.KEY_DOWN, e => this._onMarksKeyDown(e)));

		this._register(addDisposableListener(this._marksContainer, EventType.MOUSE_ENTER, e => {
			this._laneTop = this._laneTopNow();
			this._hovering = true;
			this._fanHide.clear();
			this._engage(e.clientY - this._laneTop);
		}));
		this._register(addDisposableListener(this._marksContainer, EventType.MOUSE_MOVE, e => {
			this._hovering = true;
			this._engage(e.clientY - this._laneTop);
		}));
		this._register(addDisposableListener(this._marksContainer, EventType.MOUSE_LEAVE, () => {
			this._hovering = false;
			this._scheduleFanHide();
		}));

		const win = getWindow(this._domNode);
		const reducedMotionQuery = win.matchMedia?.('(prefers-reduced-motion: reduce)');
		if (reducedMotionQuery) {
			this._reducedMotion = reducedMotionQuery.matches;
			this._register(addDisposableListener(reducedMotionQuery, 'change', () => {
				this._reducedMotion = reducedMotionQuery.matches;
				this._applyFan();
			}));
		}

		this._register(addDisposableListener(this._domNode, EventType.FOCUS_IN, () => {
			this._focused = true;
			this._collapseFan();
		}));
		this._register(addDisposableListener(this._domNode, EventType.FOCUS_OUT, () => {
			if (!this._domNode.contains(getWindow(this._domNode).document.activeElement)) {
				this._focused = false;
				this._card.scheduleHide();
			}
		}));
	}

	setFilesProvider(provider: (tick: PromptTick) => readonly PromptFileDiff[]): void {
		this._card.setFilesProvider(provider);
	}

	setTicks(ticks: readonly PromptTick[]): void {
		const sameStructure = ticks.length === this._marks.length
			&& ticks.every((t, i) => this._marks[i]?.tick.requestId === t.requestId);
		if (sameStructure) {
			for (let i = 0; i < ticks.length; i++) {
				this._renderMark(this._marks[i], ticks[i]);
			}
			this._updateActiveClasses();
			this._relayout();
			return;
		}

		this._markDisposables.clear();
		this._marks.length = 0;
		clearNode(this._marksContainer);
		this._card.hide();
		this._marksContainer.classList.remove('glide');
		this._glideEnabler.clear();

		for (const tick of ticks) {
			const button = append(this._marksContainer, $<HTMLButtonElement>('button.prompt-timeline-ruler-mark'));
			button.tabIndex = -1;
			const bar = append(button, $('span.prompt-timeline-ruler-bar'));
			const entry: IMarkEntry = { tick, button, bar };
			this._renderMark(entry, tick);
			const requestId = tick.requestId;
			this._markDisposables.add(addDisposableListener(button, EventType.CLICK, () => this._onDidSelect.fire(requestId)));
			this._markDisposables.add(addDisposableListener(button, EventType.MOUSE_ENTER, () => this._showCard(entry)));
			this._markDisposables.add(addDisposableListener(button, EventType.FOCUS, () => { this._showCard(entry); this._updateTabStops(this._marks.indexOf(entry)); }));
			this._markDisposables.add(addDisposableListener(button, EventType.MOUSE_LEAVE, () => this._card.scheduleHide()));
			this._marks.push(entry);
		}

		this._ensureResizeObserver();
		const activeIndex = this._marks.findIndex(m => m.tick.requestId === this._activeRequestId);
		this._updateTabStops(activeIndex >= 0 ? activeIndex : 0);
		this._updateActiveClasses();
		this._relayout();
		this._glideEnabler.value = scheduleAtNextAnimationFrame(getWindow(this._domNode), () => this._marksContainer.classList.add('glide'));
	}

	private _updateTabStops(focusIndex: number): void {
		for (let i = 0; i < this._marks.length; i++) {
			this._marks[i].button.tabIndex = i === focusIndex ? 0 : -1;
		}
	}

	private _onMarksKeyDown(e: KeyboardEvent): void {
		if (this._marks.length === 0) {
			return;
		}
		const event = new StandardKeyboardEvent(e);
		const currentIndex = this._marks.findIndex(m => m.button === getWindow(this._domNode).document.activeElement);
		let nextIndex: number;
		switch (event.keyCode) {
			case KeyCode.DownArrow: nextIndex = Math.min(this._marks.length - 1, currentIndex + 1); break;
			case KeyCode.UpArrow: nextIndex = Math.max(0, currentIndex - 1); break;
			case KeyCode.Home: nextIndex = 0; break;
			case KeyCode.End: nextIndex = this._marks.length - 1; break;
			default: return;
		}
		event.preventDefault();
		event.stopPropagation();
		this._updateTabStops(nextIndex);
		this._marks[nextIndex]?.button.focus();
	}

	private _renderMark(entry: IMarkEntry, tick: PromptTick): void {
		entry.tick = tick;
		entry.button.setAttribute('aria-label', tick.ariaLabel);
		clearNode(entry.bar);
		const stat = tick.stat;
		const edited = !!stat && stat.added + stat.removed > 0;
		entry.bar.classList.toggle('edited', edited);
		if (edited) {
			if (stat!.added > 0) {
				append(entry.bar, $('span.seg-add')).style.flexGrow = String(stat!.added);
			}
			if (stat!.removed > 0) {
				append(entry.bar, $('span.seg-del')).style.flexGrow = String(stat!.removed);
			}
		}
	}

	notifyHardWheel(): void {
		this._hardWheelAt = Date.now();
	}

	private _activeCenter(): number | undefined {
		const active = this._marks.find(m => m.tick.requestId === this._activeRequestId && m.baseCenter !== undefined);
		if (active?.baseCenter !== undefined) {
			return active.baseCenter;
		}
		const laidOut = this._marks.filter(m => m.baseCenter !== undefined);
		return laidOut.at(-1)?.baseCenter;
	}

	private _scrollFanCenter(): number | undefined {
		const layout = this._layout;
		if (!layout) {
			return undefined;
		}
		const topById = new Map(layout.marks.map(m => [m.requestId, m.top]));
		const pts: { contentTop: number; center: number }[] = [];
		for (const entry of this._marks) {
			const contentTop = topById.get(entry.tick.requestId);
			if (contentTop !== undefined && entry.baseCenter !== undefined) {
				pts.push({ contentTop, center: entry.baseCenter });
			}
		}
		if (pts.length === 0) {
			return undefined;
		}
		pts.sort((a, b) => a.contentTop - b.contentTop);
		const scrollTop = layout.scrollHeight > 0
			? (layout.scrollTop / layout.scrollHeight) * layout.total
			: layout.scrollTop;
		if (scrollTop <= pts[0].contentTop) {
			return pts[0].center;
		}
		const last = pts[pts.length - 1];
		if (scrollTop >= last.contentTop) {
			return last.center;
		}
		for (let i = 0; i < pts.length - 1; i++) {
			const a = pts[i];
			const b = pts[i + 1];
			if (scrollTop >= a.contentTop && scrollTop <= b.contentTop) {
				const span = b.contentTop - a.contentTop;
				const frac = span > 0 ? (scrollTop - a.contentTop) / span : 0;
				return a.center + frac * (b.center - a.center);
			}
		}
		return last.center;
	}

	setActive(requestId: string | undefined): void {
		this._activeRequestId = requestId;
		this._updateActiveClasses();
	}

	focusTick(requestId: string): void {
		this._marks.find(m => m.tick.requestId === requestId || m.tick.allRequestIds.includes(requestId))?.button.focus();
	}

	setHostWidth(width: number): void {
		if (width > 0 && width !== this._hostWidth) {
			this._hostWidth = width;
			this._relayout();
		}
	}

	setScrollLayout(layout: IPromptScrollLayout | undefined): void {
		const prevScrollTop = this._lastScrollTop;
		this._layout = layout;
		if (layout) {
			this._lastScrollTop = layout.scrollTop;
			if (prevScrollTop !== undefined && Math.abs(layout.scrollTop - prevScrollTop) > 0.5) {
				this._onScrolled();
			}
		}
		this._scheduleRelayout();
	}

	private _onScrolled(): void {
		if (this._hovering || this._focused) {
			return;
		}
		if (this._domNode.classList.contains('engaged')) {
			this._scheduleFanHide();
			return;
		}
		if (Date.now() - this._hardWheelAt <= HARD_WHEEL_REVEAL_WINDOW) {
			const center = this._scrollFanCenter() ?? this._activeCenter();
			if (center !== undefined) {
				this._engage(center);
				this._scheduleFanHide();
			}
		}
	}

	private _scheduleRelayout(): void {
		if (this._relayoutScheduled.value) {
			return;
		}
		this._relayoutScheduled.value = scheduleAtNextAnimationFrame(getWindow(this._domNode), () => {
			this._relayoutScheduled.clear();
			this._relayout();
		});
	}

	private _relayout(): void {
		const height = this._railHeight > 0 ? this._railHeight : (this._railHeight = this._domNode.clientHeight);
		const layout = this._layout;
		const overflowing = this._hostWidth < MIN_HOST_WIDTH;
		this._domNode.classList.toggle('overflowing', overflowing);
		if (overflowing || height <= 0 || !layout || layout.total <= 0) {
			return;
		}
		const scale = height / layout.total;
		const topById = new Map(layout.marks.map(m => [m.requestId, m.top]));

		const visible: { entry: IMarkEntry; center: number }[] = [];
		for (const entry of this._marks) {
			const top = topById.get(entry.tick.requestId);
			if (top === undefined) {
				entry.button.classList.add('hidden');
				entry.lastTop = undefined;
				entry.baseCenter = undefined;
				entry.button.style.transform = '';
				entry.bar.style.transform = '';
				continue;
			}
			entry.button.classList.remove('hidden');
			visible.push({ entry, center: top * scale });
		}

		if (PILL_LAYOUT === 'even') {
			this._spaceEvenCenters(visible, height);
		} else {
			spaceMarkCenters(visible, height, MIN_TARGET);
		}

		for (const { entry, center } of visible) {
			entry.baseCenter = center;
			const y = center - MIN_TARGET / 2;
			if (entry.lastTop !== undefined && Math.abs(y - entry.lastTop) < RELAYOUT_MIN_DELTA) {
				continue;
			}
			entry.lastTop = y;
			entry.button.style.top = `${y}px`;
		}

		if (this._domNode.classList.contains('engaged') && !this._hovering && !this._focused) {
			const scrollCenter = this._scrollFanCenter();
			if (scrollCenter !== undefined) {
				this._fanCenter = scrollCenter;
			}
		}

		this._applyFan();
	}

	private _spaceEvenCenters(visible: { entry: IMarkEntry; center: number }[], height: number): void {
		const n = visible.length;
		if (n === 0) {
			return;
		}
		const groupHeight = n * EVEN_PILL_SPACING;
		let start: number;
		let step: number;
		if (groupHeight <= height) {
			step = EVEN_PILL_SPACING;
			start = (height - groupHeight) / 2 + step / 2;
		} else {
			step = (height - EVEN_PILL_SPACING) / (n - 1);
			start = EVEN_PILL_SPACING / 2;
		}
		for (let i = 0; i < n; i++) {
			visible[i].center = start + i * step;
		}
	}

	private _applyFan(): void {
		const center = this._fanCenter;
		const fanning = center !== undefined && !this._reducedMotion;
		for (const entry of this._marks) {
			if (entry.baseCenter === undefined) {
				continue;
			}
			if (!fanning) {
				entry.button.style.transform = '';
				entry.bar.style.transform = '';
				continue;
			}
			const d = entry.baseCenter - center!;
			const m = Math.exp(-(d * d) / (2 * FAN_SIGMA * FAN_SIGMA));
			entry.button.style.transform = `translateY(${FAN_SPREAD * Math.tanh(d / FAN_SIGMA)}px)`;
			entry.bar.style.transform = `scale(${1 + m * 0.9}, ${1 + m * 0.6})`;
		}
	}

	private _engage(center: number): void {
		this._domNode.classList.add('engaged');
		this._fanCenter = center;
		this._applyFan();
	}

	private _collapseFan(): void {
		if (!this._domNode.classList.contains('engaged')) {
			return;
		}
		this._domNode.classList.remove('engaged');
		this._fanCenter = undefined;
		this._applyFan();
	}

	private _scheduleFanHide(): void {
		this._lastFanActivityAt = Date.now();
		if (!this._fanHide.value) {
			this._armFanHide(FAN_LINGER);
		}
	}

	private _armFanHide(delay: number): void {
		this._fanHide.value = disposableTimeout(() => {
			this._fanHide.clear();
			if (this._hovering) {
				return;
			}
			const remaining = FAN_LINGER - (Date.now() - this._lastFanActivityAt);
			if (remaining > 0) {
				this._armFanHide(remaining);
			} else {
				this._collapseFan();
			}
		}, delay);
	}

	private _updateActiveClasses(): void {
		for (const entry of this._marks) {
			const isActive = entry.tick.requestId === this._activeRequestId;
			entry.button.classList.toggle('active', isActive);
			if (isActive) {
				entry.button.setAttribute('aria-current', 'location');
			} else {
				entry.button.removeAttribute('aria-current');
			}
		}
	}

	private _laneTopNow(): number {
		if (this._domTop === undefined) {
			this._domTop = this._domNode.getBoundingClientRect().top;
		}
		return this._domTop;
	}

	private _showCard(entry: IMarkEntry): void {
		const centerY = entry.baseCenter
			?? (entry.button.getBoundingClientRect().top - this._domNode.getBoundingClientRect().top + MIN_TARGET / 2);
		this._card.show(entry.tick, centerY);
	}

	private _ensureResizeObserver(): void {
		if (this._resizeObserverReady) {
			return;
		}
		const ResizeObserverCtor = getWindow(this._domNode).ResizeObserver;
		if (!ResizeObserverCtor) {
			return;
		}
		this._resizeObserverReady = true;
		const observer = new ResizeObserverCtor(() => {
			this._railHeight = this._domNode.clientHeight;
			this._domTop = this._domNode.getBoundingClientRect().top;
			this._relayout();
		});
		observer.observe(this._domNode);
		this._register(toDisposable(() => observer.disconnect()));
	}
}
