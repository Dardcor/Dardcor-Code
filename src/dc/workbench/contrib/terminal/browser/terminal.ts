/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDimension } from '../../../../base/browser/dom.js';
import { Orientation } from '../../../../base/browser/ui/splitview/splitview.js';
import { Color } from '../../../../base/common/color.js';
import { Event, IDynamicListEventMultiplexer, type DynamicListEventMultiplexer } from '../../../../base/common/event.js';
import { DisposableStore, IDisposable, type IReference } from '../../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../../base/common/platform.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeyMods } from '../../../../platform/quickinput/common/quickInput.js';
import { IMarkProperties, ITerminalCapabilityImplMap, ITerminalCapabilityStore, ITerminalCommand, TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { IMergedEnvironmentVariableCollection } from '../../../../platform/terminal/common/environmentVariable.js';
import { IExtensionTerminalProfile, IReconnectionProperties, IShellIntegration, IShellLaunchConfig, ITerminalBackend, ITerminalDimensions, ITerminalLaunchError, ITerminalProfile, ITerminalTabLayoutInfoById, TerminalExitReason, TerminalIcon, TerminalLocation, TerminalShellType, TerminalType, TitleEventSource, WaitOnExitValue, type IDecorationAddon, type ShellIntegrationInjectionFailureReason } from '../../../../platform/terminal/common/terminal.js';
import { IColorTheme } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditableData } from '../../../common/views.js';
import { ITerminalStatusList } from './terminalStatusList.js';
import { XtermTerminal } from './xterm/xtermTerminal.js';
import { IRegisterContributedProfileArgs, IRemoteTerminalAttachTarget, IStartExtensionTerminalRequest, ITerminalConfiguration, ITerminalFont, ITerminalProcessExtHostProxy, ITerminalProcessInfo } from '../common/terminal.js';
import type { IMarker, ITheme, Terminal as RawXtermTerminal, IBufferRange, IMarker as IXtermMarker } from '@xterm/xterm';
import { ScrollPosition } from './xterm/markNavigationAddon.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { GroupIdentifier } from '../../../common/editor.js';
import { ACTIVE_GROUP_TYPE, AUX_WINDOW_GROUP_TYPE, SIDE_GROUP_TYPE } from '../../../services/editor/common/editorService.js';
import type { ICurrentPartialCommand } from '../../../../platform/terminal/common/capabilities/commandDetection/terminalCommand.js';
import type { IXtermCore, IBufferSet } from './xterm-private.js';
import type { IMenu } from '../../../../platform/actions/common/actions.js';
import type { IProgressState } from '@xterm/addon-progress';
import type { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import type { TerminalEditorInput } from './terminalEditorInput.js';
import type { MaybePromise } from '../../../../base/common/async.js';
import { isNumber, type SingleOrMany } from '../../../../base/common/types.js';
import type { ToolConfirmationAction } from '../../chat/common/tools/languageModelToolsService.js';

export const ITerminalService = createDecorator<ITerminalService>('terminalService');
export const ITerminalConfigurationService = createDecorator<ITerminalConfigurationService>('terminalConfigurationService');
export const ITerminalEditorService = createDecorator<ITerminalEditorService>('terminalEditorService');
export const ITerminalEditingService = createDecorator<ITerminalEditingService>('terminalEditingService');
export const ITerminalGroupService = createDecorator<ITerminalGroupService>('terminalGroupService');
export const ITerminalInstanceService = createDecorator<ITerminalInstanceService>('terminalInstanceService');
export const ITerminalChatService = createDecorator<ITerminalChatService>('terminalChatService');

export interface ITerminalContribution extends IDisposable {
	layout?(xterm: IXtermTerminal & { raw: RawXtermTerminal }, dimension: IDimension): void;
	xtermOpen?(xterm: IXtermTerminal & { raw: RawXtermTerminal }): void;
	xtermReady?(xterm: IXtermTerminal & { raw: RawXtermTerminal }): void;

	handleMouseEvent?(event: MouseEvent): MaybePromise<{ handled: boolean } | void>;
}

export interface ITerminalInstanceService {
	readonly _serviceBrand: undefined;

	readonly onDidCreateInstance: Event<ITerminalInstance>;

	readonly onDidRegisterBackend: Event<ITerminalBackend>;

	convertProfileToShellLaunchConfig(shellLaunchConfigOrProfile?: IShellLaunchConfig | ITerminalProfile, cwd?: string | URI): IShellLaunchConfig;

	createInstance(launchConfig: IShellLaunchConfig, target: TerminalLocation, editorOptions?: TerminalEditorLocation): ITerminalInstance;

	getBackend(remoteAuthority?: string): Promise<ITerminalBackend | undefined>;

	getRegisteredBackends(): IterableIterator<ITerminalBackend>;
	didRegisterBackend(backend: ITerminalBackend): void;
}

export interface IAhpTerminalCommandSource extends IDisposable {
	readonly commands: readonly ITerminalCommand[];
	readonly executingCommandObject: ITerminalCommand | undefined;
	readonly onCommandExecuted: Event<ITerminalCommand>;
	readonly onCommandFinished: Event<ITerminalCommand>;
	getCommandById(id: string): ITerminalCommand | undefined;
}

export interface IChatTerminalToolProgressPart {
	readonly elementIndex: number;
	readonly contentIndex: number;
	focusTerminal(): Promise<void>;
	toggleOutputFromKeyboard(): Promise<void>;
	toggleOutputFromAction(): Promise<void>;
	continueInBackground(): void;
	focusOutput(): void;
	getCommandAndOutputAsText(): string | undefined;
}

export interface IChatTerminalOutputSource {
	readonly onDidChange: Event<void>;
	readonly output: string;
	readonly hasExited: boolean;
	readonly exitCode: number | undefined;
}

export interface ITerminalChatService {
	readonly _serviceBrand: undefined;

	readonly onDidRegisterTerminalInstanceWithToolSession: Event<ITerminalInstance>;
	readonly onDidRegisterOutputSource: Event<string>;

	registerTerminalInstanceWithToolSession(terminalToolSessionId: string | undefined, instance: ITerminalInstance): void;

	getTerminalInstanceByToolSessionId(terminalToolSessionId: string): Promise<ITerminalInstance | undefined>;

	registerTerminalInstanceWithExecutionId(terminalExecutionId: string, instance: ITerminalInstance): IDisposable;

	getTerminalInstanceByExecutionId(terminalExecutionId: string): ITerminalInstance | undefined;

	getToolSessionTerminalInstances(hiddenOnly?: boolean): readonly ITerminalInstance[];

	getToolSessionIdForInstance(instance: ITerminalInstance): string | undefined;

	registerTerminalInstanceWithChatSession(chatSessionResource: URI, instance: ITerminalInstance): void;

	getChatSessionResourceForInstance(instance: ITerminalInstance): URI | undefined;

	isBackgroundTerminal(terminalToolSessionId?: string): boolean;

	registerOutputSource(terminalToolSessionId: string, source: IChatTerminalOutputSource): IDisposable;
	getOutputSource(terminalToolSessionId: string | undefined): IChatTerminalOutputSource | undefined;

	registerProgressPart(part: IChatTerminalToolProgressPart): IDisposable;

	setFocusedProgressPart(part: IChatTerminalToolProgressPart): void;

	clearFocusedProgressPart(part: IChatTerminalToolProgressPart): void;

	getFocusedProgressPart(): IChatTerminalToolProgressPart | undefined;

	getMostRecentProgressPart(): IChatTerminalToolProgressPart | undefined;

	setChatSessionAutoApproval(chatSessionResource: URI, enabled: boolean): void;

	hasChatSessionAutoApproval(chatSessionResource: URI): boolean;

	addSessionAutoApproveRule(chatSessionResource: URI, key: string, value: boolean | { approve: boolean; matchCommandLine?: boolean }): void;

	getSessionAutoApproveRules(chatSessionResource: URI): Readonly<Record<string, boolean | { approve: boolean; matchCommandLine?: boolean }>>;

	getAutoApproveActions(commandLine: string, language: 'shellscript' | 'powershell'): Promise<ToolConfirmationAction[] | undefined>;

	continueInBackground(terminalToolSessionId: string): void;

	readonly onDidContinueInBackground: Event<string>;

	registerAhpCommandSource(terminalToolSessionId: string, source: IAhpTerminalCommandSource, promisedTerminal: Promise<ITerminalInstance>): IDisposable;

	getAhpCommandSource(terminalToolSessionId: string): IAhpTerminalCommandSource | undefined;
}

export interface ITerminalEditingService {
	readonly _serviceBrand: undefined;

	getEditableData(instance: ITerminalInstance): IEditableData | undefined;

	setEditable(instance: ITerminalInstance, data: IEditableData | null): void;

	isEditable(instance: ITerminalInstance | undefined): boolean;

	getEditingTerminal(): ITerminalInstance | undefined;

	setEditingTerminal(instance: ITerminalInstance | undefined): void;
}

export const enum Direction {
	Left = 0,
	Right = 1,
	Up = 2,
	Down = 3
}

export interface IQuickPickTerminalObject {
	config: IRegisterContributedProfileArgs | ITerminalProfile | { profile: IExtensionTerminalProfile; options: { icon?: string; color?: string } } | undefined;
	keyMods: IKeyMods | undefined;
}

export interface IMarkTracker {
	scrollToPreviousMark(scrollPosition?: ScrollPosition, retainSelection?: boolean, skipEmptyCommands?: boolean): void;
	scrollToNextMark(): void;
	selectToPreviousMark(): void;
	selectToNextMark(): void;
	selectToPreviousLine(): void;
	selectToNextLine(): void;
	clear(): void;
	scrollToClosestMarker(startMarkerId: string, endMarkerId?: string, highlight?: boolean | undefined): void;

	scrollToLine(line: number, position: ScrollPosition): void;
	revealCommand(command: ITerminalCommand | ICurrentPartialCommand | URI, position?: ScrollPosition): void;
	revealRange(range: IBufferRange): void;
	registerTemporaryDecoration(marker: IMarker, endMarker: IMarker | undefined, showOutline: boolean): void;
	showCommandGuide(command: ITerminalCommand | undefined): void;

	saveScrollState(): void;
	restoreScrollState(): void;
}

export interface ITerminalGroup {
	activeInstance: ITerminalInstance | undefined;
	terminalInstances: ITerminalInstance[];
	title: string;
	readonly hadFocusOnExit: boolean;

	readonly onDidDisposeInstance: Event<ITerminalInstance>;
	readonly onDisposed: Event<ITerminalGroup>;
	readonly onInstancesChanged: Event<void>;
	readonly onPanelOrientationChanged: Event<Orientation>;

	focusPreviousPane(): void;
	focusNextPane(): void;
	resizePane(direction: Direction): void;
	resizePanes(relativeSizes: number[]): void;
	setActiveInstanceByIndex(index: number, force?: boolean): void;
	attachToElement(element: HTMLElement): void;
	addInstance(instance: ITerminalInstance): void;
	removeInstance(instance: ITerminalInstance): void;
	moveInstance(instances: SingleOrMany<ITerminalInstance>, index: number, position: 'before' | 'after'): void;
	setVisible(visible: boolean): void;
	layout(width: number, height: number): void;
	addDisposable(disposable: IDisposable): void;
	split(shellLaunchConfig: IShellLaunchConfig): ITerminalInstance;
	getLayoutInfo(isActive: boolean): ITerminalTabLayoutInfoById;
}

export const enum TerminalConnectionState {
	Connecting,
	Connected
}

export interface IDetachedXTermOptions {
	cols: number;
	rows: number;
	colorProvider: IXtermColorProvider;
	capabilities?: ITerminalCapabilityStore & IDisposable;
	readonly?: boolean;
	processInfo: ITerminalProcessInfo;
	disableOverviewRuler?: boolean;
}

export interface IBaseTerminalInstance {
	readonly capabilities: ITerminalCapabilityStore;

	readonly domElement?: HTMLElement;

	readonly selection: string | undefined;

	hasSelection(): boolean;

	clearSelection(): void;

	focus(force?: boolean): void;

	forceScrollbarVisibility(): void;

	resetScrollbarVisibility(): void;

	getContribution<T extends ITerminalContribution>(id: string): T | null;
}

export interface IDetachedTerminalInstance extends IDisposable, IBaseTerminalInstance {
	readonly xterm: IDetachedXtermTerminal;

	onData: Event<string>;

	attachToElement(container: HTMLElement, options?: Partial<IXtermAttachToElementOptions>): void;
}

export const isDetachedTerminalInstance = (t: ITerminalInstance | IDetachedTerminalInstance): t is IDetachedTerminalInstance => !isNumber((t as ITerminalInstance).instanceId);

export interface ITerminalService extends ITerminalInstanceHost {
	readonly _serviceBrand: undefined;

	readonly instances: readonly ITerminalInstance[];

	readonly foregroundInstances: readonly ITerminalInstance[];

	readonly detachedInstances: Iterable<IDetachedTerminalInstance>;

	readonly isProcessSupportRegistered: boolean;
	readonly connectionState: TerminalConnectionState;
	readonly whenConnected: Promise<void>;
	readonly restoredGroupCount: number;

	readonly onDidCreateInstance: Event<ITerminalInstance>;
	readonly onDidChangeInstanceDimensions: Event<ITerminalInstance>;
	readonly onDidRequestStartExtensionTerminal: Event<IStartExtensionTerminalRequest>;
	readonly onDidRegisterProcessSupport: Event<void>;
	readonly onDidChangeConnectionState: Event<void>;

	readonly onDidChangeActiveGroup: Event<ITerminalGroup | undefined>;

	readonly onAnyInstanceData: Event<{ instance: ITerminalInstance; data: string }>;
	readonly onAnyInstanceDataInput: Event<ITerminalInstance>;
	readonly onAnyInstanceIconChange: Event<{ instance: ITerminalInstance; userInitiated: boolean }>;
	readonly onAnyInstanceMaximumDimensionsChange: Event<ITerminalInstance>;
	readonly onAnyInstancePrimaryStatusChange: Event<ITerminalInstance>;
	readonly onAnyInstanceProcessIdReady: Event<ITerminalInstance>;
	readonly onAnyInstanceSelectionChange: Event<ITerminalInstance>;
	readonly onAnyInstanceTitleChange: Event<ITerminalInstance>;
	readonly onAnyInstanceShellTypeChanged: Event<ITerminalInstance>;
	readonly onAnyInstanceAddedCapabilityType: Event<TerminalCapability>;

	createTerminal(options?: ICreateTerminalOptions): Promise<ITerminalInstance>;

	createAndFocusTerminal(options?: ICreateTerminalOptions): Promise<ITerminalInstance>;

	createDetachedTerminal(options: IDetachedXTermOptions): Promise<IDetachedTerminalInstance>;

	getInstanceFromId(terminalId: number): ITerminalInstance | undefined;

	getReconnectedTerminals(reconnectionOwner: string): ITerminalInstance[] | undefined;

	getActiveOrCreateInstance(options?: { acceptsInput?: boolean }): Promise<ITerminalInstance>;
	revealTerminal(source: ITerminalInstance, preserveFocus?: boolean): Promise<void>;
	showBackgroundTerminal(instance: ITerminalInstance, suppressSetActive?: boolean): Promise<void>;
	moveToBackground(instance: ITerminalInstance): void;
	revealActiveTerminal(preserveFocus?: boolean): Promise<void>;
	moveToEditor(source: ITerminalInstance, group?: GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE | AUX_WINDOW_GROUP_TYPE): void;
	moveIntoNewEditor(source: ITerminalInstance): void;
	moveToTerminalView(source: ITerminalInstance | URI): Promise<void>;
	getPrimaryBackend(): ITerminalBackend | undefined;
	setNextCommandId(id: number, commandLine: string, commandId: string): Promise<void>;

	refreshActiveGroup(): void;

	registerProcessSupport(isSupported: boolean): void;

	showProfileQuickPick(type: 'setDefault' | 'createInstance', cwd?: string | URI): Promise<ITerminalInstance | undefined>;

	setContainers(panelContainer: HTMLElement, terminalContainer: HTMLElement): void;

	requestStartExtensionTerminal(proxy: ITerminalProcessExtHostProxy, cols: number, rows: number): Promise<ITerminalLaunchError | undefined>;
	isAttachedToTerminal(remoteTerm: IRemoteTerminalAttachTarget): boolean;
	safeDisposeTerminal(instance: ITerminalInstance): Promise<void>;

	getDefaultInstanceHost(): ITerminalInstanceHost;
	getInstanceHost(target: ITerminalLocationOptions | undefined): Promise<ITerminalInstanceHost>;

	resolveLocation(location?: ITerminalLocationOptions): Promise<TerminalLocation | undefined>;
	setNativeDelegate(nativeCalls: ITerminalServiceNativeDelegate): void;

	createOnInstanceEvent<T>(getEvent: (instance: ITerminalInstance) => Event<T>): DynamicListEventMultiplexer<ITerminalInstance, T>;

	createOnInstanceCapabilityEvent<T extends TerminalCapability, K>(capabilityId: T, getEvent: (capability: ITerminalCapabilityImplMap[T]) => Event<K>): IDynamicListEventMultiplexer<{ instance: ITerminalInstance; data: K }>;

	openResource(resource: URI): void;
}

export interface ITerminalConfigurationService {
	readonly _serviceBrand: undefined;

	readonly config: Readonly<ITerminalConfiguration>;

	readonly defaultLocation: TerminalLocation;

	readonly onConfigChanged: Event<void>;

	setPanelContainer(panelContainer: HTMLElement): void;
	configFontIsMonospace(): boolean;
	getFont(w: Window, xtermCore?: IXtermCore, excludeDimensions?: boolean): ITerminalFont;

	shouldCommandSkipShell(commandId: string): boolean;
}

export class TerminalLinkQuickPickEvent extends MouseEvent {

}
export interface ITerminalServiceNativeDelegate {
	getWindowCount(): Promise<number>;
}

export interface ITerminalEditorService extends ITerminalInstanceHost {
	readonly _serviceBrand: undefined;

	readonly instances: readonly ITerminalInstance[];

	openEditor(instance: ITerminalInstance, editorOptions?: TerminalEditorLocation): Promise<void>;
	detachInstance(instance: ITerminalInstance): void;
	splitInstance(instanceToSplit: ITerminalInstance, shellLaunchConfig?: IShellLaunchConfig): Promise<ITerminalInstance>;
	revealActiveEditor(preserveFocus?: boolean): Promise<void>;
	resolveResource(instance: ITerminalInstance): URI;
	reviveInput(deserializedInput: IDeserializedTerminalEditorInput): EditorInput;
	getInputFromResource(resource: URI): TerminalEditorInput;
}

export const terminalEditorId = 'terminalEditor';

interface ITerminalEditorInputObject {
	readonly id: number;
	readonly pid: number;
	readonly title: string;
	readonly titleSource: TitleEventSource;
	readonly cwd: string;
	readonly icon: TerminalIcon | undefined;
	readonly color: string | undefined;
	readonly hasChildProcesses?: boolean;
	readonly type?: TerminalType;
	readonly isFeatureTerminal?: boolean;
	readonly hideFromUser?: boolean;
	readonly reconnectionProperties?: IReconnectionProperties;
	readonly shellIntegrationNonce: string;
}

export interface ISerializedTerminalEditorInput extends ITerminalEditorInputObject {
}

export interface IDeserializedTerminalEditorInput extends ITerminalEditorInputObject {
}

export type ITerminalLocationOptions = TerminalLocation | TerminalEditorLocation | { parentTerminal: MaybePromise<ITerminalInstance> } | { splitActiveTerminal: boolean };

export interface ICreateTerminalOptions {
	config?: IShellLaunchConfig | ITerminalProfile | IExtensionTerminalProfile;
	cwd?: string | URI;
	resource?: URI;

	location?: ITerminalLocationOptions;

	skipContributedProfileCheck?: boolean;
}

export interface TerminalEditorLocation {
	viewColumn: GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE | AUX_WINDOW_GROUP_TYPE;
	preserveFocus?: boolean;
	auxiliary?: IEditorOptions['auxiliary'];
}

export interface ITerminalGroupService extends ITerminalInstanceHost {
	readonly _serviceBrand: undefined;

	readonly instances: readonly ITerminalInstance[];
	readonly groups: readonly ITerminalGroup[];
	activeGroup: ITerminalGroup | undefined;
	readonly activeGroupIndex: number;
	lastAccessedMenu: 'inline-tab' | 'tab-list';

	readonly onDidChangeActiveGroup: Event<ITerminalGroup | undefined>;
	readonly onDidDisposeGroup: Event<ITerminalGroup>;
	readonly onDidChangeGroups: Event<void>;
	readonly onDidShow: Event<void>;
	readonly onDidChangePanelOrientation: Event<Orientation>;

	createGroup(shellLaunchConfig?: IShellLaunchConfig): ITerminalGroup;
	createGroup(instance?: ITerminalInstance): ITerminalGroup;
	getGroupForInstance(instance: ITerminalInstance): ITerminalGroup | undefined;

	moveGroup(source: SingleOrMany<ITerminalInstance>, target: ITerminalInstance): void;
	moveGroupToEnd(source: SingleOrMany<ITerminalInstance>): void;

	moveInstance(source: ITerminalInstance, target: ITerminalInstance, side: 'before' | 'after'): void;
	unsplitInstance(instance: ITerminalInstance): void;
	joinInstances(instances: ITerminalInstance[]): void;
	instanceIsSplit(instance: ITerminalInstance): boolean;

	getGroupLabels(): string[];
	setActiveGroupByIndex(index: number): void;
	setActiveGroupToNext(): void;
	setActiveGroupToPrevious(): void;

	setActiveInstanceByIndex(terminalIndex: number): void;

	setContainer(container: HTMLElement): void;

	showPanel(focus?: boolean): Promise<void>;
	hidePanel(): void;
	focusTabs(): void;
	focusHover(): void;
	updateVisibility(): void;
}

export interface ITerminalInstanceHost {
	readonly activeInstance: ITerminalInstance | undefined;
	readonly instances: readonly ITerminalInstance[];

	readonly onDidDisposeInstance: Event<ITerminalInstance>;
	readonly onDidFocusInstance: Event<ITerminalInstance>;
	readonly onDidChangeActiveInstance: Event<ITerminalInstance | undefined>;
	readonly onDidChangeInstances: Event<void>;
	readonly onDidChangeInstanceCapability: Event<ITerminalInstance>;

	setActiveInstance(instance: ITerminalInstance): void;
	focusInstance(instance: ITerminalInstance): Promise<void>;
	focusActiveInstance(): Promise<void>;
	getInstanceFromResource(resource: UriComponents | undefined): ITerminalInstance | undefined;
}

export interface ITerminalExternalLinkProvider {
	provideLinks(instance: ITerminalInstance, line: string): Promise<ITerminalLink[] | undefined>;
}

export interface ITerminalLink {
	startIndex: number;
	length: number;
	label?: string;
	activate(text: string): void;
}

export interface ISearchOptions {
	regex?: boolean;
	wholeWord?: boolean;
	caseSensitive?: boolean;
	incremental?: boolean;
}

export interface ITerminalInstance extends IBaseTerminalInstance {
	readonly instanceId: number;
	readonly resource: URI;

	readonly cols: number;
	readonly rows: number;
	readonly maxCols: number;
	readonly maxRows: number;
	readonly fixedCols?: number;
	readonly fixedRows?: number;
	readonly domElement: HTMLElement;
	readonly isVisible: boolean;
	readonly icon?: TerminalIcon;
	readonly color?: string;
	readonly reconnectionProperties?: IReconnectionProperties;
	readonly processName: string;
	readonly sequence?: string;
	readonly staticTitle?: string;
	readonly progressState?: IProgressState;
	readonly workspaceFolder?: IWorkspaceFolder;
	readonly cwd?: string;
	readonly initialCwd?: string;
	readonly os?: OperatingSystem;
	readonly usedShellIntegrationInjection: boolean;
	readonly shellIntegrationInjectionFailureReason: ShellIntegrationInjectionFailureReason | undefined;
	readonly injectedArgs: string[] | undefined;
	readonly extEnvironmentVariableCollection: IMergedEnvironmentVariableCollection | undefined;

	readonly store: DisposableStore;

	readonly statusList: ITerminalStatusList;

	processId: number | undefined;

	target: TerminalLocation | undefined;
	targetRef: IReference<TerminalLocation | undefined>;

	readonly persistentProcessId: number | undefined;

	readonly shouldPersist: boolean;

	readonly isDisposed: boolean;

	readonly hasRemoteAuthority: boolean;

	readonly remoteAuthority: string | undefined;

	readonly hasFocus: boolean;

	readonly sessionId: string;

	waitOnExit: WaitOnExitValue | undefined;

	readonly onTitleChanged: Event<ITerminalInstance>;

	readonly onIconChanged: Event<{ instance: ITerminalInstance; userInitiated: boolean }>;

	readonly onWillDispose: Event<ITerminalInstance>;

	readonly onDisposed: Event<ITerminalInstance>;

	readonly onProcessIdReady: Event<ITerminalInstance>;
	readonly onProcessReplayComplete: Event<void>;
	readonly onRequestExtHostProcess: Event<ITerminalInstance>;
	readonly onDimensionsChanged: Event<void>;
	readonly onMaximumDimensionsChanged: Event<void>;
	readonly onDidChangeHasChildProcesses: Event<boolean>;

	readonly onDidFocus: Event<ITerminalInstance>;
	readonly onDidRequestFocus: Event<void>;
	readonly onDidBlur: Event<ITerminalInstance>;
	readonly onDidInputData: Event<string>;
	readonly onDidChangeSelection: Event<ITerminalInstance>;
	readonly onDidExecuteText: Event<void>;
	readonly onDidChangeTarget: Event<TerminalLocation | undefined>;
	readonly onDidSendText: Event<string>;
	readonly onDidChangeShellType: Event<TerminalShellType>;
	readonly onDidChangeVisibility: Event<boolean>;

	readonly onRequestAddInstanceToGroup: Event<IRequestAddInstanceToGroupEvent>;

	readonly onData: Event<string>;
	readonly onWillData: Event<string>;

	readonly onBinary: Event<string>;

	readonly onLineData: Event<string>;

	readonly onExit: Event<number | ITerminalLaunchError | undefined>;

	readonly exitCode: number | undefined;

	readonly exitReason: TerminalExitReason | undefined;

	readonly xterm?: XtermTerminal;

	readonly xtermReadyPromise: Promise<XtermTerminal | undefined>;

	readonly initialDataEvents: string[] | undefined;

	readonly processReady: Promise<void>;

	readonly hasChildProcesses: boolean;

	readonly title: string;

	readonly titleSource: TitleEventSource;

	readonly shellType: TerminalShellType | undefined;

	readonly hadFocusOnExit: boolean;

	isTitleSetByProcess: boolean;

	readonly shellLaunchConfig: IShellLaunchConfig;

	disableLayout: boolean;

	description: string | undefined;

	userHome: string | undefined;

	shellIntegrationNonce: string;

	registerMarker(offset?: number): IMarker | undefined;

	addBufferMarker(properties: IMarkProperties): void;

	scrollToMark(startMarkId: string, endMarkId?: string, highlight?: boolean): void;

	dispose(reason?: TerminalExitReason): void;

	detachProcessAndDispose(reason: TerminalExitReason): Promise<void>;

	resetFocusContextKey(): void;

	focusWhenReady(force?: boolean): Promise<void>;

	sendText(text: string, shouldExecute: boolean, bracketedPasteMode?: boolean): Promise<void>;

	sendSignal(signal: string): Promise<void>;

	sendPath(originalPath: string | URI, shouldExecute: boolean): Promise<void>;

	runCommand(command: string, shouldExecute?: boolean, commandId?: string, bracketedPasteMode?: boolean, commandLineForMetadata?: string): Promise<void>;

	preparePathForShell(originalPath: string): Promise<string>;

	getUriLabelForShell(uri: URI): Promise<string>;

	scrollDownLine(): void;
	scrollDownPage(): void;
	scrollToBottom(): void;
	scrollUpLine(): void;
	scrollUpPage(): void;
	scrollToTop(): void;

	clearBuffer(): void;

	attachToElement(container: HTMLElement): void;

	detachFromElement(): void;

	layout(dimension: { width: number; height: number }): void;

	setVisible(visible: boolean): void;

	reuseTerminal(shell: IShellLaunchConfig): Promise<void>;

	relaunch(): void;

	setOverrideDimensions(dimensions: ITerminalDimensions): void;

	setFixedDimensions(): Promise<void>;

	toggleSizeToContentWidth(): Promise<void>;

	getInitialCwd(): Promise<string>;

	getSpeculativeCwd(): Promise<string>;

	getCwdResource(): Promise<URI | undefined>;

	rename(title?: string): Promise<void>;

	changeIcon(icon?: TerminalIcon): Promise<TerminalIcon | undefined>;

	changeColor(color?: string, skipQuickPick?: boolean): Promise<string | undefined>;

	freePortKillProcess(port: string, commandToRun: string): Promise<void>;

	setParentContextKeyService(parentContextKeyService: IContextKeyService): void;

	handleMouseEvent(event: MouseEvent, contextMenu: IMenu): Promise<{ cancelContextMenu: boolean } | void>;
}

export const enum XtermTerminalConstants {
	SearchHighlightLimit = 20000
}

export interface IXtermAttachToElementOptions {
	enableGpu: boolean;
}

export interface IXtermTerminal extends IDisposable {
	readonly markTracker: IMarkTracker;

	readonly shellIntegration: IShellIntegration;

	readonly decorationAddon: IDecorationAddon;

	readonly onDidChangeSelection: Event<void>;
	readonly onDidChangeFindResults: Event<{ resultIndex: number; resultCount: number }>;
	readonly onDidRequestRunCommand: Event<{ command: ITerminalCommand; noNewLine?: boolean }>;
	readonly onDidRequestCopyAsHtml: Event<{ command: ITerminalCommand }>;

	readonly onDidChangeFocus: Event<boolean>;

	readonly onAfterSearch: Event<void>;

	readonly onBeforeSearch: Event<void>;

	readonly textureAtlas: Promise<ImageBitmap> | undefined;

	readonly isStdinDisabled: boolean;

	readonly isFocused: boolean;

	readonly isGpuAccelerated: boolean;

	readonly lastInputEvent: string | undefined;

	attachToElement(container: HTMLElement, options?: Partial<IXtermAttachToElementOptions>): void;

	findResult?: { resultIndex: number; resultCount: number };

	findNext(term: string, searchOptions: ISearchOptions): Promise<boolean>;

	findPrevious(term: string, searchOptions: ISearchOptions): Promise<boolean>;

	forceRedraw(): void;

	getFont(): ITerminalFont;

	getRangeAsVT(startMarker?: IXtermMarker, endMarker?: IXtermMarker, skipLastLine?: boolean): Promise<string>;

	hasSelection(): boolean;

	clearSelection(): void;

	selectAll(): void;

	selectMarkedRange(fromMarkerId: string, toMarkerId: string, scrollIntoView?: boolean): void;

	copySelection(copyAsHtml?: boolean, command?: ITerminalCommand): void;
	focus(): void;

	scrollDownLine(): void;
	scrollDownPage(): void;
	scrollToBottom(): void;
	scrollUpLine(): void;
	scrollUpPage(): void;
	scrollToTop(): void;
	scrollToLine(line: number, position?: ScrollPosition): void;

	clearBuffer(): void;

	clearSearchDecorations(): void;

	clearActiveSearchDecoration(): void;

	getBufferReverseIterator(): IterableIterator<string>;

	getContentsAsText(startMarker?: IXtermMarker, endMarker?: IXtermMarker): string;

	getContentsAsHtml(): Promise<string>;

	refresh(): void;

	getXtermTheme(theme?: IColorTheme): ITheme;
}

export interface IDetachedXtermTerminal extends IXtermTerminal {
	write(data: string | Uint8Array, callback?: () => void): void;

	resize(columns: number, rows: number): void;

	reset(): void;

	updateConfig(): void;

	updateTheme(): void;

	updateLogLevel(): void;

	readonly buffer: IBufferSet;

	readonly cols: number;
}

export interface IInternalXtermTerminal {
	_writeText(data: string): void; // eslint-disable-line @typescript-eslint/naming-convention
}

export interface IXtermColorProvider {
	getBackgroundColor(theme: IColorTheme): Color | undefined;
}

export interface IRequestAddInstanceToGroupEvent {
	uri: URI;
	side: 'before' | 'after';
}

export const enum LinuxDistro {
	Unknown = 1,
	Fedora = 2,
	Ubuntu = 3,
}

export const enum TerminalDataTransfers {
	Terminals = 'Terminals'
}
