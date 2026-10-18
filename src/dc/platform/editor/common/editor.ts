/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from '../../../base/common/arrays.js';
import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IUriIdentityService } from '../../uriIdentity/common/uriIdentity.js';
import { IRectangle } from '../../window/common/window.js';

export interface IResolvableEditorModel extends IDisposable {

	resolve(): Promise<void>;

	isResolved(): boolean;
}

export function isResolvedEditorModel(model: IDisposable | undefined | null): model is IResolvableEditorModel {
	const candidate = model as IResolvableEditorModel | undefined | null;

	return typeof candidate?.resolve === 'function'
		&& typeof candidate?.isResolved === 'function';
}

export interface IBaseUntypedEditorInput {

	options?: IEditorOptions;

	readonly label?: string;

	readonly description?: string;
}

export interface IBaseResourceEditorInput extends IBaseUntypedEditorInput {

	readonly forceUntitled?: boolean;
}

export interface IBaseTextResourceEditorInput extends IBaseResourceEditorInput {

	options?: ITextEditorOptions;

	contents?: string;

	encoding?: string;

	languageId?: string;
}

export interface IResourceEditorInput extends IBaseResourceEditorInput {

	readonly resource: URI;
}

export interface ITextResourceEditorInput extends IResourceEditorInput, IBaseTextResourceEditorInput {

	options?: ITextEditorOptions;
}

export interface IResourceEditorInputIdentifier {

	readonly typeId: string;

	readonly editorId: string | undefined;

	readonly resource: URI;
}

export enum EditorActivation {

	ACTIVATE = 1,

	RESTORE,

	PRESERVE
}

export enum EditorResolution {

	PICK,

	EXCLUSIVE_ONLY
}

export enum EditorOpenSource {

	API,

	USER
}

export interface IEditorOptions {

	preserveFocus?: boolean;

	activation?: EditorActivation;

	forceReload?: boolean;

	revealIfVisible?: boolean;

	revealIfOpened?: boolean;

	pinned?: boolean;

	sticky?: boolean;

	index?: number;

	inactive?: boolean;

	ignoreError?: boolean;

	override?: string | EditorResolution;

	source?: EditorOpenSource;

	isExplicit?: boolean;

	viewState?: object;

	transient?: boolean;

	auxiliary?: {

		bounds?: Partial<IRectangle>;

		compact?: boolean;

		alwaysOnTop?: boolean;
	};

	modal?: IModalEditorPartOptions;
}

export interface IModalEditorPartOptions {

	readonly maximized?: boolean;

	readonly size?: { readonly width: number; readonly height: number };

	readonly position?: { readonly left: number; readonly top: number };

	readonly navigation?: IModalEditorNavigation;

	readonly sidebar?: IModalEditorSidebar;
}

export interface IModalEditorOptions {

	readonly compactHeader?: boolean;
}

export interface IModalEditorOptionsProvider {
	getModalEditorOptions(): IModalEditorOptions | undefined;
}

export function isModalEditorOptionsProvider(obj: unknown): obj is IModalEditorOptionsProvider {
	return !!obj && typeof (obj as IModalEditorOptionsProvider).getModalEditorOptions === 'function';
}

export interface IModalEditorSidebar {

	readonly sidebarWidth?: number;

	readonly sidebarHidden?: boolean;

	readonly render: (container: unknown , onDidLayout: Event<{ readonly height: number; readonly width: number }>, contextKeyService: IContextKeyService) => IDisposable;
}

export interface IModalEditorNavigation {

	readonly total: number;

	readonly current: number;

	readonly navigate: (index: number) => void;
}

export interface ITextEditorSelection {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber?: number;
	readonly endColumn?: number;
}

export const enum TextEditorSelectionRevealType {
	Center = 0,

	CenterIfOutsideViewport = 1,

	NearTop = 2,

	NearTopIfOutsideViewport = 3,
}

export const enum TextEditorSelectionSource {

	PROGRAMMATIC = 'api',

	NAVIGATION = 'code.navigation',

	JUMP = 'code.jump'
}

export interface ITextEditorOptions extends IEditorOptions {

	selection?: ITextEditorSelection;

	selectionRevealType?: TextEditorSelectionRevealType;

	selectionSource?: TextEditorSelectionSource | string;
}

export type ITextEditorChange = [
	originalStartLineNumber: number,
	originalEndLineNumberExclusive: number,
	modifiedStartLineNumber: number,
	modifiedEndLineNumberExclusive: number
];

export interface ITextEditorDiffInformation {
	readonly documentVersion: number;
	readonly original: URI | undefined;
	readonly modified: URI;
	readonly changes: readonly ITextEditorChange[];
}

export function isTextEditorDiffInformationEqual(
	uriIdentityService: IUriIdentityService,
	diff1: ITextEditorDiffInformation | undefined,
	diff2: ITextEditorDiffInformation | undefined): boolean {
	return diff1?.documentVersion === diff2?.documentVersion &&
		uriIdentityService.extUri.isEqual(diff1?.original, diff2?.original) &&
		uriIdentityService.extUri.isEqual(diff1?.modified, diff2?.modified) &&
		equals<ITextEditorChange>(diff1?.changes, diff2?.changes, (a, b) => {
			return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
		});
}
