/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType, getWindow } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { Gesture, EventType as TouchEventType } from '../../../../../base/browser/touch.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { MIN_HOST_WIDTH } from './promptTimelineLayout.js';
import { PromptDiffStat, PromptFileDiff, PromptTick, IPromptScrollLayout } from './promptTimelineModel.js';
import { IPromptReviewFileEvent, IPromptTimelineRail } from './promptTimelineRail.js';
import './media/promptTimeline.css';

const MAX_REST_DOTS = 50;
const MIN_REST_DOTS = 2;
const DOT_SIZE = 4;
const DOT_GAP = 4;
const HANDLE_PADDING_Y = 8;
const MORE_MARKER_HEIGHT = 8;
const GUTTER_INSET = 12;

export function restDotCount(promptCount: number, railHeight: number): number {
	const capped = Math.min(promptCount, MAX_REST_DOTS);
	if (promptCount <= MIN_REST_DOTS || railHeight <= 0) {
		return capped;
	}
	const available = railHeight - 2 * (GUTTER_INSET + HANDLE_PADDING_Y);
	const step = DOT_SIZE + DOT_GAP;
	if (capped === promptCount && Math.floor((available + DOT_GAP) / step) >= promptCount) {
		return capped;
	}
	return Math.max(MIN_REST_DOTS, Math.min(capped, Math.floor((available - MORE_MARKER_HEIGHT) / step)));
}

type RowColumn = 'jump' | 'diff';

type PreviewSource = 'dot' | 'row';

interface IRowEntry {
	tick: PromptTick;
	readonly container: HTMLElement;
	readonly jump: HTMLButtonElement;
	readonly diff: HTMLButtonElement;
	readonly label: HTMLElement;
	readonly stat: HTMLElement;
}

let gutterIdSeq = 0;

export class PromptTimelineGutterRail extends Disposable implements IPromptTimelineRail {

	private readonly _domNode: HTMLElement;
	private readonly _rest: HTMLButtonElement;
	private readonly _list: HTMLElement;
	private readonly _rowDisposables = this._register(new DisposableStore());
	private readonly _dotDisposables = this._register(new DisposableStore());
	private readonly _rows: IRowEntry[] = [];
	private readonly _dots: HTMLElement[] = [];
	private readonly _dotTicks: number[] = [];
	private _activeRequestId: string | undefined;
	private _hostWidth = Number.POSITIVE_INFINITY;
	private _railHeight = 0;
	private _resizeObserverReady = false;
	private _tickCount = 0;
	private _open = false;
	private _hovering = false;
	private _previewIndex = -1;
	private _previewBand = -1;
	private _activeIndex = -1;
	private _focusRow = 0;
	private _focusColumn: RowColumn = 'jump';

	private readonly _onDidSelect = this._register(new Emitter<string>());
	readonly onDidSelect: Event<string> = this._onDidSelect.event;

	private readonly _onDidReview = this._register(new Emitter<PromptTick>());
	readonly onDidReview: Event<PromptTick> = this._onDidReview.event;
	private readonly _onDidReviewFile = this._register(new Emitter<IPromptReviewFileEvent>());
	readonly onDidReviewFile: Event<IPromptReviewFileEvent> = this._onDidReviewFile.event;

	get domNode(): HTMLElement { return this._domNode; }

	constructor() {
		super();
		this._domNode = $('nav.prompt-timeline-rail.prompt-timeline-rail-gutter');
		this._domNode.setAttribute('aria-label', localize('promptTimeline.gutter.railLabel', "Prompt timeline"));
		this._domNode.setAttribute('role', 'toolbar');
		this._domNode.setAttribute('aria-orientation', 'vertical');

		const panelId = `prompt-timeline-gutter-panel-${gutterIdSeq++}`;

		this._rest = append(this._domNode, $<HTMLButtonElement>('button.prompt-timeline-gutter-rest'));
		this._rest.setAttribute('aria-haspopup', 'true');
		this._rest.setAttribute('aria-expanded', 'false');
		this._rest.setAttribute('aria-controls', panelId);
		this._rest.setAttribute('aria-label', localize('promptTimeline.gutter.toggleLabel', "Show prompts"));
		this._rest.tabIndex = 0;

		this._list = append(this._domNode, $('.prompt-timeline-gutter-panel'));
		this._list.id = panelId;

		this._register(addDisposableListener(this._domNode, EventType.MOUSE_OVER, () => {
			this._hovering = true;
			this._updateRevealed();
		}));
		this._register(addDisposableListener(this._domNode, EventType.MOUSE_OUT, (e: MouseEvent) => {
			if (!this._domNode.contains(e.relatedTarget as Node | null)) {
				this._hovering = false;
				this._setPreview(-1);
				this._updateRevealed();
			}
		}));

		this._register(addDisposableListener(this._list, EventType.MOUSE_OVER, e => {
			const target = e.target as Node | null;
			const rowIndex = target === null ? -1 : this._rows.findIndex(row => row.container.contains(target));
			this._setPreview(rowIndex, 'row');
		}));

		this._register(Gesture.addTarget(this._rest));
		this._register(addDisposableListener(this._rest, EventType.CLICK, e => { e.preventDefault(); this._toggleOpen(); }));
		this._register(addDisposableListener(this._rest, TouchEventType.Tap, () => this._toggleOpen()));
		this._register(addDisposableListener(this._rest, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Enter || event.keyCode === KeyCode.Space) {
				event.preventDefault();
				event.stopPropagation();
				this._toggleOpen();
			}
		}));

		this._register(addDisposableListener(this._list, EventType.KEY_DOWN, e => this._onListKeyDown(e)));

		this._register(addDisposableListener(this._domNode, EventType.FOCUS_OUT, (e: FocusEvent) => {
			if (!this._domNode.contains(e.relatedTarget as Node | null)) {
				this._open = false;
				this._updateRevealed();
			}
		}));
	}

	private _updateRevealed(): void {
		const revealed = this._open || this._hovering;
		this._domNode.classList.toggle('revealed', revealed);
		this._rest.setAttribute('aria-expanded', String(revealed));
	}

	private _toggleOpen(): void {
		if (this._open) {
			this._close();
		} else {
			this._open = true;
			this._updateRevealed();
			this._focusActiveRow();
		}
	}

	private _close(restoreFocus = true): void {
		this._open = false;
		this._updateRevealed();
		if (restoreFocus) {
			this._rest.focus();
		}
	}

	private _focusActiveRow(): void {
		this._focusCell(this._focusRow, this._focusColumn);
	}

	setFilesProvider(_provider: (tick: PromptTick) => readonly PromptFileDiff[]): void {
	}

	private _renderDots(count: number): void {
		this._dotDisposables.clear();
		clearNode(this._rest);
		this._dots.length = 0;
		this._dotTicks.length = 0;
		const dots = restDotCount(count, this._railHeight);
		for (let i = 0; i < dots; i++) {
			const dot = append(this._rest, $('.prompt-timeline-gutter-dot'));
			const tickIndex = dots === count ? i : Math.round(i * (count - 1) / (dots - 1));
			this._dots.push(dot);
			this._dotTicks.push(tickIndex);
			this._dotDisposables.add(addDisposableListener(dot, EventType.MOUSE_OVER, () => this._setPreview(tickIndex)));
		}
		if (count > dots) {
			append(this._rest, $('.prompt-timeline-gutter-dot-more'));
		}
		this._updateDotHighlights();
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
			const height = this._domNode.clientHeight;
			if (height <= 0 || height === this._railHeight) {
				return;
			}
			this._railHeight = height;
			if (restDotCount(this._tickCount, height) !== this._dots.length) {
				this._renderDots(this._tickCount);
			}
		});
		observer.observe(this._domNode);
		this._register(toDisposable(() => observer.disconnect()));
	}

	private _setPreview(index: number, source: PreviewSource = 'dot'): void {
		const band = source === 'dot' ? index : -1;
		if (this._previewIndex === index && this._previewBand === band) {
			return;
		}
		this._previewIndex = index;
		this._previewBand = band;
		for (let i = 0; i < this._rows.length; i++) {
			this._rows[i].container.classList.toggle('preview', i === band);
		}
		this._updateDotHighlights();
		if (index >= 0) {
			this._revealRow(index);
		}
	}

	private _updateDotHighlights(): void {
		const activeDot = this._findNearestDotIndex(this._activeIndex);
		const previewDot = this._findNearestDotIndex(this._previewIndex);
		for (let i = 0; i < this._dots.length; i++) {
			this._dots[i].classList.toggle('active', i === activeDot);
			this._dots[i].classList.toggle('preview', i === previewDot);
		}
	}

	private _findNearestDotIndex(tickIndex: number): number {
		if (tickIndex < 0) {
			return -1;
		}
		let nearestDot = -1;
		let bestDelta = Number.POSITIVE_INFINITY;
		for (let i = 0; i < this._dotTicks.length; i++) {
			const delta = Math.abs(this._dotTicks[i] - tickIndex);
			if (delta < bestDelta) {
				bestDelta = delta;
				nearestDot = i;
			}
		}
		return nearestDot;
	}

	private _revealRow(index: number): void {
		const container = this._rows[index]?.container;
		if (!container) {
			return;
		}
		const top = container.offsetTop;
		const bottom = top + container.offsetHeight;
		const viewTop = this._list.scrollTop;
		const viewBottom = viewTop + this._list.clientHeight;
		if (top < viewTop) {
			this._list.scrollTop = top;
		} else if (bottom > viewBottom) {
			this._list.scrollTop = bottom - this._list.clientHeight;
		}
	}

	setTicks(ticks: readonly PromptTick[]): void {
		this._tickCount = ticks.length;
		this._ensureResizeObserver();
		if (this._railHeight <= 0) {
			this._railHeight = this._domNode.clientHeight;
		}
		const sameStructure = ticks.length === this._rows.length
			&& ticks.every((t, i) => this._rows[i]?.tick.requestId === t.requestId);
		if (sameStructure) {
			const doc = getWindow(this._domNode).document;
			const focusedCell = this._isLiveCell(doc.activeElement) ? doc.activeElement : undefined;
			for (let i = 0; i < ticks.length; i++) {
				this._renderRow(this._rows[i], ticks[i]);
			}
			this._updateTabStops(this._focusRow, this._focusColumn);
			if (focusedCell && !this._isLiveCell(focusedCell)) {
				this._cell(this._focusRow, this._focusColumn)?.focus();
			}
			this._updateActiveClasses();
			return;
		}

		this._rowDisposables.clear();
		this._rows.length = 0;
		this._previewIndex = -1;
		this._previewBand = -1;
		clearNode(this._list);
		this._renderDots(ticks.length);

		for (const tick of ticks) {
			const container = append(this._list, $('.prompt-timeline-gutter-row'));
			const jump = append(container, $<HTMLButtonElement>('button.prompt-timeline-gutter-row-jump'));
			jump.tabIndex = -1;
			const label = append(jump, $('span.prompt-timeline-gutter-row-label'));
			const diff = append(container, $<HTMLButtonElement>('button.prompt-timeline-gutter-row-diff'));
			diff.tabIndex = -1;
			const stat = append(diff, $('span.prompt-timeline-gutter-row-stat'));
			const entry: IRowEntry = { tick, container, jump, diff, label, stat };
			this._renderRow(entry, tick);
			const requestId = tick.requestId;
			this._rowDisposables.add(addDisposableListener(jump, EventType.CLICK, () => {
				this._onDidSelect.fire(requestId);
				this._close();
			}));
			this._rowDisposables.add(addDisposableListener(diff, EventType.CLICK, () => {
				this._onDidReview.fire(entry.tick);
				this._close( false);
			}));
			for (const [button, column] of [[jump, 'jump'], [diff, 'diff']] as const) {
				this._rowDisposables.add(addDisposableListener(button, EventType.FOCUS, () => {
					this._open = true;
					this._updateRevealed();
					this._updateTabStops(this._rows.indexOf(entry), column);
				}));
			}
			this._rows.push(entry);
		}

		const activeIndex = this._rows.findIndex(r => r.tick.requestId === this._activeRequestId);
		this._updateTabStops(activeIndex >= 0 ? activeIndex : 0, 'jump');
		this._updateActiveClasses();
	}

	private _renderRow(entry: IRowEntry, tick: PromptTick): void {
		entry.tick = tick;
		entry.jump.setAttribute('aria-label', tick.ariaLabel);
		entry.label.textContent = tick.text;
		entry.label.title = tick.text;
		const stat = tick.stat && tick.stat.added + tick.stat.removed > 0 ? tick.stat : undefined;
		this._renderStat(entry.stat, stat);
		entry.container.classList.toggle('reviewable', !!stat);
		if (stat) {
			entry.diff.setAttribute('aria-label', localize(
				'promptTimeline.gutter.reviewChanges',
				"Review Changes for Prompt: {0}, {1}",
				tick.text,
				stat.fileCount === 1
					? localize('promptTimeline.gutter.reviewOneFile', "1 file changed")
					: localize('promptTimeline.gutter.reviewNFiles', "{0} files changed", stat.fileCount),
			));
		}
	}

	private _renderStat(container: HTMLElement, stat: PromptDiffStat | undefined): void {
		clearNode(container);
		if (!stat) {
			return;
		}
		append(container, $('span.added')).textContent = `+${stat.added}`;
		append(container, $('span.removed')).textContent = `\u2212${stat.removed}`;
	}

	private _cell(rowIndex: number, column: RowColumn): HTMLButtonElement | undefined {
		const entry = this._rows[rowIndex];
		if (!entry) {
			return undefined;
		}
		if (column === 'jump') {
			return entry.jump;
		}
		return entry.container.classList.contains('reviewable') ? entry.diff : undefined;
	}

	private _isLiveCell(element: Element | null): boolean {
		return this._rows.some(row => row.jump === element
			|| (row.diff === element && row.container.classList.contains('reviewable')));
	}

	private _updateTabStops(focusIndex: number, column: RowColumn = this._focusColumn): void {
		this._focusRow = Math.max(0, Math.min(this._rows.length - 1, focusIndex));
		this._focusColumn = this._cell(this._focusRow, column) ? column : 'jump';
		const focused = this._cell(this._focusRow, this._focusColumn);
		for (const entry of this._rows) {
			entry.jump.tabIndex = entry.jump === focused ? 0 : -1;
			entry.diff.tabIndex = entry.diff === focused ? 0 : -1;
		}
	}

	private _focusCell(rowIndex: number, column: RowColumn): void {
		this._updateTabStops(rowIndex, column);
		this._cell(this._focusRow, this._focusColumn)?.focus();
	}

	private _onListKeyDown(e: KeyboardEvent): void {
		if (this._rows.length === 0) {
			return;
		}
		const event = new StandardKeyboardEvent(e);
		if (event.keyCode === KeyCode.Escape) {
			event.preventDefault();
			event.stopPropagation();
			this._close();
			return;
		}
		const activeElement = getWindow(this._domNode).document.activeElement;
		const currentIndex = this._rows.findIndex(r => r.jump === activeElement || r.diff === activeElement);
		const currentColumn: RowColumn = this._rows[currentIndex]?.diff === activeElement ? 'diff' : 'jump';
		let nextIndex = currentIndex;
		let nextColumn = currentColumn;
		switch (event.keyCode) {
			case KeyCode.DownArrow: nextIndex = Math.min(this._rows.length - 1, currentIndex + 1); break;
			case KeyCode.UpArrow: nextIndex = Math.max(0, currentIndex - 1); break;
			case KeyCode.Home: nextIndex = 0; break;
			case KeyCode.End: nextIndex = this._rows.length - 1; break;
			case KeyCode.RightArrow: nextColumn = 'diff'; break;
			case KeyCode.LeftArrow: nextColumn = 'jump'; break;
			default: return;
		}
		event.preventDefault();
		event.stopPropagation();
		this._focusCell(nextIndex, nextColumn);
	}

	setActive(requestId: string | undefined): void {
		this._activeRequestId = requestId;
		this._updateActiveClasses();
	}

	private _updateActiveClasses(): void {
		let activeIndex = -1;
		for (let i = 0; i < this._rows.length; i++) {
			const row = this._rows[i];
			const active = this._activeRequestId !== undefined
				&& (row.tick.requestId === this._activeRequestId || row.tick.allRequestIds.includes(this._activeRequestId));
			if (active) {
				activeIndex = i;
			}
			row.container.classList.toggle('active', active);
			if (active) {
				row.jump.setAttribute('aria-current', 'location');
			} else {
				row.jump.removeAttribute('aria-current');
			}
		}
		this._activeIndex = activeIndex;
		this._updateDotHighlights();
	}

	focusTick(requestId: string): void {
		const index = this._rows.findIndex(r => r.tick.requestId === requestId || r.tick.allRequestIds.includes(requestId));
		if (index >= 0) {
			this._focusCell(index, 'jump');
		}
	}

	setHostWidth(width: number): void {
		if (width > 0 && width !== this._hostWidth) {
			this._hostWidth = width;
			this._domNode.classList.toggle('overflowing', width < MIN_HOST_WIDTH);
		}
	}

	notifyHardWheel(): void { }
	setScrollLayout(_layout: IPromptScrollLayout | undefined): void { }
}
