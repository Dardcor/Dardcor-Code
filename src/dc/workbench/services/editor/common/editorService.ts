/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IResourceEditorInput, IEditorOptions, IResourceEditorInputIdentifier, ITextResourceEditorInput } from '../../../../platform/editor/common/editor.js';
import { IEditorPane, GroupIdentifier, IUntitledTextResourceEditorInput, IResourceDiffEditorInput, ITextDiffEditorPane, IEditorIdentifier, ISaveOptions, IRevertOptions, EditorsOrder, IVisibleEditorPane, IEditorCloseEvent, IUntypedEditorInput, IFindEditorOptions, IEditorWillOpenEvent, ITextResourceDiffEditorInput, EditorInputWithOptions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { Event } from '../../../../base/common/event.js';
import { IEditor, IDiffEditor } from '../../../../editor/common/editorCommon.js';
import { ICloseEditorOptions, IEditorGroup, IEditorGroupsContainer, isEditorGroup } from './editorGroupsService.js';
import { URI } from '../../../../base/common/uri.js';
import { IGroupModelChangeEvent } from '../../../common/editor/editorGroupModel.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

export const IEditorService = createDecorator<IEditorService>('editorService');

export const ACTIVE_GROUP = -1;
export type ACTIVE_GROUP_TYPE = typeof ACTIVE_GROUP;

export const SIDE_GROUP = -2;
export type SIDE_GROUP_TYPE = typeof SIDE_GROUP;

export const AUX_WINDOW_GROUP = -3;
export type AUX_WINDOW_GROUP_TYPE = typeof AUX_WINDOW_GROUP;

export const MODAL_GROUP = -4;
export type MODAL_GROUP_TYPE = typeof MODAL_GROUP;

export const USE_MODAL_EDITOR_SETTING = 'workbench.editor.useModal';

export type UseModalEditorMode = 'off' | 'some' | 'all';

export type PreferredGroup = IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE | AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE;

export function isPreferredGroup(obj: unknown): obj is PreferredGroup {
	const candidate = obj as PreferredGroup | undefined;

	return typeof obj === 'number' || isEditorGroup(candidate);
}

export interface ISaveEditorsOptions extends ISaveOptions {

	readonly saveAs?: boolean;
}

export interface ISaveEditorsResult {

	readonly success: boolean;

	readonly editors: Array<EditorInput | IUntypedEditorInput>;
}

export interface IUntypedEditorReplacement {

	readonly editor: EditorInput;

	readonly replacement: IUntypedEditorInput;

	forceReplaceDirty?: boolean;
}

export interface IBaseSaveRevertAllEditorOptions {

	readonly includeUntitled?: {

		readonly includeScratchpad: boolean;

	} | boolean;

	readonly excludeSticky?: boolean;
}

export interface ISaveAllEditorsOptions extends ISaveEditorsOptions, IBaseSaveRevertAllEditorOptions { }

export interface IRevertAllEditorsOptions extends IRevertOptions, IBaseSaveRevertAllEditorOptions { }

export interface IOpenEditorsOptions {

	readonly validateTrust?: boolean;
}

export interface IEditorsChangeEvent {
	groupId: GroupIdentifier;
	event: IGroupModelChangeEvent;
}

export interface IVisibleEditorsChangeEvent {

	readonly isExplicit: boolean;
}

export interface IEditorService {

	readonly _serviceBrand: undefined;

	readonly onDidActiveEditorChange: Event<void>;

	readonly onDidVisibleEditorsChange: Event<IVisibleEditorsChangeEvent>;

	readonly onDidEditorsChange: Event<IEditorsChangeEvent>;

	readonly onWillOpenEditor: Event<IEditorWillOpenEvent>;

	readonly onDidCloseEditor: Event<IEditorCloseEvent>;

	readonly activeEditorPane: IVisibleEditorPane | undefined;

	readonly activeEditor: EditorInput | undefined;

	readonly activeTextEditorControl: IEditor | IDiffEditor | undefined;

	readonly activeTextEditorLanguageId: string | undefined;

	readonly visibleEditorPanes: readonly IVisibleEditorPane[];

	readonly visibleEditors: readonly EditorInput[];

	readonly visibleTextEditorControls: readonly (IEditor | IDiffEditor)[];

	getVisibleTextEditorControls(order: EditorsOrder): readonly (IEditor | IDiffEditor)[];

	readonly editors: readonly EditorInput[];

	readonly count: number;

	getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): readonly IEditorIdentifier[];

	openEditor(editor: IResourceEditorInput, group?: PreferredGroup): Promise<IEditorPane | undefined>;
	openEditor(editor: ITextResourceEditorInput | IUntitledTextResourceEditorInput, group?: PreferredGroup): Promise<IEditorPane | undefined>;
	openEditor(editor: ITextResourceDiffEditorInput | IResourceDiffEditorInput, group?: PreferredGroup): Promise<ITextDiffEditorPane | undefined>;
	openEditor(editor: IUntypedEditorInput, group?: PreferredGroup): Promise<IEditorPane | undefined>;

	openEditor(editor: EditorInput, options?: IEditorOptions, group?: PreferredGroup): Promise<IEditorPane | undefined>;

	openEditors(editors: EditorInputWithOptions[], group?: PreferredGroup, options?: IOpenEditorsOptions): Promise<readonly IEditorPane[]>;
	openEditors(editors: IUntypedEditorInput[], group?: PreferredGroup, options?: IOpenEditorsOptions): Promise<readonly IEditorPane[]>;

	replaceEditors(replacements: IUntypedEditorReplacement[], group: IEditorGroup | GroupIdentifier): Promise<void>;

	isOpened(editor: IResourceEditorInputIdentifier): boolean;

	isVisible(editor: EditorInput): boolean;

	closeEditor(editor: IEditorIdentifier, options?: ICloseEditorOptions): Promise<void>;

	closeEditors(editors: readonly IEditorIdentifier[], options?: ICloseEditorOptions): Promise<void>;

	findEditors(resource: URI, options?: IFindEditorOptions): readonly IEditorIdentifier[];
	findEditors(editor: IResourceEditorInputIdentifier, options?: IFindEditorOptions): readonly IEditorIdentifier[];

	save(editors: IEditorIdentifier | readonly IEditorIdentifier[], options?: ISaveEditorsOptions): Promise<ISaveEditorsResult>;

	saveAll(options?: ISaveAllEditorsOptions): Promise<ISaveEditorsResult>;

	revert(editors: IEditorIdentifier | readonly IEditorIdentifier[], options?: IRevertOptions): Promise<boolean>;

	revertAll(options?: IRevertAllEditorsOptions): Promise<boolean>;

	createScoped(editorGroupsContainer: IEditorGroupsContainer, disposables: DisposableStore): IEditorService;
}
