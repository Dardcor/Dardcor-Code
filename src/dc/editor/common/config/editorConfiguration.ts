/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { ConfigurationChangedEvent, IComputedEditorOptions, IEditorOptions } from './editorOptions.js';
import { IDimension } from '../core/2d/dimension.js';
import { MenuId } from '../../../platform/actions/common/actions.js';

export interface IEditorConfiguration extends IDisposable {
	readonly isSimpleWidget: boolean;
	readonly contextMenuId: MenuId;
	readonly options: IComputedEditorOptions;
	readonly onDidChangeFast: Event<ConfigurationChangedEvent>;
	readonly onDidChange: Event<ConfigurationChangedEvent>;
	getRawOptions(): IEditorOptions;
	updateOptions(newOptions: Readonly<IEditorOptions>): void;
	observeContainer(dimension?: IDimension): void;
	setIsDominatedByLongLines(isDominatedByLongLines: boolean): void;
	setModelLineCount(modelLineCount: number): void;
	setViewLineCount(viewLineCount: number): void;
	setReservedHeight(reservedHeight: number): void;
	setGlyphMarginDecorationLaneCount(decorationLaneCount: number): void;
}
