/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../nls.js';
import { Event } from '../../base/common/event.js';
import { DeepRequiredNonNullable, assertReturnsDefined } from '../../base/common/types.js';
import { URI } from '../../base/common/uri.js';
import { Disposable, IDisposable, toDisposable } from '../../base/common/lifecycle.js';
import { ICodeEditorViewState, IDiffEditor, IDiffEditorViewState, IEditor, IEditorViewState } from '../../editor/common/editorCommon.js';
import { IEditorOptions, IResourceEditorInput, ITextResourceEditorInput, IBaseTextResourceEditorInput, IBaseUntypedEditorInput, ITextEditorOptions } from '../../platform/editor/common/editor.js';
import type { EditorInput } from './editor/editorInput.js';
import { IInstantiationService, IConstructorSignature, ServicesAccessor, BrandedService } from '../../platform/instantiation/common/instantiation.js';
import { IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../platform/registry/common/platform.js';
import { IEncodingSupport, ILanguageSupport } from '../services/textfile/common/textfiles.js';
import { IEditorGroup } from '../services/editor/common/editorGroupsService.js';
import { ICompositeControl, IComposite } from './composite.js';
import { FileType, IFileReadLimits, IFileService } from '../../platform/files/common/files.js';
import { IPathData } from '../../platform/window/common/window.js';
import { IExtUri } from '../../base/common/resources.js';
import { Schemas } from '../../base/common/network.js';
import { IEditorService } from '../services/editor/common/editorService.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IErrorWithActions, createErrorWithActions, isErrorWithActions } from '../../base/common/errorMessage.js';
import { IAction, toAction } from '../../base/common/actions.js';
import Severity from '../../base/common/severity.js';
import { IPreferencesService } from '../services/preferences/common/preferences.js';
import { IReadonlyEditorGroupModel } from './editor/editorGroupModel.js';

export const EditorExtensions = {
	EditorPane: 'workbench.contributions.editors',
	EditorFactory: 'workbench.contributions.editor.inputFactories'
};

export const DEFAULT_EDITOR_ASSOCIATION = {
	id: 'default',
	displayName: localize('promptOpenWith.defaultEditor.displayName', "Text Editor"),
	providerDisplayName: localize('builtinProviderDisplayName', "Built-in")
};

export const SIDE_BY_SIDE_EDITOR_ID = 'workbench.editor.sidebysideEditor';

export const TEXT_DIFF_EDITOR_ID = 'workbench.editors.textDiffEditor';

export const BINARY_DIFF_EDITOR_ID = 'workbench.editors.binaryResourceDiffEditor';

export interface IEditorDescriptor<T extends IEditorPane> {

	readonly typeId: string;

	readonly name: string;

	instantiate(instantiationService: IInstantiationService, group: IEditorGroup): T;

	describes(editorPane: T): boolean;
}

export interface IEditorPane extends IComposite {

	readonly onDidChangeControl: Event<void>;

	readonly onDidChangeSelection?: Event<IEditorPaneSelectionChangeEvent>;

	readonly onDidChangeScroll?: Event<void>;

	readonly input: EditorInput | undefined;

	readonly options: IEditorOptions | undefined;

	readonly group: IEditorGroup;

	readonly minimumWidth: number;

	readonly maximumWidth: number;

	readonly minimumHeight: number;

	readonly maximumHeight: number;

	readonly onDidChangeSizeConstraints: Event<{ width: number; height: number } | undefined>;

	readonly scopedContextKeyService: IContextKeyService | undefined;

	getControl(): IEditorControl | undefined;

	getViewState(): object | undefined;

	readonly scopedInstantiationService?: IInstantiationService;

	getSelection?(): IEditorPaneSelection | undefined;

	getScrollPosition?(): IEditorPaneScrollPosition;

	setScrollPosition?(scrollPosition: IEditorPaneScrollPosition): void;

	isVisible(): boolean;
}

export interface IEditorPaneSelectionChangeEvent {

	reason: EditorPaneSelectionChangeReason;
}

export const enum EditorPaneSelectionChangeReason {

	PROGRAMMATIC = 1,

	USER,

	EDIT,

	NAVIGATION,

	JUMP
}

export interface IEditorPaneSelection {

	compare(otherSelection: IEditorPaneSelection): EditorPaneSelectionCompareResult;

	restore(options: IEditorOptions): IEditorOptions;

	log?(): string;
}

export const enum EditorPaneSelectionCompareResult {

	IDENTICAL = 1,

	SIMILAR = 2,

	DIFFERENT = 3
}

export interface IEditorPaneWithSelection extends IEditorPane {

	readonly onDidChangeSelection: Event<IEditorPaneSelectionChangeEvent>;

	getSelection(): IEditorPaneSelection | undefined;
}

export function isEditorPaneWithSelection(editorPane: IEditorPane | undefined): editorPane is IEditorPaneWithSelection {
	const candidate = editorPane as IEditorPaneWithSelection | undefined;

	return !!candidate && typeof candidate.getSelection === 'function' && !!candidate.onDidChangeSelection;
}

export interface IEditorPaneWithScrolling extends IEditorPane {

	readonly onDidChangeScroll: Event<void>;

	getScrollPosition(): IEditorPaneScrollPosition;

	setScrollPosition(position: IEditorPaneScrollPosition): void;
}

export function isEditorPaneWithScrolling(editorPane: IEditorPane | undefined): editorPane is IEditorPaneWithScrolling {
	const candidate = editorPane as IEditorPaneWithScrolling | undefined;

	return !!candidate && typeof candidate.getScrollPosition === 'function' && typeof candidate.setScrollPosition === 'function' && !!candidate.onDidChangeScroll;
}

export interface IEditorPaneScrollPosition {
	readonly scrollTop: number;
	readonly scrollLeft?: number;
}

export function findViewStateForEditor(input: EditorInput, group: GroupIdentifier, editorService: IEditorService): object | undefined {
	for (const editorPane of editorService.visibleEditorPanes) {
		if (editorPane.group.id === group && input.matches(editorPane.input)) {
			return editorPane.getViewState();
		}
	}

	return undefined;
}

export interface IVisibleEditorPane extends IEditorPane {
	readonly input: EditorInput;
}

export interface ITextEditorPane extends IEditorPane {

	getControl(): IEditor | undefined;
}

export interface ITextDiffEditorPane extends IEditorPane {

	getControl(): IDiffEditor | undefined;
}

export interface IEditorControl extends ICompositeControl { }

export interface IFileEditorFactory {

	typeId: string;

	createFileEditor(resource: URI, preferredResource: URI | undefined, preferredName: string | undefined, preferredDescription: string | undefined, preferredEncoding: string | undefined, preferredLanguageId: string | undefined, preferredContents: string | undefined, instantiationService: IInstantiationService): IFileEditorInput;

	isFileEditor(obj: unknown): obj is IFileEditorInput;
}

export interface IEditorFactoryRegistry {

	registerFileEditorFactory(factory: IFileEditorFactory): void;

	getFileEditorFactory(): IFileEditorFactory;

	registerEditorSerializer<Services extends BrandedService[]>(editorTypeId: string, ctor: { new(...Services: Services): IEditorSerializer }): IDisposable;

	getEditorSerializer(editor: EditorInput): IEditorSerializer | undefined;
	getEditorSerializer(editorTypeId: string): IEditorSerializer | undefined;

	start(accessor: ServicesAccessor): void;
}

export interface IEditorSerializer {

	canSerialize(editor: EditorInput): boolean;

	serialize(editor: EditorInput): string | undefined;

	deserialize(instantiationService: IInstantiationService, serializedEditor: string): EditorInput | undefined;
}

export interface IUntitledTextResourceEditorInput extends IBaseTextResourceEditorInput {

	readonly resource: URI | undefined;
}

export interface IResourceSideBySideEditorInput extends IBaseUntypedEditorInput {

	readonly primary: Omit<IResourceEditorInput, 'options'> | Omit<ITextResourceEditorInput, 'options'> | Omit<IUntitledTextResourceEditorInput, 'options'>;

	readonly secondary: Omit<IResourceEditorInput, 'options'> | Omit<ITextResourceEditorInput, 'options'> | Omit<IUntitledTextResourceEditorInput, 'options'>;
}

export interface IResourceDiffEditorInput extends IBaseUntypedEditorInput {

	readonly original: Omit<IResourceEditorInput, 'options'> | Omit<ITextResourceEditorInput, 'options'> | Omit<IUntitledTextResourceEditorInput, 'options'>;

	readonly modified: Omit<IResourceEditorInput, 'options'> | Omit<ITextResourceEditorInput, 'options'> | Omit<IUntitledTextResourceEditorInput, 'options'>;
}

export interface ITextResourceDiffEditorInput extends IBaseTextResourceEditorInput {

	readonly original: Omit<ITextResourceEditorInput, 'options'> | Omit<IUntitledTextResourceEditorInput, 'options'>;

	readonly modified: Omit<ITextResourceEditorInput, 'options'> | Omit<IUntitledTextResourceEditorInput, 'options'>;
}

export interface IResourceMultiDiffEditorInput extends IBaseUntypedEditorInput {
	readonly multiDiffSource?: URI;

	readonly resources?: IMultiDiffEditorResource[];

	readonly isTransient?: boolean;
}

export interface IMultiDiffEditorResource extends IResourceDiffEditorInput {
	readonly goToFileResource?: URI;
}
export type IResourceMergeEditorInputSide = (Omit<IResourceEditorInput, 'options'> | Omit<ITextResourceEditorInput, 'options'>) & { detail?: string };

export interface IResourceMergeEditorInput extends IBaseUntypedEditorInput {

	readonly input1: IResourceMergeEditorInputSide;

	readonly input2: IResourceMergeEditorInputSide;

	readonly base: Omit<IResourceEditorInput, 'options'> | Omit<ITextResourceEditorInput, 'options'>;

	readonly result: Omit<IResourceEditorInput, 'options'> | Omit<ITextResourceEditorInput, 'options'>;
}

export function isResourceEditorInput(editor: unknown): editor is IResourceEditorInput {
	if (isEditorInput(editor)) {
		return false;
	}

	const candidate = editor as IResourceEditorInput | undefined;

	return URI.isUri(candidate?.resource);
}

export function isResourceDiffEditorInput(editor: unknown): editor is IResourceDiffEditorInput {
	if (isEditorInput(editor)) {
		return false;
	}

	const candidate = editor as IResourceDiffEditorInput | undefined;

	return candidate?.original !== undefined && candidate.modified !== undefined;
}

export function isResourceMultiDiffEditorInput(editor: unknown): editor is IResourceMultiDiffEditorInput {
	if (isEditorInput(editor)) {
		return false;
	}

	const candidate = editor as IResourceMultiDiffEditorInput | undefined;
	if (!candidate) {
		return false;
	}
	if (candidate.resources && !Array.isArray(candidate.resources)) {
		return false;
	}

	return !!candidate.resources || !!candidate.multiDiffSource;
}

export function isResourceSideBySideEditorInput(editor: unknown): editor is IResourceSideBySideEditorInput {
	if (isEditorInput(editor)) {
		return false;
	}

	if (isResourceDiffEditorInput(editor)) {
		return false;
	}

	const candidate = editor as IResourceSideBySideEditorInput | undefined;

	return candidate?.primary !== undefined && candidate.secondary !== undefined;
}

export function isUntitledResourceEditorInput(editor: unknown): editor is IUntitledTextResourceEditorInput {
	if (isEditorInput(editor)) {
		return false;
	}

	const candidate = editor as IUntitledTextResourceEditorInput | undefined;
	if (!candidate) {
		return false;
	}

	return candidate.resource === undefined || candidate.resource.scheme === Schemas.untitled || candidate.forceUntitled === true;
}

export function isResourceMergeEditorInput(editor: unknown): editor is IResourceMergeEditorInput {
	if (isEditorInput(editor)) {
		return false;
	}

	const candidate = editor as IResourceMergeEditorInput | undefined;

	return URI.isUri(candidate?.base?.resource) && URI.isUri(candidate?.input1?.resource) && URI.isUri(candidate?.input2?.resource) && URI.isUri(candidate?.result?.resource);
}

export const enum Verbosity {
	SHORT,
	MEDIUM,
	LONG
}

export const enum SaveReason {

	EXPLICIT = 1,

	AUTO = 2,

	FOCUS_CHANGE = 3,

	WINDOW_CHANGE = 4
}

export type SaveSource = string;

interface ISaveSourceDescriptor {
	source: SaveSource;
	label: string;
}

class SaveSourceFactory {

	private readonly mapIdToSaveSource = new Map<SaveSource, ISaveSourceDescriptor>();

	registerSource(id: string, label: string): SaveSource {
		let sourceDescriptor = this.mapIdToSaveSource.get(id);
		if (!sourceDescriptor) {
			sourceDescriptor = { source: id, label };
			this.mapIdToSaveSource.set(id, sourceDescriptor);
		}

		return sourceDescriptor.source;
	}

	getSourceLabel(source: SaveSource): string {
		return this.mapIdToSaveSource.get(source)?.label ?? source;
	}
}

export const SaveSourceRegistry = new SaveSourceFactory();

export interface ISaveOptions {

	reason?: SaveReason;

	readonly source?: SaveSource;

	readonly force?: boolean;

	readonly skipSaveParticipants?: boolean;

	readonly availableFileSystems?: string[];
}

export interface IRevertOptions {

	readonly force?: boolean;

	readonly soft?: boolean;
}

export interface IMoveResult {
	editor: EditorInput | IUntypedEditorInput;
	options?: IEditorOptions;
}

export const enum EditorInputCapabilities {

	None = 0,

	Readonly = 1 << 1,

	Untitled = 1 << 2,

	Singleton = 1 << 3,

	RequiresTrust = 1 << 4,

	CanSplitInGroup = 1 << 5,

	ForceDescription = 1 << 6,

	CanDropIntoEditor = 1 << 7,

	MultipleEditors = 1 << 8,

	Scratchpad = 1 << 9,

	ForceReveal = 1 << 10,

	RequiresModal = 1 << 11,

	ExcludeFromEditorLimit = 1 << 12,

	CannotClose = 1 << 13
}

export type IUntypedEditorInput = IResourceEditorInput | ITextResourceEditorInput | IUntitledTextResourceEditorInput | IResourceDiffEditorInput | IResourceMultiDiffEditorInput | IResourceSideBySideEditorInput | IResourceMergeEditorInput;

export abstract class AbstractEditorInput extends Disposable {
}

export function isEditorInput(editor: unknown): editor is EditorInput {
	return editor instanceof AbstractEditorInput;
}

export interface EditorInputWithPreferredResource {

	readonly preferredResource: URI;
}

function isEditorInputWithPreferredResource(editor: unknown): editor is EditorInputWithPreferredResource {
	const candidate = editor as EditorInputWithPreferredResource | undefined;

	return URI.isUri(candidate?.preferredResource);
}

export interface ISideBySideEditorInput extends EditorInput {

	primary: EditorInput;

	secondary: EditorInput;
}

export function isSideBySideEditorInput(editor: unknown): editor is ISideBySideEditorInput {
	const candidate = editor as ISideBySideEditorInput | undefined;

	return isEditorInput(candidate?.primary) && isEditorInput(candidate?.secondary);
}

export interface IDiffEditorInput extends EditorInput {

	modified: EditorInput;

	original: EditorInput;
}

export function isDiffEditorInput(editor: unknown): editor is IDiffEditorInput {
	const candidate = editor as IDiffEditorInput | undefined;

	return isEditorInput(candidate?.modified) && isEditorInput(candidate?.original);
}

export interface IEditorInputWithDiffResources extends EditorInput {
	readonly diffResources: {
		readonly original: URI;
		readonly modified: URI;
	};
}

export function isEditorInputWithDiffResources(editor: unknown): editor is IEditorInputWithDiffResources {
	const candidate = editor as IEditorInputWithDiffResources | undefined;

	return URI.isUri(candidate?.diffResources?.original) && URI.isUri(candidate.diffResources.modified);
}

export interface IUntypedFileEditorInput extends ITextResourceEditorInput {

	forceFile: true;
}

export interface IFileEditorInput extends EditorInput, IEncodingSupport, ILanguageSupport, EditorInputWithPreferredResource {

	readonly resource: URI;

	setPreferredResource(preferredResource: URI): void;

	setPreferredName(name: string): void;

	setPreferredDescription(description: string): void;

	setPreferredEncoding(encoding: string): void;

	setPreferredLanguageId(languageId: string): void;

	setPreferredContents(contents: string): void;

	setForceOpenAsBinary(): void;

	isResolved(): boolean;
}

export interface IFileLimitedEditorInputOptions extends IEditorOptions {

	readonly limits?: IFileReadLimits;
}

export interface IFileEditorInputOptions extends ITextEditorOptions, IFileLimitedEditorInputOptions { }

export function createTooLargeFileError(group: IEditorGroup, input: EditorInput, options: IEditorOptions | undefined, message: string, preferencesService: IPreferencesService): Error {
	return createEditorOpenError(message, [
		toAction({
			id: 'workbench.action.openLargeFile', label: localize('openLargeFile', "Open Anyway"), run: () => {
				const fileEditorOptions: IFileEditorInputOptions = {
					...options,
					limits: {
						size: Number.MAX_VALUE
					}
				};

				group.openEditor(input, fileEditorOptions);
			}
		}),
		toAction({
			id: 'workbench.action.configureEditorLargeFileConfirmation', label: localize('configureEditorLargeFileConfirmation', "Configure Limit"), run: () => {
				return preferencesService.openUserSettings({ query: 'workbench.editorLargeFileConfirmation' });
			}
		}),
	], {
		forceMessage: true,
		forceSeverity: Severity.Warning
	});
}

export interface EditorInputWithOptions {
	editor: EditorInput;
	options?: IEditorOptions;
}

export interface EditorInputWithOptionsAndGroup extends EditorInputWithOptions {
	group: IEditorGroup;
}

export function isEditorInputWithOptions(editor: unknown): editor is EditorInputWithOptions {
	const candidate = editor as EditorInputWithOptions | undefined;

	return isEditorInput(candidate?.editor);
}

export function isEditorInputWithOptionsAndGroup(editor: unknown): editor is EditorInputWithOptionsAndGroup {
	const candidate = editor as EditorInputWithOptionsAndGroup | undefined;

	return isEditorInputWithOptions(editor) && candidate?.group !== undefined;
}

export interface IEditorOpenContext {

	newInGroup?: boolean;
}

export interface IEditorIdentifier {
	groupId: GroupIdentifier;
	editor: EditorInput;
}

export function isEditorIdentifier(identifier: unknown): identifier is IEditorIdentifier {
	const candidate = identifier as IEditorIdentifier | undefined;

	return typeof candidate?.groupId === 'number' && isEditorInput(candidate.editor);
}

export interface IEditorCommandsContext {
	groupId: GroupIdentifier;
	editorIndex?: number;

	preserveFocus?: boolean;
}

export function isEditorCommandsContext(context: unknown): context is IEditorCommandsContext {
	const candidate = context as IEditorCommandsContext | undefined;

	return typeof candidate?.groupId === 'number';
}

export enum EditorCloseContext {

	UNKNOWN,

	REPLACE,

	MOVE,

	UNPIN
}

export interface IEditorCloseEvent extends IEditorIdentifier {

	readonly context: EditorCloseContext;

	readonly index: number;

	readonly sticky: boolean;
}

export interface IActiveEditorChangeEvent {

	editor: EditorInput | undefined;

	isExplicit?: boolean;
}

export interface IEditorWillMoveEvent extends IEditorIdentifier {

	readonly target: GroupIdentifier;
}

export interface IEditorWillOpenEvent extends IEditorIdentifier { }

export interface IWillInstantiateEditorPaneEvent {

	readonly typeId: string;
}

export type GroupIdentifier = number;

export const enum GroupModelChangeKind {

	GROUP_ACTIVE,
	GROUP_INDEX,
	GROUP_LABEL,
	GROUP_LOCKED,

	EDITORS_SELECTION,

	EDITOR_OPEN,
	EDITOR_CLOSE,
	EDITOR_MOVE,
	EDITOR_ACTIVE,
	EDITOR_LABEL,
	EDITOR_CAPABILITIES,
	EDITOR_PIN,
	EDITOR_TRANSIENT,
	EDITOR_STICKY,
	EDITOR_DIRTY,
	EDITOR_WILL_DISPOSE
}

export interface IWorkbenchEditorConfiguration {
	workbench?: {
		editor?: IEditorPartConfiguration;
		iconTheme?: string;
	};
}

interface IEditorPartLimitConfiguration {
	enabled?: boolean;
	excludeDirty?: boolean;
	value?: number;
	perEditorGroup?: boolean;
}

export interface IEditorPartLimitOptions extends Required<IEditorPartLimitConfiguration> { }

interface IEditorPartDecorationsConfiguration {
	badges?: boolean;
	colors?: boolean;
}

export interface IEditorPartDecorationOptions extends Required<IEditorPartDecorationsConfiguration> { }

interface IEditorPartConfiguration {
	showTabs?: 'multiple' | 'single' | 'none';
	wrapTabs?: boolean;
	scrollToSwitchTabs?: boolean;
	highlightModifiedTabs?: boolean;
	tabActionLocation?: 'left' | 'right';
	tabActionCloseVisibility?: boolean;
	tabActionUnpinVisibility?: boolean;
	showTabIndex?: boolean;
	alwaysShowEditorActions?: boolean;
	tabSizing?: 'fit' | 'shrink' | 'fixed';
	tabSizingFixedMinWidth?: number;
	tabSizingFixedMaxWidth?: number;
	pinnedTabSizing?: 'normal' | 'compact' | 'shrink';
	pinnedTabsOnSeparateRow?: boolean;
	tabHeight?: 'default' | 'compact';
	preventPinnedEditorClose?: PreventPinnedEditorClose;
	titleScrollbarSizing?: 'default' | 'large';
	titleScrollbarVisibility?: 'auto' | 'visible' | 'hidden';
	focusRecentEditorAfterClose?: boolean;
	showIcons?: boolean;
	enablePreview?: boolean;
	enablePreviewFromQuickOpen?: boolean;
	enablePreviewFromCodeNavigation?: boolean;
	closeOnFileDelete?: boolean;
	openPositioning?: 'left' | 'right' | 'first' | 'last';
	openSideBySideDirection?: 'right' | 'down';
	closeEmptyGroups?: boolean;
	autoLockGroups?: Set<string>;
	revealIfOpen?: boolean;
	swipeToNavigate?: boolean;
	mouseBackForwardToNavigate?: boolean;
	labelFormat?: 'default' | 'short' | 'medium' | 'long';
	restoreViewState?: boolean;
	splitInGroupLayout?: 'vertical' | 'horizontal';
	splitSizing?: 'auto' | 'split' | 'distribute';
	splitOnDragAndDrop?: boolean;
	allowDropIntoGroup?: boolean;
	dragToOpenWindow?: boolean;
	centeredLayoutFixedWidth?: boolean;
	doubleClickTabToToggleEditorGroupSizes?: 'maximize' | 'expand' | 'off';
	editorActionsLocation?: 'default' | 'titleBar' | 'hidden';
	limit?: IEditorPartLimitConfiguration;
	decorations?: IEditorPartDecorationsConfiguration;
}

export interface IEditorPartOptions extends DeepRequiredNonNullable<IEditorPartConfiguration> {
	hasIcons: boolean;
}

export interface IEditorPartOptionsChangeEvent {
	oldPartOptions: IEditorPartOptions;
	newPartOptions: IEditorPartOptions;
}

export enum SideBySideEditor {
	PRIMARY = 1,
	SECONDARY = 2,
	BOTH = 3,
	ANY = 4
}

export interface IFindEditorOptions {

	supportSideBySide?: SideBySideEditor.PRIMARY | SideBySideEditor.SECONDARY | SideBySideEditor.ANY;

	order?: EditorsOrder;
}

export interface IMatchEditorOptions {

	supportSideBySide?: SideBySideEditor.ANY | SideBySideEditor.BOTH;

	strictEquals?: boolean;
}

export interface IEditorResourceAccessorOptions {

	supportSideBySide?: SideBySideEditor;

	filterByScheme?: string | string[];
}

class EditorResourceAccessorImpl {

	getOriginalUri(editor: EditorInput | IUntypedEditorInput | undefined | null): URI | undefined;
	getOriginalUri(editor: EditorInput | IUntypedEditorInput | undefined | null, options: IEditorResourceAccessorOptions & { supportSideBySide?: SideBySideEditor.PRIMARY | SideBySideEditor.SECONDARY | SideBySideEditor.ANY }): URI | undefined;
	getOriginalUri(editor: EditorInput | IUntypedEditorInput | undefined | null, options: IEditorResourceAccessorOptions & { supportSideBySide: SideBySideEditor.BOTH }): URI | { primary?: URI; secondary?: URI } | undefined;
	getOriginalUri(editor: EditorInput | IUntypedEditorInput | undefined | null, options?: IEditorResourceAccessorOptions): URI | { primary?: URI; secondary?: URI } | undefined;
	getOriginalUri(editor: EditorInput | IUntypedEditorInput | undefined | null, options?: IEditorResourceAccessorOptions): URI | { primary?: URI; secondary?: URI } | undefined {
		if (!editor) {
			return undefined;
		}

		if (isResourceMergeEditorInput(editor)) {
			return EditorResourceAccessor.getOriginalUri(editor.result, options);
		}

		if (options?.supportSideBySide) {
			const { primary, secondary } = this.getSideEditors(editor);
			if (primary && secondary) {
				if (options?.supportSideBySide === SideBySideEditor.BOTH) {
					return {
						primary: this.getOriginalUri(primary, { filterByScheme: options.filterByScheme }),
						secondary: this.getOriginalUri(secondary, { filterByScheme: options.filterByScheme })
					};
				} else if (options?.supportSideBySide === SideBySideEditor.ANY) {
					return this.getOriginalUri(primary, { filterByScheme: options.filterByScheme }) ?? this.getOriginalUri(secondary, { filterByScheme: options.filterByScheme });
				}

				editor = options.supportSideBySide === SideBySideEditor.PRIMARY ? primary : secondary;
			}
		}

		if (isResourceDiffEditorInput(editor) || isResourceMultiDiffEditorInput(editor) || isResourceSideBySideEditorInput(editor) || isResourceMergeEditorInput(editor)) {
			return undefined;
		}

		const originalResource = isEditorInputWithPreferredResource(editor) ? editor.preferredResource : editor.resource;
		if (!originalResource || !options?.filterByScheme) {
			return originalResource;
		}

		return this.filterUri(originalResource, options.filterByScheme);
	}

	private getSideEditors(editor: EditorInput | IUntypedEditorInput): { primary: EditorInput | IUntypedEditorInput | undefined; secondary: EditorInput | IUntypedEditorInput | undefined } {
		if (isSideBySideEditorInput(editor) || isResourceSideBySideEditorInput(editor)) {
			return { primary: editor.primary, secondary: editor.secondary };
		}

		if (isDiffEditorInput(editor) || isResourceDiffEditorInput(editor)) {
			return { primary: editor.modified, secondary: editor.original };
		}

		return { primary: undefined, secondary: undefined };
	}

	getCanonicalUri(editor: EditorInput | IUntypedEditorInput | undefined | null): URI | undefined;
	getCanonicalUri(editor: EditorInput | IUntypedEditorInput | undefined | null, options: IEditorResourceAccessorOptions & { supportSideBySide?: SideBySideEditor.PRIMARY | SideBySideEditor.SECONDARY | SideBySideEditor.ANY }): URI | undefined;
	getCanonicalUri(editor: EditorInput | IUntypedEditorInput | undefined | null, options: IEditorResourceAccessorOptions & { supportSideBySide: SideBySideEditor.BOTH }): URI | { primary?: URI; secondary?: URI } | undefined;
	getCanonicalUri(editor: EditorInput | IUntypedEditorInput | undefined | null, options?: IEditorResourceAccessorOptions): URI | { primary?: URI; secondary?: URI } | undefined;
	getCanonicalUri(editor: EditorInput | IUntypedEditorInput | undefined | null, options?: IEditorResourceAccessorOptions): URI | { primary?: URI; secondary?: URI } | undefined {
		if (!editor) {
			return undefined;
		}

		if (isResourceMergeEditorInput(editor)) {
			return EditorResourceAccessor.getCanonicalUri(editor.result, options);
		}

		if (options?.supportSideBySide) {
			const { primary, secondary } = this.getSideEditors(editor);
			if (primary && secondary) {
				if (options?.supportSideBySide === SideBySideEditor.BOTH) {
					return {
						primary: this.getCanonicalUri(primary, { filterByScheme: options.filterByScheme }),
						secondary: this.getCanonicalUri(secondary, { filterByScheme: options.filterByScheme })
					};
				} else if (options?.supportSideBySide === SideBySideEditor.ANY) {
					return this.getCanonicalUri(primary, { filterByScheme: options.filterByScheme }) ?? this.getCanonicalUri(secondary, { filterByScheme: options.filterByScheme });
				}

				editor = options.supportSideBySide === SideBySideEditor.PRIMARY ? primary : secondary;
			}
		}

		if (isResourceDiffEditorInput(editor) || isResourceMultiDiffEditorInput(editor) || isResourceSideBySideEditorInput(editor) || isResourceMergeEditorInput(editor)) {
			return undefined;
		}

		const canonicalResource = editor.resource;
		if (!canonicalResource || !options?.filterByScheme) {
			return canonicalResource;
		}

		return this.filterUri(canonicalResource, options.filterByScheme);
	}

	private filterUri(resource: URI, filter: string | string[]): URI | undefined {

		if (Array.isArray(filter)) {
			if (filter.some(scheme => resource.scheme === scheme)) {
				return resource;
			}
		}

		else {
			if (filter === resource.scheme) {
				return resource;
			}
		}

		return undefined;
	}
}

export type PreventPinnedEditorClose = 'keyboardAndMouse' | 'keyboard' | 'mouse' | 'never' | undefined;

export enum EditorCloseMethod {
	UNKNOWN,
	KEYBOARD,
	MOUSE
}

export function preventEditorClose(group: IEditorGroup | IReadonlyEditorGroupModel, editor: EditorInput, method: EditorCloseMethod, configuration: IEditorPartConfiguration): boolean {
	if (!group.isSticky(editor)) {
		return false;
	}

	switch (configuration.preventPinnedEditorClose) {
		case 'keyboardAndMouse': return method === EditorCloseMethod.MOUSE || method === EditorCloseMethod.KEYBOARD;
		case 'mouse': return method === EditorCloseMethod.MOUSE;
		case 'keyboard': return method === EditorCloseMethod.KEYBOARD;
	}

	return false;
}

export const EditorResourceAccessor = new EditorResourceAccessorImpl();

export const enum CloseDirection {
	LEFT,
	RIGHT
}

export interface IEditorMemento<T> {

	saveEditorState(group: IEditorGroup, resource: URI, state: T): void;
	saveEditorState(group: IEditorGroup, editor: EditorInput, state: T): void;

	loadEditorState(group: IEditorGroup, resource: URI): T | undefined;
	loadEditorState(group: IEditorGroup, editor: EditorInput): T | undefined;

	clearEditorState(resource: URI, group?: IEditorGroup): void;
	clearEditorState(editor: EditorInput, group?: IEditorGroup): void;

	clearEditorStateOnDispose(resource: URI, editor: EditorInput): void;

	moveEditorState(source: URI, target: URI, comparer: IExtUri): void;
}

class EditorFactoryRegistry implements IEditorFactoryRegistry {
	private instantiationService: IInstantiationService | undefined;

	private fileEditorFactory: IFileEditorFactory | undefined;

	private readonly editorSerializerConstructors = new Map<string , IConstructorSignature<IEditorSerializer>>();
	private readonly editorSerializerInstances = new Map<string , IEditorSerializer>();

	start(accessor: ServicesAccessor): void {
		const instantiationService = this.instantiationService = accessor.get(IInstantiationService);

		for (const [key, ctor] of this.editorSerializerConstructors) {
			this.createEditorSerializer(key, ctor, instantiationService);
		}

		this.editorSerializerConstructors.clear();
	}

	private createEditorSerializer(editorTypeId: string, ctor: IConstructorSignature<IEditorSerializer>, instantiationService: IInstantiationService): void {
		const instance = instantiationService.createInstance(ctor);
		this.editorSerializerInstances.set(editorTypeId, instance);
	}

	registerFileEditorFactory(factory: IFileEditorFactory): void {
		if (this.fileEditorFactory) {
			throw new Error('Can only register one file editor factory.');
		}

		this.fileEditorFactory = factory;
	}

	getFileEditorFactory(): IFileEditorFactory {
		return assertReturnsDefined(this.fileEditorFactory);
	}

	registerEditorSerializer(editorTypeId: string, ctor: IConstructorSignature<IEditorSerializer>): IDisposable {
		if (this.editorSerializerConstructors.has(editorTypeId) || this.editorSerializerInstances.has(editorTypeId)) {
			throw new Error(`A editor serializer with type ID '${editorTypeId}' was already registered.`);
		}

		if (!this.instantiationService) {
			this.editorSerializerConstructors.set(editorTypeId, ctor);
		} else {
			this.createEditorSerializer(editorTypeId, ctor, this.instantiationService);
		}

		return toDisposable(() => {
			this.editorSerializerConstructors.delete(editorTypeId);
			this.editorSerializerInstances.delete(editorTypeId);
		});
	}

	getEditorSerializer(editor: EditorInput): IEditorSerializer | undefined;
	getEditorSerializer(editorTypeId: string): IEditorSerializer | undefined;
	getEditorSerializer(arg1: string | EditorInput): IEditorSerializer | undefined {
		return this.editorSerializerInstances.get(typeof arg1 === 'string' ? arg1 : arg1.typeId);
	}
}

Registry.add(EditorExtensions.EditorFactory, new EditorFactoryRegistry());

export async function pathsToEditors(paths: IPathData[] | undefined, fileService: IFileService, logService: ILogService): Promise<ReadonlyArray<IResourceEditorInput | IUntitledTextResourceEditorInput | undefined>> {
	if (!paths?.length) {
		return [];
	}

	return await Promise.all(paths.map(async path => {
		const resource = URI.revive(path.fileUri);
		if (!resource) {
			logService.info('Cannot resolve the path because it is not valid.', path);
			return undefined;
		}

		const canHandleResource = await fileService.canHandleResource(resource);
		if (!canHandleResource) {
			logService.info('Cannot resolve the path because it cannot be handled', path);
			return undefined;
		}

		let exists = path.exists;
		let type = path.type;
		if (typeof exists !== 'boolean' || typeof type !== 'number') {
			try {
				type = (await fileService.stat(resource)).isDirectory ? FileType.Directory : FileType.Unknown;
				exists = true;
			} catch (error) {
				logService.error(error);
				exists = false;
			}
		}

		if (!exists && path.openOnlyIfExists) {
			logService.info('Cannot resolve the path because it does not exist', path);
			return undefined;
		}

		if (type === FileType.Directory) {
			logService.info('Cannot resolve the path because it is a directory', path);
			return undefined;
		}

		const options: IEditorOptions = {
			...path.options,
			pinned: true
		};

		if (!exists) {
			return { resource, options, forceUntitled: true };
		}

		return { resource, options };
	}));
}

export const enum EditorsOrder {

	MOST_RECENTLY_ACTIVE,

	SEQUENTIAL
}

export function isTextEditorViewState(candidate: unknown): candidate is IEditorViewState {
	const viewState = candidate as IEditorViewState | undefined;
	if (!viewState) {
		return false;
	}

	const diffEditorViewState = viewState as IDiffEditorViewState;
	if (diffEditorViewState.modified) {
		return isTextEditorViewState(diffEditorViewState.modified);
	}

	const codeEditorViewState = viewState as ICodeEditorViewState;

	return !!(codeEditorViewState.contributionsState && codeEditorViewState.viewState && Array.isArray(codeEditorViewState.cursorState));
}

export interface IEditorOpenErrorOptions {

	forceMessage?: boolean;

	forceSeverity?: Severity;

	allowDialog?: boolean;
}

export interface IEditorOpenError extends IErrorWithActions, IEditorOpenErrorOptions { }

export function isEditorOpenError(obj: unknown): obj is IEditorOpenError {
	return isErrorWithActions(obj);
}

export function createEditorOpenError(messageOrError: string | Error, actions: IAction[], options?: IEditorOpenErrorOptions): IEditorOpenError {
	const error: IEditorOpenError = createErrorWithActions(messageOrError, actions);

	error.forceMessage = options?.forceMessage;
	error.forceSeverity = options?.forceSeverity;
	error.allowDialog = options?.allowDialog;

	return error;
}

export interface IToolbarActions {
	readonly primary: IAction[];
	readonly secondary: IAction[];
}
