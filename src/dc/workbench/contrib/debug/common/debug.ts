/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from '../../../../base/common/actions.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Color } from '../../../../base/common/color.js';
import { Event } from '../../../../base/common/event.js';
import { IJSONSchema, IJSONSchemaSnippet } from '../../../../base/common/jsonSchema.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import severity from '../../../../base/common/severity.js';
import { URI, UriComponents, URI as uri } from '../../../../base/common/uri.js';
import { IPosition, Position } from '../../../../editor/common/core/position.js';
import { IRange } from '../../../../editor/common/core/range.js';
import * as editorCommon from '../../../../editor/common/editorCommon.js';
import { ITextModel as EditorIModel } from '../../../../editor/common/model.js';
import * as nls from '../../../../nls.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITelemetryEndpoint } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IEditorPane } from '../../../common/editor.js';
import { DebugCompoundRoot } from './debugCompoundRoot.js';
import { IDataBreakpointOptions, IFunctionBreakpointOptions, IInstructionBreakpointOptions } from './debugModel.js';
import { Source } from './debugSource.js';
import { ITaskIdentifier } from '../../tasks/common/tasks.js';
import { LiveTestResult } from '../../testing/common/testResult.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IView } from '../../../common/views.js';

export const VIEWLET_ID = 'workbench.view.debug';

export const VARIABLES_VIEW_ID = 'workbench.debug.variablesView';
export const WATCH_VIEW_ID = 'workbench.debug.watchExpressionsView';
export const CALLSTACK_VIEW_ID = 'workbench.debug.callStackView';
export const LOADED_SCRIPTS_VIEW_ID = 'workbench.debug.loadedScriptsView';
export const BREAKPOINTS_VIEW_ID = 'workbench.debug.breakPointsView';
export const DISASSEMBLY_VIEW_ID = 'workbench.debug.disassemblyView';
export const DEBUG_PANEL_ID = 'workbench.panel.repl';
export const REPL_VIEW_ID = 'workbench.panel.repl.view';
export const CONTEXT_DEBUG_TYPE = new RawContextKey<string>('debugType', undefined, { type: 'string', description: nls.localize('debugType', "Debug type of the active debug session. For example 'python'.") });
export const CONTEXT_DEBUG_CONFIGURATION_TYPE = new RawContextKey<string>('debugConfigurationType', undefined, { type: 'string', description: nls.localize('debugConfigurationType', "Debug type of the selected launch configuration. For example 'python'.") });
export const CONTEXT_DEBUG_STATE = new RawContextKey<string>('debugState', 'inactive', { type: 'string', description: nls.localize('debugState', "State that the focused debug session is in. One of the following: 'inactive', 'initializing', 'stopped' or 'running'.") });
export const CONTEXT_DEBUG_UX_KEY = 'debugUx';
export const CONTEXT_DEBUG_UX = new RawContextKey<string>(CONTEXT_DEBUG_UX_KEY, 'default', { type: 'string', description: nls.localize('debugUX', "Debug UX state. When there are no debug configurations it is 'simple', otherwise 'default'. Used to decide when to show welcome views in the debug viewlet.") });
export const CONTEXT_HAS_DEBUGGED = new RawContextKey<boolean>('hasDebugged', false, { type: 'boolean', description: nls.localize('hasDebugged', "True when a debug session has been started at least once, false otherwise.") });
export const CONTEXT_IN_DEBUG_MODE = new RawContextKey<boolean>('inDebugMode', false, { type: 'boolean', description: nls.localize('inDebugMode', "True when debugging, false otherwise.") });
export const CONTEXT_IN_DEBUG_REPL = new RawContextKey<boolean>('inDebugRepl', false, { type: 'boolean', description: nls.localize('inDebugRepl', "True when focus is in the debug console, false otherwise.") });
export const CONTEXT_BREAKPOINT_WIDGET_VISIBLE = new RawContextKey<boolean>('breakpointWidgetVisible', false, { type: 'boolean', description: nls.localize('breakpointWidgetVisibile', "True when breakpoint editor zone widget is visible, false otherwise.") });
export const CONTEXT_IN_BREAKPOINT_WIDGET = new RawContextKey<boolean>('inBreakpointWidget', false, { type: 'boolean', description: nls.localize('inBreakpointWidget', "True when focus is in the breakpoint editor zone widget, false otherwise.") });
export const CONTEXT_BREAKPOINTS_FOCUSED = new RawContextKey<boolean>('breakpointsFocused', true, { type: 'boolean', description: nls.localize('breakpointsFocused', "True when the BREAKPOINTS view is focused, false otherwise.") });
export const CONTEXT_WATCH_EXPRESSIONS_FOCUSED = new RawContextKey<boolean>('watchExpressionsFocused', true, { type: 'boolean', description: nls.localize('watchExpressionsFocused', "True when the WATCH view is focused, false otherwise.") });
export const CONTEXT_WATCH_EXPRESSIONS_EXIST = new RawContextKey<boolean>('watchExpressionsExist', false, { type: 'boolean', description: nls.localize('watchExpressionsExist', "True when at least one watch expression exists, false otherwise.") });
export const CONTEXT_VARIABLES_FOCUSED = new RawContextKey<boolean>('variablesFocused', true, { type: 'boolean', description: nls.localize('variablesFocused', "True when the VARIABLES views is focused, false otherwise") });
export const CONTEXT_EXPRESSION_SELECTED = new RawContextKey<boolean>('expressionSelected', false, { type: 'boolean', description: nls.localize('expressionSelected', "True when an expression input box is open in either the WATCH or the VARIABLES view, false otherwise.") });
export const CONTEXT_BREAKPOINT_INPUT_FOCUSED = new RawContextKey<boolean>('breakpointInputFocused', false, { type: 'boolean', description: nls.localize('breakpointInputFocused', "True when the input box has focus in the BREAKPOINTS view.") });
export const CONTEXT_CALLSTACK_ITEM_TYPE = new RawContextKey<string>('callStackItemType', undefined, { type: 'string', description: nls.localize('callStackItemType', "Represents the item type of the focused element in the CALL STACK view. For example: 'session', 'thread', 'stackFrame'") });
export const CONTEXT_CALLSTACK_SESSION_IS_ATTACH = new RawContextKey<boolean>('callStackSessionIsAttach', false, { type: 'boolean', description: nls.localize('callStackSessionIsAttach', "True when the session in the CALL STACK view is attach, false otherwise. Used internally for inline menus in the CALL STACK view.") });
export const CONTEXT_CALLSTACK_ITEM_STOPPED = new RawContextKey<boolean>('callStackItemStopped', false, { type: 'boolean', description: nls.localize('callStackItemStopped', "True when the focused item in the CALL STACK is stopped. Used internally for inline menus in the CALL STACK view.") });
export const CONTEXT_CALLSTACK_SESSION_HAS_ONE_THREAD = new RawContextKey<boolean>('callStackSessionHasOneThread', false, { type: 'boolean', description: nls.localize('callStackSessionHasOneThread', "True when the focused session in the CALL STACK view has exactly one thread. Used internally for inline menus in the CALL STACK view.") });
export const CONTEXT_CALLSTACK_FOCUSED = new RawContextKey<boolean>('callStackFocused', true, { type: 'boolean', description: nls.localize('callStackFocused', "True when the CALLSTACK view is focused, false otherwise.") });
export const CONTEXT_WATCH_ITEM_TYPE = new RawContextKey<string>('watchItemType', undefined, { type: 'string', description: nls.localize('watchItemType', "Represents the item type of the focused element in the WATCH view. For example: 'expression', 'variable'") });
export const CONTEXT_CAN_VIEW_MEMORY = new RawContextKey<boolean>('canViewMemory', undefined, { type: 'boolean', description: nls.localize('canViewMemory', "Indicates whether the item in the view has an associated memory reference.") });
export const CONTEXT_BREAKPOINT_ITEM_TYPE = new RawContextKey<string>('breakpointItemType', undefined, { type: 'string', description: nls.localize('breakpointItemType', "Represents the item type of the focused element in the BREAKPOINTS view. For example: 'breakpoint', 'exceptionBreakpoint', 'functionBreakpoint', 'dataBreakpoint'") });
export const CONTEXT_BREAKPOINT_ITEM_IS_DATA_BYTES = new RawContextKey<boolean>('breakpointItemBytes', undefined, { type: 'boolean', description: nls.localize('breakpointItemIsDataBytes', "Whether the breakpoint item is a data breakpoint on a byte range.") });
export const CONTEXT_BREAKPOINT_HAS_MODES = new RawContextKey<boolean>('breakpointHasModes', false, { type: 'boolean', description: nls.localize('breakpointHasModes', "Whether the breakpoint has multiple modes it can switch to.") });
export const CONTEXT_BREAKPOINT_SUPPORTS_CONDITION = new RawContextKey<boolean>('breakpointSupportsCondition', false, { type: 'boolean', description: nls.localize('breakpointSupportsCondition', "True when the focused breakpoint supports conditions.") });
export const CONTEXT_LOADED_SCRIPTS_SUPPORTED = new RawContextKey<boolean>('loadedScriptsSupported', false, { type: 'boolean', description: nls.localize('loadedScriptsSupported', "True when the focused sessions supports the LOADED SCRIPTS view") });
export const CONTEXT_LOADED_SCRIPTS_ITEM_TYPE = new RawContextKey<string>('loadedScriptsItemType', undefined, { type: 'string', description: nls.localize('loadedScriptsItemType', "Represents the item type of the focused element in the LOADED SCRIPTS view.") });
export const CONTEXT_FOCUSED_SESSION_IS_ATTACH = new RawContextKey<boolean>('focusedSessionIsAttach', false, { type: 'boolean', description: nls.localize('focusedSessionIsAttach', "True when the focused session is 'attach'.") });
export const CONTEXT_FOCUSED_SESSION_IS_NO_DEBUG = new RawContextKey<boolean>('focusedSessionIsNoDebug', false, { type: 'boolean', description: nls.localize('focusedSessionIsNoDebug', "True when the focused session is run without debugging.") });
export const CONTEXT_STEP_BACK_SUPPORTED = new RawContextKey<boolean>('stepBackSupported', false, { type: 'boolean', description: nls.localize('stepBackSupported', "True when the focused session supports 'stepBack' requests.") });
export const CONTEXT_RESTART_FRAME_SUPPORTED = new RawContextKey<boolean>('restartFrameSupported', false, { type: 'boolean', description: nls.localize('restartFrameSupported', "True when the focused session supports 'restartFrame' requests.") });
export const CONTEXT_STACK_FRAME_SUPPORTS_RESTART = new RawContextKey<boolean>('stackFrameSupportsRestart', false, { type: 'boolean', description: nls.localize('stackFrameSupportsRestart', "True when the focused stack frame supports 'restartFrame'.") });
export const CONTEXT_JUMP_TO_CURSOR_SUPPORTED = new RawContextKey<boolean>('jumpToCursorSupported', false, { type: 'boolean', description: nls.localize('jumpToCursorSupported', "True when the focused session supports 'jumpToCursor' request.") });
export const CONTEXT_STEP_INTO_TARGETS_SUPPORTED = new RawContextKey<boolean>('stepIntoTargetsSupported', false, { type: 'boolean', description: nls.localize('stepIntoTargetsSupported', "True when the focused session supports 'stepIntoTargets' request.") });
export const CONTEXT_BREAKPOINTS_EXIST = new RawContextKey<boolean>('breakpointsExist', false, { type: 'boolean', description: nls.localize('breakpointsExist', "True when at least one breakpoint exists.") });
export const CONTEXT_DEBUGGERS_AVAILABLE = new RawContextKey<boolean>('debuggersAvailable', false, { type: 'boolean', description: nls.localize('debuggersAvailable', "True when there is at least one debug extensions active.") });
export const CONTEXT_DEBUG_EXTENSION_AVAILABLE = new RawContextKey<boolean>('debugExtensionAvailable', true, { type: 'boolean', description: nls.localize('debugExtensionsAvailable', "True when there is at least one debug extension installed and enabled.") });
export const CONTEXT_DEBUG_PROTOCOL_VARIABLE_MENU_CONTEXT = new RawContextKey<string>('debugProtocolVariableMenuContext', undefined, { type: 'string', description: nls.localize('debugProtocolVariableMenuContext', "Represents the context the debug adapter sets on the focused variable in the VARIABLES view.") });
export const CONTEXT_SET_VARIABLE_SUPPORTED = new RawContextKey<boolean>('debugSetVariableSupported', false, { type: 'boolean', description: nls.localize('debugSetVariableSupported', "True when the focused session supports 'setVariable' request.") });
export const CONTEXT_SET_DATA_BREAKPOINT_BYTES_SUPPORTED = new RawContextKey<boolean>('debugSetDataBreakpointAddressSupported', false, { type: 'boolean', description: nls.localize('debugSetDataBreakpointAddressSupported', "True when the focused session supports 'getBreakpointInfo' request on an address.") });
export const CONTEXT_SET_EXPRESSION_SUPPORTED = new RawContextKey<boolean>('debugSetExpressionSupported', false, { type: 'boolean', description: nls.localize('debugSetExpressionSupported', "True when the focused session supports 'setExpression' request.") });
export const CONTEXT_BREAK_WHEN_VALUE_CHANGES_SUPPORTED = new RawContextKey<boolean>('breakWhenValueChangesSupported', false, { type: 'boolean', description: nls.localize('breakWhenValueChangesSupported', "True when the focused session supports to break when value changes.") });
export const CONTEXT_BREAK_WHEN_VALUE_IS_ACCESSED_SUPPORTED = new RawContextKey<boolean>('breakWhenValueIsAccessedSupported', false, { type: 'boolean', description: nls.localize('breakWhenValueIsAccessedSupported', "True when the focused breakpoint supports to break when value is accessed.") });
export const CONTEXT_BREAK_WHEN_VALUE_IS_READ_SUPPORTED = new RawContextKey<boolean>('breakWhenValueIsReadSupported', false, { type: 'boolean', description: nls.localize('breakWhenValueIsReadSupported', "True when the focused breakpoint supports to break when value is read.") });
export const CONTEXT_TERMINATE_DEBUGGEE_SUPPORTED = new RawContextKey<boolean>('terminateDebuggeeSupported', false, { type: 'boolean', description: nls.localize('terminateDebuggeeSupported', "True when the focused session supports the terminate debuggee capability.") });
export const CONTEXT_SUSPEND_DEBUGGEE_SUPPORTED = new RawContextKey<boolean>('suspendDebuggeeSupported', false, { type: 'boolean', description: nls.localize('suspendDebuggeeSupported', "True when the focused session supports the suspend debuggee capability.") });
export const CONTEXT_TERMINATE_THREADS_SUPPORTED = new RawContextKey<boolean>('terminateThreadsSupported', false, { type: 'boolean', description: nls.localize('terminateThreadsSupported', "True when the focused session supports the terminate threads capability.") });
export const CONTEXT_VARIABLE_EVALUATE_NAME_PRESENT = new RawContextKey<boolean>('variableEvaluateNamePresent', false, { type: 'boolean', description: nls.localize('variableEvaluateNamePresent', "True when the focused variable has an 'evaluateName' field set.") });
export const CONTEXT_VARIABLE_IS_READONLY = new RawContextKey<boolean>('variableIsReadonly', false, { type: 'boolean', description: nls.localize('variableIsReadonly', "True when the focused variable is read-only.") });
export const CONTEXT_VARIABLE_VALUE = new RawContextKey<boolean>('variableValue', false, { type: 'string', description: nls.localize('variableValue', "Value of the variable, present for debug visualization clauses.") });
export const CONTEXT_VARIABLE_TYPE = new RawContextKey<boolean>('variableType', false, { type: 'string', description: nls.localize('variableType', "Type of the variable, present for debug visualization clauses.") });
export const CONTEXT_VARIABLE_INTERFACES = new RawContextKey<boolean>('variableInterfaces', false, { type: 'array', description: nls.localize('variableInterfaces', "Any interfaces or contracts that the variable satisfies, present for debug visualization clauses.") });
export const CONTEXT_VARIABLE_NAME = new RawContextKey<boolean>('variableName', false, { type: 'string', description: nls.localize('variableName', "Name of the variable, present for debug visualization clauses.") });
export const CONTEXT_VARIABLE_LANGUAGE = new RawContextKey<boolean>('variableLanguage', false, { type: 'string', description: nls.localize('variableLanguage', "Language of the variable source, present for debug visualization clauses.") });
export const CONTEXT_VARIABLE_EXTENSIONID = new RawContextKey<boolean>('variableExtensionId', false, { type: 'string', description: nls.localize('variableExtensionId', "Extension ID of the variable source, present for debug visualization clauses.") });
export const CONTEXT_EXCEPTION_WIDGET_VISIBLE = new RawContextKey<boolean>('exceptionWidgetVisible', false, { type: 'boolean', description: nls.localize('exceptionWidgetVisible', "True when the exception widget is visible.") });
export const CONTEXT_MULTI_SESSION_REPL = new RawContextKey<boolean>('multiSessionRepl', false, { type: 'boolean', description: nls.localize('multiSessionRepl', "True when there is more than 1 debug console.") });
export const CONTEXT_MULTI_SESSION_DEBUG = new RawContextKey<boolean>('multiSessionDebug', false, { type: 'boolean', description: nls.localize('multiSessionDebug', "True when there is more than 1 active debug session.") });
export const CONTEXT_DISASSEMBLE_REQUEST_SUPPORTED = new RawContextKey<boolean>('disassembleRequestSupported', false, { type: 'boolean', description: nls.localize('disassembleRequestSupported', "True when the focused sessions supports disassemble request.") });
export const CONTEXT_DISASSEMBLY_VIEW_FOCUS = new RawContextKey<boolean>('disassemblyViewFocus', false, { type: 'boolean', description: nls.localize('disassemblyViewFocus', "True when the Disassembly View is focused.") });
export const CONTEXT_LANGUAGE_SUPPORTS_DISASSEMBLE_REQUEST = new RawContextKey<boolean>('languageSupportsDisassembleRequest', false, { type: 'boolean', description: nls.localize('languageSupportsDisassembleRequest', "True when the language in the current editor supports disassemble request.") });
export const CONTEXT_FOCUSED_STACK_FRAME_HAS_INSTRUCTION_POINTER_REFERENCE = new RawContextKey<boolean>('focusedStackFrameHasInstructionReference', false, { type: 'boolean', description: nls.localize('focusedStackFrameHasInstructionReference', "True when the focused stack frame has instruction pointer reference.") });

export const debuggerDisabledMessage = (debugType: string) => nls.localize('debuggerDisabled', "Configured debug type '{0}' is installed but not supported in this environment.", debugType);

export const EDITOR_CONTRIBUTION_ID = 'editor.contrib.debug';
export const BREAKPOINT_EDITOR_CONTRIBUTION_ID = 'editor.contrib.breakpoint';
export const DEBUG_SCHEME = 'debug';
export const INTERNAL_CONSOLE_OPTIONS_SCHEMA = {
	enum: ['neverOpen', 'openOnSessionStart', 'openOnFirstSessionStart'],
	default: 'openOnFirstSessionStart',
	description: nls.localize('internalConsoleOptions', "Controls when the internal Debug Console should open.")
};

export interface IDebugViewWithVariables extends IView {
	readonly treeSelection: IExpression[];
}


export interface IRawModelUpdate {
	sessionId: string;
	threads: DebugProtocol.Thread[];
	stoppedDetails?: IRawStoppedDetails;
}

export interface IRawStoppedDetails {
	reason?: string;
	description?: string;
	threadId?: number;
	text?: string;
	totalFrames?: number;
	allThreadsStopped?: boolean;
	preserveFocusHint?: boolean;
	framesErrorMessage?: string;
	hitBreakpointIds?: number[];
}


export interface ITreeElement {
	getId(): string;
}

export interface IReplElement extends ITreeElement {
	toString(includeSource?: boolean): string;
	readonly sourceData?: IReplElementSource;
}

export interface INestingReplElement extends IReplElement {
	readonly hasChildren: boolean;
	getChildren(): Promise<IReplElement[]> | IReplElement[];
}

export interface IReplElementSource {
	readonly source: Source;
	readonly lineNumber: number;
	readonly column: number;
}

export interface IExpressionValue {
	readonly value: string;
	readonly type?: string;
	valueChanged?: boolean;
}

export interface IExpressionContainer extends ITreeElement, IExpressionValue {
	readonly hasChildren: boolean;
	getSession(): IDebugSession | undefined;
	evaluateLazy(): Promise<void>;
	getChildren(): Promise<IExpression[]>;
	readonly reference?: number;
	readonly memoryReference?: string;
	readonly presentationHint?: DebugProtocol.VariablePresentationHint | undefined;
	readonly valueLocationReference?: number;
}

export interface IExpression extends IExpressionContainer {
	name: string;
}

export interface IDebugger {
	readonly type: string;
	createDebugAdapter(session: IDebugSession): Promise<IDebugAdapter>;
	runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined>;
	startDebugging(args: IConfig, parentSessionId: string): Promise<boolean>;
	getCustomTelemetryEndpoint(): ITelemetryEndpoint | undefined;
	getInitialConfigurationContent(initialConfigs?: IConfig[]): Promise<string>;
}

export interface IDebuggerMetadata {
	label: string;
	type: string;
	strings?: { [key in DebuggerString]: string };
	interestedInLanguage(languageId: string): boolean;
}

export const enum State {
	Inactive,
	Initializing,
	Stopped,
	Running
}

export function getStateLabel(state: State): string {
	switch (state) {
		case State.Initializing: return 'initializing';
		case State.Stopped: return 'stopped';
		case State.Running: return 'running';
		default: return 'inactive';
	}
}

export interface AdapterEndEvent {
	error?: Error;
	sessionLengthInSeconds: number;
	emittedStopped: boolean;
}

export interface LoadedSourceEvent {
	reason: 'new' | 'changed' | 'removed';
	source: Source;
}

export type IDebugSessionReplMode = 'separate' | 'mergeWithParent';

export interface IDebugTestRunReference {
	runId: string;
	taskId: string;
}

export interface IDebugSessionOptions {
	noDebug?: boolean;
	parentSession?: IDebugSession;
	lifecycleManagedByParent?: boolean;
	repl?: IDebugSessionReplMode;
	compoundRoot?: DebugCompoundRoot;
	compact?: boolean;
	startedByUser?: boolean;
	saveBeforeRestart?: boolean;
	suppressDebugToolbar?: boolean;
	suppressDebugStatusbar?: boolean;
	suppressDebugView?: boolean;
	testRun?: IDebugTestRunReference;
}

export interface IDataBreakpointInfoResponse {
	dataId: string | null;
	description: string;
	canPersist?: boolean;
	accessTypes?: DebugProtocol.DataBreakpointAccessType[];
}

export interface IMemoryInvalidationEvent {
	fromOffset: number;
	toOffset: number;
}

export const enum MemoryRangeType {
	Valid,
	Unreadable,
	Error,
}

export interface IMemoryRange {
	type: MemoryRangeType;
	offset: number;
	length: number;
}

export interface IValidMemoryRange extends IMemoryRange {
	type: MemoryRangeType.Valid;
	offset: number;
	length: number;
	data: VSBuffer;
}

export interface IUnreadableMemoryRange extends IMemoryRange {
	type: MemoryRangeType.Unreadable;
}

export interface IErrorMemoryRange extends IMemoryRange {
	type: MemoryRangeType.Error;
	error: string;
}

export type MemoryRange = IValidMemoryRange | IUnreadableMemoryRange | IErrorMemoryRange;

export const DEBUG_MEMORY_SCHEME = 'vscode-debug-memory';

export interface IMemoryRegion extends IDisposable {
	readonly onDidInvalidate: Event<IMemoryInvalidationEvent>;

	readonly writable: boolean;

	read(fromOffset: number, toOffset: number): Promise<MemoryRange[]>;

	write(offset: number, data: VSBuffer): Promise<number>;
}

export interface INewReplElementData {
	output: string;

	expression?: IExpression;

	sev: severity;

	source?: IReplElementSource;
}

export interface IDebugEvaluatePosition {
	line: number;
	column: number;
	source: DebugProtocol.Source;
}

export interface IDebugLocationReferenced {
	line: number;
	column: number;
	endLine?: number;
	endColumn?: number;
	source: Source;
}

export interface IDebugSession extends ITreeElement, IDisposable {

	readonly configuration: IConfig;
	readonly unresolvedConfiguration: IConfig | undefined;
	readonly state: State;
	readonly root: IWorkspaceFolder | undefined;
	readonly parentSession: IDebugSession | undefined;
	readonly subId: string | undefined;
	readonly compact: boolean;
	readonly compoundRoot: DebugCompoundRoot | undefined;
	readonly saveBeforeRestart: boolean;
	readonly name: string;
	readonly autoExpandLazyVariables: boolean;
	readonly suppressDebugToolbar: boolean;
	readonly suppressDebugStatusbar: boolean;
	readonly suppressDebugView: boolean;
	readonly lifecycleManagedByParent: boolean;
	readonly correlatedTestRun?: LiveTestResult;

	setSubId(subId: string | undefined): void;

	getMemory(memoryReference: string): IMemoryRegion;

	setName(name: string): void;
	readonly onDidChangeName: Event<string>;
	getLabel(): string;

	getSourceForUri(modelUri: uri): Source | undefined;
	getSource(raw?: DebugProtocol.Source): Source;

	setConfiguration(configuration: { resolved: IConfig; unresolved: IConfig | undefined }): void;
	rawUpdate(data: IRawModelUpdate): void;

	getThread(threadId: number): IThread | undefined;
	getAllThreads(): IThread[];
	clearThreads(removeThreads: boolean, reference?: number): void;
	getStoppedDetails(): IRawStoppedDetails | undefined;

	getReplElements(): IReplElement[];
	hasSeparateRepl(): boolean;
	removeReplExpressions(): void;
	addReplExpression(stackFrame: IStackFrame | undefined, name: string): Promise<void>;
	appendToRepl(data: INewReplElementData): void;
	cancelCorrelatedTestRun(): void;

	readonly onDidEndAdapter: Event<AdapterEndEvent | undefined>;
	readonly onDidChangeState: Event<void>;
	readonly onDidChangeReplElements: Event<IReplElement | undefined>;

	readonly capabilities: DebugProtocol.Capabilities;
	readonly rememberedCapabilities?: DebugProtocol.Capabilities;


	readonly onDidLoadedSource: Event<LoadedSourceEvent>;
	readonly onDidCustomEvent: Event<DebugProtocol.Event>;
	readonly onDidProgressStart: Event<DebugProtocol.ProgressStartEvent>;
	readonly onDidProgressUpdate: Event<DebugProtocol.ProgressUpdateEvent>;
	readonly onDidProgressEnd: Event<DebugProtocol.ProgressEndEvent>;
	readonly onDidInvalidateMemory: Event<DebugProtocol.MemoryEvent>;


	initialize(dbgr: IDebugger): Promise<void>;
	launchOrAttach(config: IConfig): Promise<void>;
	restart(): Promise<void>;
	terminate(restart?: boolean ): Promise<void>;
	disconnect(restart?: boolean , suspend?: boolean): Promise<void>;

	sendBreakpoints(modelUri: uri, bpts: IBreakpoint[], sourceModified: boolean): Promise<void>;
	sendFunctionBreakpoints(fbps: IFunctionBreakpoint[]): Promise<void>;
	dataBreakpointInfo(name: string, variablesReference?: number, frameId?: number): Promise<IDataBreakpointInfoResponse | undefined>;
	dataBytesBreakpointInfo(address: string, bytes: number): Promise<IDataBreakpointInfoResponse | undefined>;
	sendDataBreakpoints(dbps: IDataBreakpoint[]): Promise<void>;
	sendInstructionBreakpoints(dbps: IInstructionBreakpoint[]): Promise<void>;
	sendExceptionBreakpoints(exbpts: IExceptionBreakpoint[]): Promise<void>;
	breakpointsLocations(uri: uri, lineNumber: number): Promise<IPosition[]>;
	getDebugProtocolBreakpoint(breakpointId: string): DebugProtocol.Breakpoint | undefined;
	resolveLocationReference(locationReference: number): Promise<IDebugLocationReferenced>;

	stackTrace(threadId: number, startFrame: number, levels: number, token: CancellationToken): Promise<DebugProtocol.StackTraceResponse | undefined>;
	exceptionInfo(threadId: number): Promise<IExceptionInfo | undefined>;
	scopes(frameId: number, threadId: number): Promise<DebugProtocol.ScopesResponse | undefined>;
	variables(variablesReference: number, threadId: number | undefined, filter: 'indexed' | 'named' | undefined, start: number | undefined, count: number | undefined): Promise<DebugProtocol.VariablesResponse | undefined>;
	evaluate(expression: string, frameId?: number, context?: string, location?: IDebugEvaluatePosition): Promise<DebugProtocol.EvaluateResponse | undefined>;
	customRequest(request: string, args: unknown): Promise<DebugProtocol.Response | undefined>;
	cancel(progressId: string): Promise<DebugProtocol.CancelResponse | undefined>;
	disassemble(memoryReference: string, offset: number, instructionOffset: number, instructionCount: number): Promise<DebugProtocol.DisassembledInstruction[] | undefined>;
	readMemory(memoryReference: string, offset: number, count: number): Promise<DebugProtocol.ReadMemoryResponse | undefined>;
	writeMemory(memoryReference: string, offset: number, data: string, allowPartial?: boolean): Promise<DebugProtocol.WriteMemoryResponse | undefined>;

	restartFrame(frameId: number, threadId: number): Promise<void>;
	next(threadId: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
	stepIn(threadId: number, targetId?: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
	stepInTargets(frameId: number): Promise<DebugProtocol.StepInTarget[] | undefined>;
	stepOut(threadId: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
	stepBack(threadId: number, granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
	continue(threadId: number): Promise<void>;
	reverseContinue(threadId: number): Promise<void>;
	pause(threadId: number): Promise<void>;
	terminateThreads(threadIds: number[]): Promise<void>;

	completions(frameId: number | undefined, threadId: number, text: string, position: Position, token: CancellationToken): Promise<DebugProtocol.CompletionsResponse | undefined>;
	setVariable(variablesReference: number | undefined, name: string, value: string): Promise<DebugProtocol.SetVariableResponse | undefined>;
	setExpression(frameId: number, expression: string, value: string): Promise<DebugProtocol.SetExpressionResponse | undefined>;
	loadSource(resource: uri): Promise<DebugProtocol.SourceResponse | undefined>;
	getLoadedSources(): Promise<Source[]>;

	gotoTargets(source: DebugProtocol.Source, line: number, column?: number): Promise<DebugProtocol.GotoTargetsResponse | undefined>;
	goto(threadId: number, targetId: number): Promise<DebugProtocol.GotoResponse | undefined>;
}

export interface IThread extends ITreeElement {

	readonly session: IDebugSession;

	readonly threadId: number;

	readonly name: string;

	readonly stoppedDetails: IRawStoppedDetails | undefined;

	readonly exceptionInfo: Promise<IExceptionInfo | undefined>;

	readonly stateLabel: string;

	getCallStack(): ReadonlyArray<IStackFrame>;


	getTopStackFrame(): IStackFrame | undefined;

	clearCallStack(): void;

	readonly stopped: boolean;

	next(granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
	stepIn(granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
	stepOut(granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
	stepBack(granularity?: DebugProtocol.SteppingGranularity): Promise<void>;
	continue(): Promise<void>;
	pause(): Promise<void>;
	terminate(): Promise<void>;
	reverseContinue(): Promise<void>;
}

export interface IScope extends IExpressionContainer {
	readonly name: string;
	readonly expensive: boolean;
	readonly range?: IRange;
	readonly hasChildren: boolean;
	readonly childrenHaveBeenLoaded: boolean;
}

export interface IStackFrame extends ITreeElement {
	readonly thread: IThread;
	readonly name: string;
	readonly presentationHint: string | undefined;
	readonly frameId: number;
	readonly range: IRange;
	readonly source: Source;
	readonly canRestart: boolean;
	readonly instructionPointerReference?: string;
	getScopes(): Promise<IScope[]>;
	getMostSpecificScopes(range: IRange): Promise<ReadonlyArray<IScope>>;
	forgetScopes(): void;
	restart(): Promise<void>;
	toString(): string;
	openInEditor(editorService: IEditorService, preserveFocus?: boolean, sideBySide?: boolean, pinned?: boolean): Promise<IEditorPane | undefined>;
	equals(other: IStackFrame): boolean;
}

export function isFrameDeemphasized(frame: IStackFrame): boolean {
	const hint = frame.presentationHint ?? frame.source.presentationHint;
	return hint === 'deemphasize' || hint === 'subtle';
}

export interface IEnablement extends ITreeElement {
	readonly enabled: boolean;
}

export interface IBreakpointData {
	readonly id?: string;
	readonly lineNumber: number;
	readonly column?: number;
	readonly enabled?: boolean;
	readonly condition?: string;
	readonly logMessage?: string;
	readonly hitCondition?: string;
	readonly triggeredBy?: string;
	readonly mode?: string;
	readonly modeLabel?: string;
}

export interface IBreakpointUpdateData {
	readonly condition?: string;
	readonly hitCondition?: string;
	readonly logMessage?: string;
	readonly lineNumber?: number;
	readonly column?: number;
	readonly triggeredBy?: string;
	readonly mode?: string;
	readonly modeLabel?: string;
}

export interface IBaseBreakpoint extends IEnablement {
	readonly condition?: string;
	readonly hitCondition?: string;
	readonly logMessage?: string;
	readonly verified: boolean;
	readonly supported: boolean;
	readonly message?: string;
	readonly mode?: string;
	readonly modeLabel?: string;
	readonly sessionsThatVerified: string[];
	getIdFromAdapter(sessionId: string): number | undefined;
}

export interface IBreakpoint extends IBaseBreakpoint {
	readonly originalUri: uri;
	readonly uri: uri;
	readonly lineNumber: number;
	readonly endLineNumber?: number;
	readonly column?: number;
	readonly endColumn?: number;
	readonly adapterData: unknown;
	readonly sessionAgnosticData: { lineNumber: number; column: number | undefined };
	readonly triggeredBy?: string;
	readonly pending: boolean;

	setSessionDidTrigger(sessionId: string, didTrigger?: boolean): void;
	getSessionDidTrigger(sessionId: string): boolean;

	toDAP(): DebugProtocol.SourceBreakpoint;
}

export interface IFunctionBreakpoint extends IBaseBreakpoint {
	readonly name: string;
	toDAP(): DebugProtocol.FunctionBreakpoint;
}

export interface IExceptionBreakpoint extends IBaseBreakpoint {
	readonly filter: string;
	readonly label: string;
	readonly description: string | undefined;
}

export const enum DataBreakpointSetType {
	Variable,
	Address,
}

export type DataBreakpointSource =
	| { type: DataBreakpointSetType.Variable; dataId: string }
	| { type: DataBreakpointSetType.Address; address: string; bytes: number };

export interface IDataBreakpoint extends IBaseBreakpoint {
	readonly description: string;
	readonly canPersist: boolean;
	readonly src: DataBreakpointSource;
	readonly accessType: DebugProtocol.DataBreakpointAccessType;
	toDAP(session: IDebugSession): Promise<DebugProtocol.DataBreakpoint | undefined>;
}

export interface IInstructionBreakpoint extends IBaseBreakpoint {
	readonly instructionReference: string;
	readonly offset?: number;
	readonly address: bigint;
	toDAP(): DebugProtocol.InstructionBreakpoint;
}

export interface IExceptionInfo {
	readonly id?: string;
	readonly description?: string;
	readonly breakMode: string | null;
	readonly details?: DebugProtocol.ExceptionDetails;
}


export interface IViewModel extends ITreeElement {
	readonly focusedSession: IDebugSession | undefined;

	readonly focusedThread: IThread | undefined;

	readonly focusedStackFrame: IStackFrame | undefined;

	setVisualizedExpression(original: IExpression, visualized: IExpression & { treeId: string } | undefined): void;
	getVisualizedExpression(expression: IExpression): IExpression | string | undefined;
	getSelectedExpression(): { expression: IExpression; settingWatch: boolean } | undefined;
	setSelectedExpression(expression: IExpression | undefined, settingWatch: boolean): void;
	updateViews(): void;

	isMultiSessionView(): boolean;

	readonly onDidFocusSession: Event<IDebugSession | undefined>;
	readonly onDidFocusThread: Event<{ thread: IThread | undefined; explicit: boolean; session: IDebugSession | undefined }>;
	readonly onDidFocusStackFrame: Event<{ stackFrame: IStackFrame | undefined; explicit: boolean; session: IDebugSession | undefined }>;
	readonly onDidSelectExpression: Event<{ expression: IExpression; settingWatch: boolean } | undefined>;
	readonly onDidEvaluateLazyExpression: Event<IExpressionContainer>;
	readonly onDidChangeVisualization: Event<{ original: IExpression; replacement: IExpression }>;
	readonly onWillUpdateViews: Event<void>;

	evaluateLazyExpression(expression: IExpressionContainer): void;
}

export interface IEvaluate {
	evaluate(session: IDebugSession, stackFrame: IStackFrame, context: string): Promise<void>;
}

export interface IDebugModel extends ITreeElement {
	getSession(sessionId: string | undefined, includeInactive?: boolean): IDebugSession | undefined;
	getSessions(includeInactive?: boolean): IDebugSession[];
	getBreakpoints(filter?: { uri?: uri; originalUri?: uri; lineNumber?: number; column?: number; enabledOnly?: boolean; triggeredOnly?: boolean }): ReadonlyArray<IBreakpoint>;
	areBreakpointsActivated(): boolean;
	getFunctionBreakpoints(): ReadonlyArray<IFunctionBreakpoint>;
	getDataBreakpoints(): ReadonlyArray<IDataBreakpoint>;

	getExceptionBreakpoints(): ReadonlyArray<IExceptionBreakpoint>;

	getExceptionBreakpointsForSession(sessionId?: string): ReadonlyArray<IExceptionBreakpoint>;

	getInstructionBreakpoints(): ReadonlyArray<IInstructionBreakpoint>;
	getWatchExpressions(): ReadonlyArray<IExpression & IEvaluate>;
	registerBreakpointModes(debugType: string, modes: DebugProtocol.BreakpointMode[]): void;
	getBreakpointModes(forBreakpointType: 'source' | 'exception' | 'data' | 'instruction'): DebugProtocol.BreakpointMode[];
	readonly onDidChangeBreakpoints: Event<IBreakpointsChangeEvent | undefined>;
	readonly onDidChangeCallStack: Event<void>;
	readonly onDidChangeWatchExpressions: Event<IExpression | undefined>;
	readonly onDidChangeWatchExpressionValue: Event<IExpression | undefined>;

	fetchCallstack(thread: IThread, levels?: number): Promise<void>;
}

export interface IBreakpointsChangeEvent {
	added?: Array<IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IInstructionBreakpoint>;
	removed?: Array<IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IInstructionBreakpoint>;
	changed?: Array<IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IInstructionBreakpoint>;
	sessionOnly: boolean;
}


export interface IDebugConfiguration {
	allowBreakpointsEverywhere: boolean;
	gutterMiddleClickAction: 'logpoint' | 'conditionalBreakpoint' | 'triggeredBreakpoint' | 'none';
	openDebug: 'neverOpen' | 'openOnSessionStart' | 'openOnFirstSessionStart' | 'openOnDebugBreak';
	openExplorerOnEnd: boolean;
	inlineValues: boolean | 'auto' | 'on' | 'off';
	toolBarLocation: 'floating' | 'docked' | 'commandCenter' | 'hidden';
	showInStatusBar: 'never' | 'always' | 'onFirstSessionStart';
	internalConsoleOptions: 'neverOpen' | 'openOnSessionStart' | 'openOnFirstSessionStart';
	extensionHostDebugAdapter: boolean;
	enableAllHovers: boolean;
	showSubSessionsInToolBar: boolean;
	closeReadonlyTabsOnEnd: boolean;
	console: {
		fontSize: number;
		fontFamily: string;
		lineHeight: number;
		wordWrap: boolean;
		closeOnEnd: boolean;
		collapseIdenticalLines: boolean;
		historySuggestions: boolean;
		acceptSuggestionOnEnter: 'off' | 'on';
		maximumLines: number;
	};
	focusWindowOnBreak: boolean;
	focusEditorOnBreak: boolean;
	onTaskErrors: 'debugAnyway' | 'showErrors' | 'prompt' | 'abort';
	showBreakpointsInOverviewRuler: boolean;
	showInlineBreakpointCandidates: boolean;
	confirmOnExit: 'always' | 'never';
	disassemblyView: {
		showSourceCode: boolean;
	};
	autoExpandLazyVariables: 'auto' | 'off' | 'on';
	enableStatusBarColor: boolean;
	showVariableTypes: boolean;
	hideSlowPreLaunchWarning: boolean;
}

export interface IGlobalConfig {
	version: string;
	compounds: ICompound[];
	configurations: IConfig[];
}

export interface IConfigPresentation {
	hidden?: boolean;
	group?: string;
	order?: number;
}

interface IEnvConfig {
	internalConsoleOptions?: 'neverOpen' | 'openOnSessionStart' | 'openOnFirstSessionStart';
	preRestartTask?: string | ITaskIdentifier;
	postRestartTask?: string | ITaskIdentifier;
	preLaunchTask?: string | ITaskIdentifier;
	postDebugTask?: string | ITaskIdentifier;
	debugServer?: number;
	noDebug?: boolean;
	suppressMultipleSessionWarning?: boolean;
	presentation?: IConfigPresentation;
}

export interface IConfig extends IEnvConfig {

	type: string;
	request: string;
	name: string;
	presentation?: IConfigPresentation;
	windows?: IEnvConfig;
	osx?: IEnvConfig;
	linux?: IEnvConfig;

	__configurationTarget?: ConfigurationTarget;
	__sessionId?: string;
	__restart?: unknown;
	__autoAttach?: boolean;
	port?: number;
}

export interface ICompound {
	name: string;
	stopAll?: boolean;
	preLaunchTask?: string | ITaskIdentifier;
	configurations: (string | { name: string; folder: string })[];
	presentation?: IConfigPresentation;
}

export function isDebugConfig(thing: IConfig | ICompound): thing is IConfig {
	return 'type' in thing && 'request' in thing;
}

export interface IDebugAdapter extends IDisposable {
	readonly onError: Event<Error>;
	readonly onExit: Event<number | null>;
	onRequest(callback: (request: DebugProtocol.Request) => void): void;
	onEvent(callback: (event: DebugProtocol.Event) => void): void;
	startSession(): Promise<void>;
	sendMessage(message: DebugProtocol.ProtocolMessage): void;
	sendResponse(response: DebugProtocol.Response): void;
	sendRequest(command: string, args: unknown, clb: (result: DebugProtocol.Response) => void, timeout?: number): number;
	stopSession(): Promise<void>;
}

export interface IDebugAdapterFactory extends ITerminalLauncher {
	createDebugAdapter(session: IDebugSession): IDebugAdapter;
	substituteVariables(folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig>;
}

export interface IDebugAdapterExecutableOptions {
	cwd?: string;
	env?: { [key: string]: string };
}

export interface IDebugAdapterExecutable {
	readonly type: 'executable';
	readonly command: string;
	readonly args: string[];
	readonly options?: IDebugAdapterExecutableOptions;
}

export interface IDebugAdapterServer {
	readonly type: 'server';
	readonly port: number;
	readonly host?: string;
}

export interface IDebugAdapterNamedPipeServer {
	readonly type: 'pipeServer';
	readonly path: string;
}

export interface IDebugAdapterInlineImpl extends IDisposable {
	readonly onDidSendMessage: Event<DebugProtocol.Message>;
	handleMessage(message: DebugProtocol.Message): void;
}

export interface IDebugAdapterImpl {
	readonly type: 'implementation';
}

export type IAdapterDescriptor = IDebugAdapterExecutable | IDebugAdapterServer | IDebugAdapterNamedPipeServer | IDebugAdapterImpl;

export interface IPlatformSpecificAdapterContribution {
	program?: string;
	args?: string[];
	runtime?: string;
	runtimeArgs?: string[];
}

export interface IDebuggerContribution extends IPlatformSpecificAdapterContribution {
	type: string;
	label?: string;
	win?: IPlatformSpecificAdapterContribution;
	winx86?: IPlatformSpecificAdapterContribution;
	windows?: IPlatformSpecificAdapterContribution;
	osx?: IPlatformSpecificAdapterContribution;
	linux?: IPlatformSpecificAdapterContribution;

	aiKey?: string;

	languages?: string[];

	configurationAttributes?: Record<string, IJSONSchema>;
	initialConfigurations?: unknown[];
	configurationSnippets?: IJSONSchemaSnippet[];
	variables?: { [key: string]: string };
	when?: string;
	hiddenWhen?: string;
	deprecated?: string;
	strings?: { [key in DebuggerString]: string };
	uiMessages?: { [key in DebuggerString]: string };
}

export interface IBreakpointContribution {
	language: string;
	when?: string;
}

export enum DebugConfigurationProviderTriggerKind {
	Initial = 1,
	Dynamic = 2
}

export interface IDebugConfigurationProvider {
	readonly type: string;
	readonly triggerKind: DebugConfigurationProviderTriggerKind;
	resolveDebugConfiguration?(folderUri: uri | undefined, debugConfiguration: IConfig, token: CancellationToken): Promise<IConfig | null | undefined>;
	resolveDebugConfigurationWithSubstitutedVariables?(folderUri: uri | undefined, debugConfiguration: IConfig, token: CancellationToken): Promise<IConfig | null | undefined>;
	provideDebugConfigurations?(folderUri: uri | undefined, token: CancellationToken): Promise<IConfig[]>;
}

export interface IDebugAdapterDescriptorFactory {
	readonly type: string;
	createDebugAdapterDescriptor(session: IDebugSession): Promise<IAdapterDescriptor>;
}

interface ITerminalLauncher {
	runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined>;
}

export interface IConfigurationManager {

	readonly selectedConfiguration: {
		launch: ILaunch | undefined;
		getConfig: () => Promise<IConfig | undefined>;
		name: string | undefined;
		type: string | undefined;
	};

	selectConfiguration(launch: ILaunch | undefined, name?: string, config?: IConfig, dynamicConfigOptions?: { type?: string }): Promise<void>;

	getLaunches(): ReadonlyArray<ILaunch>;
	getLaunch(workspaceUri: uri | undefined): ILaunch | undefined;
	getAllConfigurations(): { launch: ILaunch; name: string; presentation?: IConfigPresentation }[];
	removeRecentDynamicConfigurations(name: string, type: string): void;
	getRecentDynamicConfigurations(): { name: string; type: string }[];

	readonly onDidSelectConfiguration: Event<void>;

	readonly onDidChangeConfigurationProviders: Event<void>;

	hasDebugConfigurationProvider(debugType: string, triggerKind?: DebugConfigurationProviderTriggerKind): boolean;
	getDynamicProviders(): Promise<{ label: string; type: string; pick: () => Promise<{ launch: ILaunch; config: IConfig; label: string } | undefined> }[]>;
	getDynamicConfigurationsByType(type: string, token?: CancellationToken): Promise<{ launch: ILaunch; config: IConfig; label: string }[]>;

	registerDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): IDisposable;
	unregisterDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): void;

	resolveConfigurationByProviders(folderUri: uri | undefined, type: string | undefined, debugConfiguration: unknown, token: CancellationToken): Promise<IConfig | null | undefined>;
}

export enum DebuggerString {
	UnverifiedBreakpoints = 'unverifiedBreakpoints'
}

export interface IAdapterManager {

	readonly onDidRegisterDebugger: Event<void>;

	hasEnabledDebuggers(): boolean;
	getDebugAdapterDescriptor(session: IDebugSession): Promise<IAdapterDescriptor | undefined>;
	getDebuggerLabel(type: string): string | undefined;
	someDebuggerInterestedInLanguage(language: string): boolean;
	getDebugger(type: string): IDebuggerMetadata | undefined;

	activateDebuggers(activationEvent: string, debugType?: string): Promise<void>;
	registerDebugAdapterFactory(debugTypes: string[], debugAdapterFactory: IDebugAdapterFactory): IDisposable;
	createDebugAdapter(session: IDebugSession): IDebugAdapter | undefined;
	registerDebugAdapterDescriptorFactory(debugAdapterDescriptorFactory: IDebugAdapterDescriptorFactory): IDisposable;
	unregisterDebugAdapterDescriptorFactory(debugAdapterDescriptorFactory: IDebugAdapterDescriptorFactory): void;

	substituteVariables(debugType: string, folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig>;
	runInTerminal(debugType: string, args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined>;
	getEnabledDebugger(type: string): (IDebugger & IDebuggerMetadata) | undefined;
	guessDebugger(gettingConfigurations: boolean): Promise<IGuessedDebugger | undefined>;

	get onDidDebuggersExtPointRead(): Event<void>;
}

export interface IGuessedDebugger {
	debugger: IDebugger;
	withConfig?: {
		label: string;
		launch: ILaunch;
		config: IConfig;
	};
}

export interface ILaunch {

	readonly uri: uri;

	readonly name: string;

	readonly workspace: IWorkspaceFolder | undefined;

	readonly hidden: boolean;

	getConfiguration(name: string): IConfig | undefined;

	getCompound(name: string): ICompound | undefined;

	getConfigurationNames(ignoreCompoundsAndPresentation?: boolean): string[];

	openConfigFile(options: { preserveFocus: boolean; type?: string; suppressInitialConfigs?: boolean }, token?: CancellationToken): Promise<{ editor: IEditorPane | null; created: boolean }>;
}


export const IDebugService = createDecorator<IDebugService>('debugService');

export interface IDebugService {
	readonly _serviceBrand: undefined;

	readonly state: State;

	readonly initializingOptions?: IDebugSessionOptions | undefined;

	readonly onDidChangeState: Event<State>;

	readonly onWillNewSession: Event<IDebugSession>;

	readonly onDidNewSession: Event<IDebugSession>;

	readonly onDidEndSession: Event<{ session: IDebugSession; restart: boolean }>;

	getConfigurationManager(): IConfigurationManager;

	getAdapterManager(): IAdapterManager;

	focusStackFrame(focusedStackFrame: IStackFrame | undefined, thread?: IThread, session?: IDebugSession, options?: { explicit?: boolean; preserveFocus?: boolean; sideBySide?: boolean; pinned?: boolean }): Promise<void>;

	canSetBreakpointsIn(model: EditorIModel): boolean;

	addBreakpoints(uri: uri, rawBreakpoints: IBreakpointData[], ariaAnnounce?: boolean): Promise<IBreakpoint[]>;

	updateBreakpoints(originalUri: uri, data: Map<string, IBreakpointUpdateData>, sendOnResourceSaved: boolean): Promise<void>;

	enableOrDisableBreakpoints(enable: boolean, breakpoint?: IEnablement): Promise<void>;

	/**
	 * Sets the global activated property for all breakpoints.
	 * Notifies debug adapter of breakpoint changes.
	 */
	setBreakpointsActivated(activated: boolean): Promise<void>;

	removeBreakpoints(id?: string | string[]): Promise<void>;

	addFunctionBreakpoint(opts?: IFunctionBreakpointOptions, id?: string): void;

	updateFunctionBreakpoint(id: string, update: { name?: string; hitCondition?: string; condition?: string }): Promise<void>;

	removeFunctionBreakpoints(id?: string): Promise<void>;

	addDataBreakpoint(opts: IDataBreakpointOptions): Promise<void>;

	updateDataBreakpoint(id: string, update: { hitCondition?: string; condition?: string }): Promise<void>;

	removeDataBreakpoints(id?: string): Promise<void>;

	addInstructionBreakpoint(opts: IInstructionBreakpointOptions): Promise<void>;

	removeInstructionBreakpoints(instructionReference?: string, offset?: number, address?: bigint): Promise<void>;

	setExceptionBreakpointCondition(breakpoint: IExceptionBreakpoint, condition: string | undefined): Promise<void>;

	setExceptionBreakpointsForSession(session: IDebugSession, filters: DebugProtocol.ExceptionBreakpointsFilter[]): void;

	sendAllBreakpoints(session?: IDebugSession): Promise<void>;

	sendBreakpoints(modelUri: uri, sourceModified?: boolean, session?: IDebugSession): Promise<void>;

	addWatchExpression(name?: string): void;

	renameWatchExpression(id: string, newName: string): void;

	moveWatchExpression(id: string, position: number): void;

	removeWatchExpressions(id?: string): void;

	startDebugging(launch: ILaunch | undefined, configOrName?: IConfig | string, options?: IDebugSessionOptions, saveBeforeStart?: boolean): Promise<boolean>;

	restartSession(session: IDebugSession, restartData?: unknown): Promise<void>;

	stopSession(session: IDebugSession | undefined, disconnect?: boolean, suspend?: boolean): Promise<void>;

	sourceIsNotAvailable(uri: uri): void;

	getModel(): IDebugModel;

	getViewModel(): IViewModel;

	runTo(uri: uri, lineNumber: number, column?: number): Promise<void>;
}

export const enum BreakpointWidgetContext {
	CONDITION = 0,
	HIT_COUNT = 1,
	LOG_MESSAGE = 2,
	TRIGGER_POINT = 3
}

export interface IDebugEditorContribution extends editorCommon.IEditorContribution {
	showHover(range: Position, focus: boolean): Promise<void>;
	addLaunchConfiguration(): Promise<void>;
	closeExceptionWidget(): void;
}

export interface IBreakpointEditorContribution extends editorCommon.IEditorContribution {
	showBreakpointWidget(lineNumber: number, column: number | undefined, context?: BreakpointWidgetContext): void;
	closeBreakpointWidget(): void;
	getContextMenuActionsAtPosition(lineNumber: number, model: EditorIModel): IAction[];
}

export interface IReplConfiguration {
	readonly fontSize: number;
	readonly fontFamily: string;
	readonly lineHeight: number;
	readonly cssLineHeight: string;
	readonly backgroundColor: Color | undefined;
	readonly fontSizeForTwistie: number;
}

export interface IReplOptions {
	readonly replConfiguration: IReplConfiguration;
}

export interface IDebugVisualizationContext {
	variable: DebugProtocol.Variable;
	containerId?: number;
	frameId?: number;
	threadId: number;
	sessionId: string;
}

export const enum DebugVisualizationType {
	Command,
	Tree,
}

export type MainThreadDebugVisualization =
	| { type: DebugVisualizationType.Command }
	| { type: DebugVisualizationType.Tree; id: string };


export const enum DebugTreeItemCollapsibleState {
	None = 0,
	Collapsed = 1,
	Expanded = 2
}

export interface IDebugVisualizationTreeItem {
	id: number;
	label: string;
	description?: string;
	collapsibleState: DebugTreeItemCollapsibleState;
	contextValue?: string;
	canEdit?: boolean;
}

export namespace IDebugVisualizationTreeItem {
	export type Serialized = IDebugVisualizationTreeItem;
	export const deserialize = (v: Serialized): IDebugVisualizationTreeItem => v;
	export const serialize = (item: IDebugVisualizationTreeItem): Serialized => item;
}

export interface IDebugVisualization {
	id: number;
	name: string;
	iconPath: { light?: URI; dark: URI } | undefined;
	iconClass: string | undefined;
	visualization: MainThreadDebugVisualization | undefined;
}

export namespace IDebugVisualization {
	export interface Serialized {
		id: number;
		name: string;
		iconPath?: { light?: UriComponents; dark: UriComponents };
		iconClass?: string;
		visualization?: MainThreadDebugVisualization;
	}

	export const deserialize = (v: Serialized): IDebugVisualization => ({
		id: v.id,
		name: v.name,
		iconPath: v.iconPath && { light: URI.revive(v.iconPath.light), dark: URI.revive(v.iconPath.dark) },
		iconClass: v.iconClass,
		visualization: v.visualization,
	});

	export const serialize = (visualizer: IDebugVisualization): Serialized => visualizer;
}
