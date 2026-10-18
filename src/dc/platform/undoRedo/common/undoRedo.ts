/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IUndoRedoService = createDecorator<IUndoRedoService>('undoRedoService');

export const enum UndoRedoElementType {
	Resource,
	Workspace
}

export interface IResourceUndoRedoElement {
	readonly type: UndoRedoElementType.Resource;
	readonly resource: URI;
	readonly label: string;
	readonly code: string;
	readonly confirmBeforeUndo?: boolean;
	undo(): Promise<void> | void;
	redo(): Promise<void> | void;
}

export interface IWorkspaceUndoRedoElement {
	readonly type: UndoRedoElementType.Workspace;
	readonly resources: readonly URI[];
	readonly label: string;
	readonly code: string;
	readonly confirmBeforeUndo?: boolean;
	undo(): Promise<void> | void;
	redo(): Promise<void> | void;

	split?(): IResourceUndoRedoElement[];

	prepareUndoRedo?(): Promise<IDisposable> | IDisposable | void;
}

export type IUndoRedoElement = IResourceUndoRedoElement | IWorkspaceUndoRedoElement;

export interface IPastFutureElements {
	past: IUndoRedoElement[];
	future: IUndoRedoElement[];
}

export interface UriComparisonKeyComputer {
	getComparisonKey(uri: URI): string;
}

export class ResourceEditStackSnapshot {
	constructor(
		public readonly resource: URI,
		public readonly elements: number[]
	) { }
}

export class UndoRedoGroup {
	private static _ID = 0;

	public readonly id: number;
	private order: number;

	constructor() {
		this.id = UndoRedoGroup._ID++;
		this.order = 1;
	}

	public nextOrder(): number {
		if (this.id === 0) {
			return 0;
		}
		return this.order++;
	}

	public static None = new UndoRedoGroup();
}

export class UndoRedoSource {
	private static _ID = 0;

	public readonly id: number;
	private order: number;

	constructor() {
		this.id = UndoRedoSource._ID++;
		this.order = 1;
	}

	public nextOrder(): number {
		if (this.id === 0) {
			return 0;
		}
		return this.order++;
	}

	public static None = new UndoRedoSource();
}

export interface IUndoRedoService {
	readonly _serviceBrand: undefined;

	registerUriComparisonKeyComputer(scheme: string, uriComparisonKeyComputer: UriComparisonKeyComputer): IDisposable;

	getUriComparisonKey(resource: URI): string;

	pushElement(element: IUndoRedoElement, group?: UndoRedoGroup, source?: UndoRedoSource): void;

	getLastElement(resource: URI): IUndoRedoElement | null;

	getElements(resource: URI): IPastFutureElements;

	setElementsValidFlag(resource: URI, isValid: boolean, filter: (element: IUndoRedoElement) => boolean): void;

	removeElements(resource: URI): void;

	createSnapshot(resource: URI): ResourceEditStackSnapshot;
	restoreSnapshot(snapshot: ResourceEditStackSnapshot): void;

	canUndo(resource: URI | UndoRedoSource): boolean;
	undo(resource: URI | UndoRedoSource): Promise<void> | void;

	canRedo(resource: URI | UndoRedoSource): boolean;
	redo(resource: URI | UndoRedoSource): Promise<void> | void;
}
