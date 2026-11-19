/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionViewItem } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { IActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../base/common/actions.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';

export const enum MultiDiffEditorItemLabelKind {
	Primary = 'primary',
	Secondary = 'secondary',
}

export interface IWorkbenchUIElementFactory {
	createResourceLabel?(element: HTMLElement, kind: MultiDiffEditorItemLabelKind, accessoryContainer: HTMLElement): IResourceLabel;

	handleHeaderMiddleClick?(resource: URI): boolean;

	openDiffEditor?(original: URI, modified: URI): void;

	createToolbarActionViewItem?(action: IAction, options: IActionViewItemOptions): IActionViewItem | undefined;
}

export interface IResourceLabel extends IDisposable {
	setUri(uri: URI | undefined, options?: IResourceLabelOptions): void;
}

export interface IResourceLabelOptions {
	strikethrough?: boolean;
}
