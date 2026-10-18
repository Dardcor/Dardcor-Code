/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IInstantiationService, createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorPane, GroupIdentifier, EditorInputWithOptions, CloseDirection, IEditorPartOptions, IEditorPartOptionsChangeEvent, EditorsOrder, IVisibleEditorPane, IEditorCloseEvent, IUntypedEditorInput, isEditorInput, IEditorWillMoveEvent, IMatchEditorOptions, IActiveEditorChangeEvent, IFindEditorOptions, IToolbarActions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorOptions, IModalEditorNavigation, IModalEditorPartOptions } from '../../../../platform/editor/common/editor.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDimension } from '../../../../editor/common/core/2d/dimension.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { ContextKeyValue, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { URI } from '../../../../base/common/uri.js';
import { IGroupModelChangeEvent } from '../../../common/editor/editorGroupModel.js';
import { IRectangle } from '../../../../platform/window/common/window.js';
import { IMenuChangeEvent, MenuId } from '../../../../platform/actions/common/actions.js';
import { DeepPartial } from '../../../../base/common/types.js';

export const IEditorGroupsService = createDecorator<IEditorGroupsService>('editorGroupsService');

export const enum GroupActivationReason {

	DEFAULT = 0,

	PART_CLOSE = 1
}

export interface IEditorGroupActivationEvent {
	readonly group: IEditorGroup;
	readonly reason: GroupActivationReason;
}

export const enum GroupDirection {
	UP,
	DOWN,
	LEFT,
	RIGHT
}

export const enum GroupOrientation {
	HORIZONTAL,
	VERTICAL
}

export const enum GroupLocation {
	FIRST,
	LAST,
	NEXT,
	PREVIOUS
}

export interface IFindGroupScope {
	readonly direction?: GroupDirection;
	readonly location?: GroupLocation;
}

export const enum GroupsArrangement {
	MAXIMIZE,

	EXPAND,

	EVEN
}

export interface GroupLayoutArgument {

	readonly size?: number;

	readonly groups?: GroupLayoutArgument[];
}

export interface EditorGroupLayout {

	readonly orientation: GroupOrientation;

	readonly groups: GroupLayoutArgument[];
}

export const enum MergeGroupMode {
	COPY_EDITORS,
	MOVE_EDITORS
}

export interface IMergeGroupOptions {
	mode?: MergeGroupMode;
	readonly index?: number;

	readonly preserveExistingIndex?: boolean;
}

export interface ICloseEditorOptions {
	readonly preserveFocus?: boolean;

	readonly force?: boolean;
}

export type ICloseEditorsFilter = {
	readonly except?: EditorInput;
	readonly direction?: CloseDirection;
	readonly savedOnly?: boolean;
	readonly excludeSticky?: boolean;
};

export interface ICloseAllEditorsOptions {
	readonly excludeSticky?: boolean;
	readonly excludeConfirming?: boolean;
	readonly force?: boolean;
}

export interface IEditorReplacement {
	readonly editor: EditorInput;
	readonly replacement: EditorInput;
	readonly options?: IEditorOptions;

	readonly forceReplaceDirty?: boolean;
}

export function isEditorReplacement(replacement: unknown): replacement is IEditorReplacement {
	const candidate = replacement as IEditorReplacement | undefined;

	return isEditorInput(candidate?.editor) && isEditorInput(candidate?.replacement);
}

export const enum GroupsOrder {

	CREATION_TIME,

	MOST_RECENTLY_ACTIVE,

	GRID_APPEARANCE
}

export interface IEditorSideGroup {

	openEditor(editor: EditorInput, options?: IEditorOptions): Promise<IEditorPane | undefined>;
}

export interface IEditorDropTargetDelegate {

	containsGroup?(groupView: IEditorGroup): boolean;
}

export interface IEditorGroupsContainer {

	readonly onDidChangeActiveGroup: Event<IEditorGroup>;

	readonly onDidAddGroup: Event<IEditorGroup>;

	readonly onDidRemoveGroup: Event<IEditorGroup>;

	readonly onDidMoveGroup: Event<IEditorGroup>;

	readonly onDidActivateGroup: Event<IEditorGroupActivationEvent>;

	readonly onDidChangeGroupIndex: Event<IEditorGroup>;

	readonly onDidChangeGroupLocked: Event<IEditorGroup>;

	readonly onDidChangeGroupMaximized: Event<boolean>;

	readonly onDidChangeEditorPartOptions: Event<IEditorPartOptionsChangeEvent>;

	readonly isReady: boolean;

	readonly whenReady: Promise<void>;

	readonly whenRestored: Promise<void>;

	readonly hasRestorableState: boolean;

	readonly activeGroup: IEditorGroup;

	readonly sideGroup: IEditorSideGroup;

	readonly groups: readonly IEditorGroup[];

	readonly count: number;

	readonly orientation: GroupOrientation;

	readonly partOptions: IEditorPartOptions;

	enforcePartOptions(options: DeepPartial<IEditorPartOptions>): IDisposable;

	getGroups(order: GroupsOrder): readonly IEditorGroup[];

	getGroup(identifier: GroupIdentifier): IEditorGroup | undefined;

	activateGroup(group: IEditorGroup | GroupIdentifier): IEditorGroup;

	getSize(group: IEditorGroup | GroupIdentifier): { width: number; height: number };

	setSize(group: IEditorGroup | GroupIdentifier, size: { width: number; height: number }): void;

	arrangeGroups(arrangement: GroupsArrangement, target?: IEditorGroup | GroupIdentifier): void;

	toggleMaximizeGroup(group?: IEditorGroup | GroupIdentifier): void;

	toggleExpandGroup(group?: IEditorGroup | GroupIdentifier): void;

	applyLayout(layout: EditorGroupLayout): void;

	getLayout(): EditorGroupLayout;

	setGroupOrientation(orientation: GroupOrientation): void;

	findGroup(scope: IFindGroupScope, source?: IEditorGroup | GroupIdentifier, wrap?: boolean): IEditorGroup | undefined;

	addGroup(location: IEditorGroup | GroupIdentifier, direction: GroupDirection): IEditorGroup;

	removeGroup(group: IEditorGroup | GroupIdentifier): void;

	moveGroup(group: IEditorGroup | GroupIdentifier, location: IEditorGroup | GroupIdentifier, direction: GroupDirection): IEditorGroup;

	mergeGroup(group: IEditorGroup | GroupIdentifier, target: IEditorGroup | GroupIdentifier, options?: IMergeGroupOptions): boolean;

	mergeAllGroups(target: IEditorGroup | GroupIdentifier): boolean;

	copyGroup(group: IEditorGroup | GroupIdentifier, location: IEditorGroup | GroupIdentifier, direction: GroupDirection): IEditorGroup;

	createEditorDropTarget(container: unknown , delegate: IEditorDropTargetDelegate): IDisposable;
}

export interface IEditorPart extends IEditorGroupsContainer {

	readonly onDidLayout: Event<IDimension>;

	readonly onDidScroll: Event<void>;

	readonly onWillDispose: Event<void>;

	readonly windowId: number;

	readonly contentDimension: IDimension;

	hasMaximizedGroup(): boolean;

	centerLayout(active: boolean): void;

	isLayoutCentered(): boolean;
}

export interface IAuxiliaryEditorPart extends IEditorPart {

	close(): boolean;
}

export interface IModalEditorPart extends IEditorPart {

	readonly modalElement: unknown ;

	readonly maximized: boolean;

	readonly onDidChangeMaximized: Event<boolean>;

	toggleMaximized(): void;

	readonly size: IDimension | undefined;

	readonly position: { left: number; top: number } | undefined;

	readonly hasSidebar: boolean;

	readonly sidebarWidth: number | undefined;

	readonly sidebarHidden: boolean;

	toggleSidebar(): void;

	readonly navigation: IModalEditorNavigation | undefined;

	updateOptions(options?: IModalEditorPartOptions): void;

	readonly onWillClose: Event<void>;

	close(options?: { mergeAllEditorsToMainPart?: boolean }): Promise<boolean>;
}

export interface IEditorWorkingSet {
	readonly id: string;
	readonly name: string;
}

export interface IEditorWorkingSetOptions {
	readonly preserveFocus?: boolean;
}

export interface IEditorGroupContextKeyProvider<T extends ContextKeyValue> {




	readonly contextKey: RawContextKey<T>;

	readonly getGroupContextKeyValue: (group: IEditorGroup) => T;

	readonly onDidChange?: Event<void>;
}

export interface IEditorGroupsService extends IEditorGroupsContainer {

	readonly _serviceBrand: undefined;

	readonly onDidCreateAuxiliaryEditorPart: Event<IAuxiliaryEditorPart>;

	readonly mainPart: IEditorPart;

	readonly parts: ReadonlyArray<IEditorPart>;

	getPart(group: IEditorGroup | GroupIdentifier): IEditorPart;

	getPart(container: unknown ): IEditorPart;

	createAuxiliaryEditorPart(options?: { bounds?: Partial<IRectangle>; compact?: boolean; alwaysOnTop?: boolean }): Promise<IAuxiliaryEditorPart>;

	createModalEditorPart(options?: IModalEditorPartOptions): Promise<IModalEditorPart>;

	readonly activeModalEditorPart: IModalEditorPart | undefined;

	getScopedInstantiationService(part: IEditorPart): IInstantiationService;

	saveWorkingSet(name: string): IEditorWorkingSet;

	getWorkingSets(): IEditorWorkingSet[];

	applyWorkingSet(workingSet: IEditorWorkingSet | 'empty', options?: IEditorWorkingSetOptions): Promise<boolean>;

	deleteWorkingSet(workingSet: IEditorWorkingSet): void;







	registerContextKeyProvider<T extends ContextKeyValue>(provider: IEditorGroupContextKeyProvider<T>): IDisposable;
}

export const enum OpenEditorContext {
	NEW_EDITOR = 1,
	MOVE_EDITOR = 2,
	COPY_EDITOR = 3
}

export interface IActiveEditorActions {
	readonly actions: IToolbarActions;
	readonly onDidChange: Event<IMenuChangeEvent | void>;
}

export interface IEditorGroup {

	readonly onDidModelChange: Event<IGroupModelChangeEvent>;

	readonly onWillDispose: Event<void>;

	readonly onDidActiveEditorChange: Event<IActiveEditorChangeEvent>;

	readonly onWillCloseEditor: Event<IEditorCloseEvent>;

	readonly onDidCloseEditor: Event<IEditorCloseEvent>;

	readonly onWillMoveEditor: Event<IEditorWillMoveEvent>;

	readonly id: GroupIdentifier;

	readonly windowId: number;

	readonly index: number;

	readonly label: string;

	readonly ariaLabel: string;

	readonly activeEditorPane: IVisibleEditorPane | undefined;

	readonly activeEditor: EditorInput | null;

	readonly selectedEditors: EditorInput[];

	readonly previewEditor: EditorInput | null;

	readonly count: number;

	readonly isEmpty: boolean;

	readonly isLocked: boolean;

	readonly stickyCount: number;

	readonly editors: readonly EditorInput[];

	readonly scopedContextKeyService: IContextKeyService;

	getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): readonly EditorInput[];

	findEditors(resource: URI, options?: IFindEditorOptions): readonly EditorInput[];

	getEditorByIndex(index: number): EditorInput | undefined;

	getIndexOfEditor(editor: EditorInput): number;

	isFirst(editor: EditorInput): boolean;

	isLast(editor: EditorInput): boolean;

	openEditor(editor: EditorInput, options?: IEditorOptions): Promise<IEditorPane | undefined>;

	openEditors(editors: EditorInputWithOptions[]): Promise<IEditorPane | undefined>;

	isPinned(editorOrIndex: EditorInput | number): boolean;

	isSticky(editorOrIndex: EditorInput | number): boolean;

	isTransient(editorOrIndex: EditorInput | number): boolean;

	isActive(editor: EditorInput | IUntypedEditorInput): boolean;

	isSelected(editor: EditorInput): boolean;

	setSelection(activeSelectedEditor: EditorInput, inactiveSelectedEditors: EditorInput[]): Promise<void>;

	contains(candidate: EditorInput | IUntypedEditorInput, options?: IMatchEditorOptions): boolean;

	moveEditor(editor: EditorInput, target: IEditorGroup, options?: IEditorOptions): boolean;

	moveEditors(editors: EditorInputWithOptions[], target: IEditorGroup): boolean;

	copyEditor(editor: EditorInput, target: IEditorGroup, options?: IEditorOptions): void;

	copyEditors(editors: EditorInputWithOptions[], target: IEditorGroup): void;

	closeEditor(editor?: EditorInput, options?: ICloseEditorOptions): Promise<boolean>;

	closeEditors(editors: EditorInput[] | ICloseEditorsFilter, options?: ICloseEditorOptions): Promise<boolean>;

	closeAllEditors(options: { excludeConfirming: true; force?: boolean }): boolean;
	closeAllEditors(options?: ICloseAllEditorsOptions): Promise<boolean>;

	replaceEditors(editors: IEditorReplacement[]): Promise<void>;

	pinEditor(editor?: EditorInput): void;

	stickEditor(editor?: EditorInput): void;

	unstickEditor(editor?: EditorInput): void;

	lock(locked: boolean): void;

	focus(): void;

	createEditorActions(disposables: DisposableStore, menuId?: MenuId): IActiveEditorActions;
}

export function isEditorGroup(obj: unknown): obj is IEditorGroup {
	const group = obj as IEditorGroup | undefined;

	return !!group && typeof group.id === 'number' && Array.isArray(group.editors);
}


export function preferredSideBySideGroupDirection(configurationService: IConfigurationService): GroupDirection.DOWN | GroupDirection.RIGHT {
	const openSideBySideDirection = configurationService.getValue('workbench.editor.openSideBySideDirection');

	if (openSideBySideDirection === 'down') {
		return GroupDirection.DOWN;
	}

	return GroupDirection.RIGHT;
}

