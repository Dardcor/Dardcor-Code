/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ScrollEvent } from '../../../../base/common/scrollable.js';
import { BrandedService, IConstructorSignature } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IEditorMouseEvent } from '../../../browser/editorBrowser.js';
import { Position } from '../../../common/core/position.js';
import { Range } from '../../../common/core/range.js';
import { IModelDecoration } from '../../../common/model.js';
import { HoverStartSource } from './hoverOperation.js';

export interface IHoverPart {
	readonly owner: IEditorHoverParticipant;
	readonly range: Range;
	readonly forceShowAtRange?: boolean;

	readonly isBeforeContent?: boolean;
	isValidForHoverAnchor(anchor: HoverAnchor): boolean;
}

export const enum HoverAnchorType {
	Range = 1,
	ForeignElement = 2
}

export class HoverRangeAnchor {
	public readonly type = HoverAnchorType.Range;
	constructor(
		public readonly priority: number,
		public readonly range: Range,
		public readonly initialMousePosX: number | undefined,
		public readonly initialMousePosY: number | undefined,
	) {
	}
	public equals(other: HoverAnchor) {
		return (other.type === HoverAnchorType.Range && this.range.equalsRange(other.range));
	}
	public canAdoptVisibleHover(lastAnchor: HoverAnchor, showAtPosition: Position): boolean {
		return (lastAnchor.type === HoverAnchorType.Range && showAtPosition.lineNumber === this.range.startLineNumber);
	}
}

export class HoverForeignElementAnchor {
	public readonly type = HoverAnchorType.ForeignElement;
	constructor(
		public readonly priority: number,
		public readonly owner: IEditorHoverParticipant,
		public readonly range: Range,
		public readonly initialMousePosX: number | undefined,
		public readonly initialMousePosY: number | undefined,
		public readonly supportsMarkerHover: boolean | undefined
	) {
	}
	public equals(other: HoverAnchor) {
		return (other.type === HoverAnchorType.ForeignElement && this.owner === other.owner);
	}
	public canAdoptVisibleHover(lastAnchor: HoverAnchor, showAtPosition: Position): boolean {
		return (lastAnchor.type === HoverAnchorType.ForeignElement && this.owner === lastAnchor.owner);
	}
}

export type HoverAnchor = HoverRangeAnchor | HoverForeignElementAnchor;

export interface IEditorHoverStatusBar {
	addAction(actionOptions: { label: string; iconClass?: string; run: (target: HTMLElement) => void; commandId: string }): IEditorHoverAction;
	append(element: HTMLElement): HTMLElement;
}

export interface IEditorHoverAction {
	setEnabled(enabled: boolean): void;
}

export interface IEditorHoverColorPickerWidget {
	layout(): void;
}

export interface IEditorHoverContext {
	onContentsChanged(): void;
	setMinimumDimensions(dimensions: Dimension): void;
	hide(): void;
	focus(): void;
}

export interface IEditorHoverRenderContext extends IEditorHoverContext {
	readonly fragment: DocumentFragment;
	readonly statusBar: IEditorHoverStatusBar;
}

export interface IRenderedHoverPart<T extends IHoverPart> extends IDisposable {
	hoverPart: T;
	hoverElement: HTMLElement;
}

export interface IRenderedHoverParts<T extends IHoverPart> extends IDisposable {
	renderedHoverParts: IRenderedHoverPart<T>[];
}

export class RenderedHoverParts<T extends IHoverPart> implements IRenderedHoverParts<T> {

	constructor(public readonly renderedHoverParts: IRenderedHoverPart<T>[], private readonly disposables?: IDisposable) { }

	dispose() {
		for (const part of this.renderedHoverParts) {
			part.dispose();
		}
		this.disposables?.dispose();
	}
}

export interface IEditorHoverParticipant<T extends IHoverPart = IHoverPart> {
	readonly hoverOrdinal: number;
	readonly hideCopyButton?: boolean;
	suggestHoverAnchor?(mouseEvent: IEditorMouseEvent): HoverAnchor | null;
	computeSync(anchor: HoverAnchor, lineDecorations: IModelDecoration[], source: HoverStartSource): T[];
	computeAsync?(anchor: HoverAnchor, lineDecorations: IModelDecoration[], source: HoverStartSource, token: CancellationToken): AsyncIterable<T>;
	createLoadingMessage?(anchor: HoverAnchor): T | null;
	renderHoverParts(context: IEditorHoverRenderContext, hoverParts: T[]): IRenderedHoverParts<T>;
	getAccessibleContent(hoverPart: T): string;
	handleResize?(): void;
	handleHide?(): void;
	handleContentsChanged?(): void;
	handleScroll?(e: ScrollEvent): void;
}

export type IEditorHoverParticipantCtor = IConstructorSignature<IEditorHoverParticipant, [ICodeEditor]>;

export const HoverParticipantRegistry = (new class HoverParticipantRegistry {

	_participants: IEditorHoverParticipantCtor[] = [];

	public register<Services extends BrandedService[]>(ctor: { new(editor: ICodeEditor, ...services: Services): IEditorHoverParticipant }): void {
		this._participants.push(ctor as IEditorHoverParticipantCtor);
	}

	public getAll(): IEditorHoverParticipantCtor[] {
		return this._participants;
	}

}());

export interface IHoverWidget {
	showsOrWillShow(mouseEvent: IEditorMouseEvent): boolean;

	hide(): void;
}
