/**
 * Dardcor Code - Layout Change & View Render Event System (Task 249)
 * Mirrors: vs/editor/browser/view/viewEvents.ts
 */

export const enum ViewEventType {
	LayoutChanged = 0,
	ScrollChanged = 1,
	ViewLinesChanged = 2,
	CursorMoved = 3,
	SelectionChanged = 4,
	FocusChanged = 5,
	DecorationsChanged = 6,
	ThemeChanged = 7,
	ConfigurationChanged = 8,
}

export interface IViewEvent {
	readonly type: ViewEventType;
}

export interface ILayoutChangedEvent extends IViewEvent {
	readonly type: ViewEventType.LayoutChanged;
	readonly width: number;
	readonly height: number;
	readonly scrollTop: number;
	readonly scrollLeft: number;
}

export interface IScrollChangedEvent extends IViewEvent {
	readonly type: ViewEventType.ScrollChanged;
	readonly scrollTop: number;
	readonly scrollLeft: number;
	readonly scrollWidth: number;
	readonly scrollHeight: number;
}

export interface IViewLinesChangedEvent extends IViewEvent {
	readonly type: ViewEventType.ViewLinesChanged;
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	readonly newLineCount: number;
}

export interface ICursorMovedEvent extends IViewEvent {
	readonly type: ViewEventType.CursorMoved;
	readonly lineNumber: number;
	readonly column: number;
}

export interface ISelectionChangedEvent extends IViewEvent {
	readonly type: ViewEventType.SelectionChanged;
	readonly selections: readonly IViewSelection[];
}

export interface IViewSelection {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
	readonly isEmpty: boolean;
}

export interface IFocusChangedEvent extends IViewEvent {
	readonly type: ViewEventType.FocusChanged;
	readonly focused: boolean;
}

export interface IDecorationsChangedEvent extends IViewEvent {
	readonly type: ViewEventType.DecorationsChanged;
	readonly lines: readonly number[];
}

export interface IThemeChangedEvent extends IViewEvent {
	readonly type: ViewEventType.ThemeChanged;
	readonly themeId: string;
}

export interface IConfigurationChangedEvent extends IViewEvent {
	readonly type: ViewEventType.ConfigurationChanged;
	readonly changedKeys: readonly string[];
}

export type AnyViewEvent =
	| ILayoutChangedEvent
	| IScrollChangedEvent
	| IViewLinesChangedEvent
	| ICursorMovedEvent
	| ISelectionChangedEvent
	| IFocusChangedEvent
	| IDecorationsChangedEvent
	| IThemeChangedEvent
	| IConfigurationChangedEvent;

import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

export class ViewEventsEmitter extends Disposable {
	private readonly _onDidViewEvent = this._register(new Emitter<AnyViewEvent>());
	readonly onDidViewEvent: Event<AnyViewEvent> = this._onDidViewEvent.event;

	public emitLayoutChanged(width: number, height: number, scrollTop: number, scrollLeft: number): void {
		this._onDidViewEvent.fire({ type: ViewEventType.LayoutChanged, width, height, scrollTop, scrollLeft });
	}

	public emitScrollChanged(scrollTop: number, scrollLeft: number, scrollWidth: number, scrollHeight: number): void {
		this._onDidViewEvent.fire({ type: ViewEventType.ScrollChanged, scrollTop, scrollLeft, scrollWidth, scrollHeight });
	}

	public emitViewLinesChanged(startLineNumber: number, endLineNumber: number, newLineCount: number): void {
		this._onDidViewEvent.fire({ type: ViewEventType.ViewLinesChanged, startLineNumber, endLineNumber, newLineCount });
	}

	public emitCursorMoved(lineNumber: number, column: number): void {
		this._onDidViewEvent.fire({ type: ViewEventType.CursorMoved, lineNumber, column });
	}

	public emitSelectionChanged(selections: readonly IViewSelection[]): void {
		this._onDidViewEvent.fire({ type: ViewEventType.SelectionChanged, selections });
	}

	public emitFocusChanged(focused: boolean): void {
		this._onDidViewEvent.fire({ type: ViewEventType.FocusChanged, focused });
	}

	public emitDecorationsChanged(lines: readonly number[]): void {
		this._onDidViewEvent.fire({ type: ViewEventType.DecorationsChanged, lines });
	}

	public emitThemeChanged(themeId: string): void {
		this._onDidViewEvent.fire({ type: ViewEventType.ThemeChanged, themeId });
	}

	public emitConfigurationChanged(changedKeys: readonly string[]): void {
		this._onDidViewEvent.fire({ type: ViewEventType.ConfigurationChanged, changedKeys });
	}
}
