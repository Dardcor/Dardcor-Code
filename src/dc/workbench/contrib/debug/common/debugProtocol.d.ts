/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare namespace DebugProtocol {

	interface ProtocolMessage {
		seq: number;
		type: 'request' | 'response' | 'event' | string;
	}

	interface Request extends ProtocolMessage {
		command: string;
		arguments?: any;
	}

	interface Event extends ProtocolMessage {
		event: string;
		body?: any;
	}

	interface Response extends ProtocolMessage {
		request_seq: number;
		success: boolean;
		command: string;
		message?: 'cancelled' | 'notStopped' | string;
		body?: any;
	}

	interface ErrorResponse extends Response {
		body: {
			error?: Message;
		};
	}

	interface CancelRequest extends Request {
		arguments?: CancelArguments;
	}

	interface CancelArguments {
		requestId?: number;
		progressId?: string;
	}

	interface CancelResponse extends Response {
	}

	interface InitializedEvent extends Event {
	}

	interface StoppedEvent extends Event {
		body: {
			reason: 'step' | 'breakpoint' | 'exception' | 'pause' | 'entry' | 'goto' | 'function breakpoint' | 'data breakpoint' | 'instruction breakpoint' | string;
			description?: string;
			threadId?: number;
			preserveFocusHint?: boolean;
			text?: string;
			allThreadsStopped?: boolean;
			hitBreakpointIds?: number[];
		};
	}

	interface ContinuedEvent extends Event {
		body: {
			threadId: number;
			allThreadsContinued?: boolean;
		};
	}

	interface ExitedEvent extends Event {
		body: {
			exitCode: number;
		};
	}

	interface TerminatedEvent extends Event {
		body?: {
			restart?: any;
		};
	}

	interface ThreadEvent extends Event {
		body: {
			reason: 'started' | 'exited' | string;
			threadId: number;
		};
	}

	interface OutputEvent extends Event {
		body: {
			category?: 'console' | 'important' | 'stdout' | 'stderr' | 'telemetry' | string;
			output: string;
			group?: 'start' | 'startCollapsed' | 'end';
			variablesReference?: number;
			source?: Source;
			line?: number;
			column?: number;
			data?: any;
			locationReference?: number;
		};
	}

	interface BreakpointEvent extends Event {
		body: {
			reason: 'changed' | 'new' | 'removed' | string;
			breakpoint: Breakpoint;
		};
	}

	interface ModuleEvent extends Event {
		body: {
			reason: 'new' | 'changed' | 'removed';
			module: Module;
		};
	}

	interface LoadedSourceEvent extends Event {
		body: {
			reason: 'new' | 'changed' | 'removed';
			source: Source;
		};
	}

	interface ProcessEvent extends Event {
		body: {
			name: string;
			systemProcessId?: number;
			isLocalProcess?: boolean;
			startMethod?: 'launch' | 'attach' | 'attachForSuspendedLaunch';
			pointerSize?: number;
		};
	}

	interface CapabilitiesEvent extends Event {
		body: {
			capabilities: Capabilities;
		};
	}

	interface ProgressStartEvent extends Event {
		body: {
			progressId: string;
			title: string;
			requestId?: number;
			cancellable?: boolean;
			message?: string;
			percentage?: number;
		};
	}

	interface ProgressUpdateEvent extends Event {
		body: {
			progressId: string;
			message?: string;
			percentage?: number;
		};
	}

	interface ProgressEndEvent extends Event {
		body: {
			progressId: string;
			message?: string;
		};
	}

	interface InvalidatedEvent extends Event {
		body: {
			areas?: InvalidatedAreas[];
			threadId?: number;
			stackFrameId?: number;
		};
	}

	interface MemoryEvent extends Event {
		body: {
			memoryReference: string;
			offset: number;
			count: number;
		};
	}

	interface RunInTerminalRequest extends Request {
		arguments: RunInTerminalRequestArguments;
	}

	interface RunInTerminalRequestArguments {
		kind?: 'integrated' | 'external';
		title?: string;
		cwd: string;
		args: string[];
		env?: { [key: string]: string | null; };
		argsCanBeInterpretedByShell?: boolean;
	}

	interface RunInTerminalResponse extends Response {
		body: {
			processId?: number;
			shellProcessId?: number;
		};
	}

	interface StartDebuggingRequest extends Request {
		arguments: StartDebuggingRequestArguments;
	}

	interface StartDebuggingRequestArguments {
		configuration: { [key: string]: any; };
		request: 'launch' | 'attach';
	}

	interface StartDebuggingResponse extends Response {
	}

	interface InitializeRequest extends Request {
		arguments: InitializeRequestArguments;
	}

	interface InitializeRequestArguments {
		clientID?: string;
		clientName?: string;
		adapterID: string;
		locale?: string;
		linesStartAt1?: boolean;
		columnsStartAt1?: boolean;
		pathFormat?: 'path' | 'uri' | string;
		supportsVariableType?: boolean;
		supportsVariablePaging?: boolean;
		supportsRunInTerminalRequest?: boolean;
		supportsMemoryReferences?: boolean;
		supportsProgressReporting?: boolean;
		supportsInvalidatedEvent?: boolean;
		supportsMemoryEvent?: boolean;
		supportsArgsCanBeInterpretedByShell?: boolean;
		supportsStartDebuggingRequest?: boolean;
		supportsANSIStyling?: boolean;
	}

	interface InitializeResponse extends Response {
		body?: Capabilities;
	}

	interface ConfigurationDoneRequest extends Request {
		arguments?: ConfigurationDoneArguments;
	}

	interface ConfigurationDoneArguments {
	}

	interface ConfigurationDoneResponse extends Response {
	}

	interface LaunchRequest extends Request {
		arguments: LaunchRequestArguments;
	}

	interface LaunchRequestArguments {
		noDebug?: boolean;
		__restart?: any;
	}

	interface LaunchResponse extends Response {
	}

	interface AttachRequest extends Request {
		arguments: AttachRequestArguments;
	}

	interface AttachRequestArguments {
		__restart?: any;
	}

	interface AttachResponse extends Response {
	}

	interface RestartRequest extends Request {
		arguments?: RestartArguments;
	}

	interface RestartArguments {
		arguments?: LaunchRequestArguments | AttachRequestArguments;
	}

	interface RestartResponse extends Response {
	}

	interface DisconnectRequest extends Request {
		arguments?: DisconnectArguments;
	}

	interface DisconnectArguments {
		restart?: boolean;
		terminateDebuggee?: boolean;
		suspendDebuggee?: boolean;
	}

	interface DisconnectResponse extends Response {
	}

	interface TerminateRequest extends Request {
		arguments?: TerminateArguments;
	}

	interface TerminateArguments {
		restart?: boolean;
	}

	interface TerminateResponse extends Response {
	}

	interface BreakpointLocationsRequest extends Request {
		arguments?: BreakpointLocationsArguments;
	}

	interface BreakpointLocationsArguments {
		source: Source;
		line: number;
		column?: number;
		endLine?: number;
		endColumn?: number;
	}

	interface BreakpointLocationsResponse extends Response {
		body: {
			breakpoints: BreakpointLocation[];
		};
	}

	interface SetBreakpointsRequest extends Request {
		arguments: SetBreakpointsArguments;
	}

	interface SetBreakpointsArguments {
		source: Source;
		breakpoints?: SourceBreakpoint[];
		lines?: number[];
		sourceModified?: boolean;
	}

	interface SetBreakpointsResponse extends Response {
		body: {
			breakpoints: Breakpoint[];
		};
	}

	interface SetFunctionBreakpointsRequest extends Request {
		arguments: SetFunctionBreakpointsArguments;
	}

	interface SetFunctionBreakpointsArguments {
		breakpoints: FunctionBreakpoint[];
	}

	interface SetFunctionBreakpointsResponse extends Response {
		body: {
			breakpoints: Breakpoint[];
		};
	}

	interface SetExceptionBreakpointsRequest extends Request {
		arguments: SetExceptionBreakpointsArguments;
	}

	interface SetExceptionBreakpointsArguments {
		filters: string[];
		filterOptions?: ExceptionFilterOptions[];
		exceptionOptions?: ExceptionOptions[];
	}

	interface SetExceptionBreakpointsResponse extends Response {
		body?: {
			breakpoints?: Breakpoint[];
		};
	}

	interface DataBreakpointInfoRequest extends Request {
		arguments: DataBreakpointInfoArguments;
	}

	interface DataBreakpointInfoArguments {
		variablesReference?: number;
		name: string;
		/** When `name` is an expression, evaluate it in the scope of this stack frame. If not specified, the expression is evaluated in the global scope. When `variablesReference` is specified, this property has no effect. */
		frameId?: number;
		bytes?: number;
		asAddress?: boolean;
		mode?: string;
	}

	interface DataBreakpointInfoResponse extends Response {
		body: {
			dataId: string | null;
			description: string;
			accessTypes?: DataBreakpointAccessType[];
			canPersist?: boolean;
		};
	}

	interface SetDataBreakpointsRequest extends Request {
		arguments: SetDataBreakpointsArguments;
	}

	interface SetDataBreakpointsArguments {
		breakpoints: DataBreakpoint[];
	}

	interface SetDataBreakpointsResponse extends Response {
		body: {
			breakpoints: Breakpoint[];
		};
	}

	interface SetInstructionBreakpointsRequest extends Request {
		arguments: SetInstructionBreakpointsArguments;
	}

	interface SetInstructionBreakpointsArguments {
		breakpoints: InstructionBreakpoint[];
	}

	interface SetInstructionBreakpointsResponse extends Response {
		body: {
			breakpoints: Breakpoint[];
		};
	}

	interface ContinueRequest extends Request {
		arguments: ContinueArguments;
	}

	interface ContinueArguments {
		threadId: number;
		singleThread?: boolean;
	}

	interface ContinueResponse extends Response {
		body: {
			allThreadsContinued?: boolean;
		};
	}

	interface NextRequest extends Request {
		arguments: NextArguments;
	}

	interface NextArguments {
		threadId: number;
		singleThread?: boolean;
		granularity?: SteppingGranularity;
	}

	interface NextResponse extends Response {
	}

	interface StepInRequest extends Request {
		arguments: StepInArguments;
	}

	interface StepInArguments {
		threadId: number;
		singleThread?: boolean;
		targetId?: number;
		granularity?: SteppingGranularity;
	}

	interface StepInResponse extends Response {
	}

	interface StepOutRequest extends Request {
		arguments: StepOutArguments;
	}

	interface StepOutArguments {
		threadId: number;
		singleThread?: boolean;
		granularity?: SteppingGranularity;
	}

	interface StepOutResponse extends Response {
	}

	interface StepBackRequest extends Request {
		arguments: StepBackArguments;
	}

	interface StepBackArguments {
		threadId: number;
		singleThread?: boolean;
		granularity?: SteppingGranularity;
	}

	interface StepBackResponse extends Response {
	}

	interface ReverseContinueRequest extends Request {
		arguments: ReverseContinueArguments;
	}

	interface ReverseContinueArguments {
		threadId: number;
		singleThread?: boolean;
	}

	interface ReverseContinueResponse extends Response {
	}

	interface RestartFrameRequest extends Request {
		arguments: RestartFrameArguments;
	}

	interface RestartFrameArguments {
		frameId: number;
	}

	interface RestartFrameResponse extends Response {
	}

	interface GotoRequest extends Request {
		arguments: GotoArguments;
	}

	interface GotoArguments {
		threadId: number;
		targetId: number;
	}

	interface GotoResponse extends Response {
	}

	interface PauseRequest extends Request {
		arguments: PauseArguments;
	}

	interface PauseArguments {
		threadId: number;
	}

	interface PauseResponse extends Response {
	}

	interface StackTraceRequest extends Request {
		arguments: StackTraceArguments;
	}

	interface StackTraceArguments {
		threadId: number;
		startFrame?: number;
		levels?: number;
		format?: StackFrameFormat;
	}

	interface StackTraceResponse extends Response {
		body: {
			stackFrames: StackFrame[];
			totalFrames?: number;
		};
	}

	interface ScopesRequest extends Request {
		arguments: ScopesArguments;
	}

	interface ScopesArguments {
		frameId: number;
	}

	interface ScopesResponse extends Response {
		body: {
			scopes: Scope[];
		};
	}

	interface VariablesRequest extends Request {
		arguments: VariablesArguments;
	}

	interface VariablesArguments {
		variablesReference: number;
		filter?: 'indexed' | 'named';
		start?: number;
		count?: number;
		format?: ValueFormat;
	}

	interface VariablesResponse extends Response {
		body: {
			variables: Variable[];
		};
	}

	interface SetVariableRequest extends Request {
		arguments: SetVariableArguments;
	}

	interface SetVariableArguments {
		variablesReference: number;
		name: string;
		value: string;
		format?: ValueFormat;
	}

	interface SetVariableResponse extends Response {
		body: {
			value: string;
			type?: string;
			variablesReference?: number;
			namedVariables?: number;
			indexedVariables?: number;
			memoryReference?: string;
			valueLocationReference?: number;
		};
	}

	interface SourceRequest extends Request {
		arguments: SourceArguments;
	}

	interface SourceArguments {
		source?: Source;
		sourceReference: number;
	}

	interface SourceResponse extends Response {
		body: {
			content: string;
			mimeType?: string;
		};
	}

	interface ThreadsRequest extends Request {
	}

	interface ThreadsResponse extends Response {
		body: {
			threads: Thread[];
		};
	}

	interface TerminateThreadsRequest extends Request {
		arguments: TerminateThreadsArguments;
	}

	interface TerminateThreadsArguments {
		threadIds?: number[];
	}

	interface TerminateThreadsResponse extends Response {
	}

	interface ModulesRequest extends Request {
		arguments: ModulesArguments;
	}

	interface ModulesArguments {
		startModule?: number;
		moduleCount?: number;
	}

	interface ModulesResponse extends Response {
		body: {
			modules: Module[];
			totalModules?: number;
		};
	}

	interface LoadedSourcesRequest extends Request {
		arguments?: LoadedSourcesArguments;
	}

	interface LoadedSourcesArguments {
	}

	interface LoadedSourcesResponse extends Response {
		body: {
			sources: Source[];
		};
	}

	interface EvaluateRequest extends Request {
		arguments: EvaluateArguments;
	}

	interface EvaluateArguments {
		expression: string;
		/** Evaluate the expression in the scope of this stack frame. If not specified, the expression is evaluated in the global scope. */
		frameId?: number;
		line?: number;
		column?: number;
		source?: Source;
		context?: 'watch' | 'repl' | 'hover' | 'clipboard' | 'variables' | string;
		format?: ValueFormat;
	}

	interface EvaluateResponse extends Response {
		body: {
			result: string;
			type?: string;
			presentationHint?: VariablePresentationHint;
			variablesReference: number;
			namedVariables?: number;
			indexedVariables?: number;
			memoryReference?: string;
			valueLocationReference?: number;
		};
	}

	interface SetExpressionRequest extends Request {
		arguments: SetExpressionArguments;
	}

	interface SetExpressionArguments {
		expression: string;
		value: string;
		/** Evaluate the expressions in the scope of this stack frame. If not specified, the expressions are evaluated in the global scope. */
		frameId?: number;
		format?: ValueFormat;
	}

	interface SetExpressionResponse extends Response {
		body: {
			value: string;
			type?: string;
			presentationHint?: VariablePresentationHint;
			variablesReference?: number;
			namedVariables?: number;
			indexedVariables?: number;
			memoryReference?: string;
			valueLocationReference?: number;
		};
	}

	interface StepInTargetsRequest extends Request {
		arguments: StepInTargetsArguments;
	}

	interface StepInTargetsArguments {
		frameId: number;
	}

	interface StepInTargetsResponse extends Response {
		body: {
			targets: StepInTarget[];
		};
	}

	interface GotoTargetsRequest extends Request {
		arguments: GotoTargetsArguments;
	}

	interface GotoTargetsArguments {
		source: Source;
		line: number;
		column?: number;
	}

	interface GotoTargetsResponse extends Response {
		body: {
			targets: GotoTarget[];
		};
	}

	interface CompletionsRequest extends Request {
		arguments: CompletionsArguments;
	}

	interface CompletionsArguments {
		/** Returns completions in the scope of this stack frame. If not specified, the completions are returned for the global scope. */
		frameId?: number;
		text: string;
		column: number;
		line?: number;
	}

	interface CompletionsResponse extends Response {
		body: {
			targets: CompletionItem[];
		};
	}

	interface ExceptionInfoRequest extends Request {
		arguments: ExceptionInfoArguments;
	}

	interface ExceptionInfoArguments {
		threadId: number;
	}

	interface ExceptionInfoResponse extends Response {
		body: {
			exceptionId: string;
			description?: string;
			breakMode: ExceptionBreakMode;
			details?: ExceptionDetails;
		};
	}

	interface ReadMemoryRequest extends Request {
		arguments: ReadMemoryArguments;
	}

	interface ReadMemoryArguments {
		memoryReference: string;
		offset?: number;
		count: number;
	}

	interface ReadMemoryResponse extends Response {
		body?: {
			address: string;
			unreadableBytes?: number;
			data?: string;
		};
	}

	interface WriteMemoryRequest extends Request {
		arguments: WriteMemoryArguments;
	}

	interface WriteMemoryArguments {
		memoryReference: string;
		offset?: number;
		allowPartial?: boolean;
		data: string;
	}

	interface WriteMemoryResponse extends Response {
		body?: {
			offset?: number;
			bytesWritten?: number;
		};
	}

	interface DisassembleRequest extends Request {
		arguments: DisassembleArguments;
	}

	interface DisassembleArguments {
		memoryReference: string;
		offset?: number;
		instructionOffset?: number;
		instructionCount: number;
		resolveSymbols?: boolean;
	}

	interface DisassembleResponse extends Response {
		body?: {
			instructions: DisassembledInstruction[];
		};
	}

	interface LocationsRequest extends Request {
		arguments: LocationsArguments;
	}

	interface LocationsArguments {
		locationReference: number;
	}

	interface LocationsResponse extends Response {
		body?: {
			source: Source;
			line: number;
			column?: number;
			endLine?: number;
			endColumn?: number;
		};
	}

	interface Capabilities {
		supportsConfigurationDoneRequest?: boolean;
		supportsFunctionBreakpoints?: boolean;
		supportsConditionalBreakpoints?: boolean;
		supportsHitConditionalBreakpoints?: boolean;
		supportsEvaluateForHovers?: boolean;
		exceptionBreakpointFilters?: ExceptionBreakpointsFilter[];
		supportsStepBack?: boolean;
		supportsSetVariable?: boolean;
		supportsRestartFrame?: boolean;
		supportsGotoTargetsRequest?: boolean;
		supportsStepInTargetsRequest?: boolean;
		supportsCompletionsRequest?: boolean;
		completionTriggerCharacters?: string[];
		supportsModulesRequest?: boolean;
		additionalModuleColumns?: ColumnDescriptor[];
		supportedChecksumAlgorithms?: ChecksumAlgorithm[];
		supportsRestartRequest?: boolean;
		supportsExceptionOptions?: boolean;
		supportsValueFormattingOptions?: boolean;
		supportsExceptionInfoRequest?: boolean;
		supportTerminateDebuggee?: boolean;
		supportSuspendDebuggee?: boolean;
		supportsDelayedStackTraceLoading?: boolean;
		supportsLoadedSourcesRequest?: boolean;
		supportsLogPoints?: boolean;
		supportsTerminateThreadsRequest?: boolean;
		supportsSetExpression?: boolean;
		supportsTerminateRequest?: boolean;
		supportsDataBreakpoints?: boolean;
		supportsReadMemoryRequest?: boolean;
		supportsWriteMemoryRequest?: boolean;
		supportsDisassembleRequest?: boolean;
		supportsCancelRequest?: boolean;
		supportsBreakpointLocationsRequest?: boolean;
		supportsClipboardContext?: boolean;
		supportsSteppingGranularity?: boolean;
		supportsInstructionBreakpoints?: boolean;
		supportsExceptionFilterOptions?: boolean;
		supportsSingleThreadExecutionRequests?: boolean;
		supportsDataBreakpointBytes?: boolean;
		breakpointModes?: BreakpointMode[];
		supportsANSIStyling?: boolean;
	}

	interface ExceptionBreakpointsFilter {
		filter: string;
		label: string;
		description?: string;
		default?: boolean;
		supportsCondition?: boolean;
		conditionDescription?: string;
	}

	interface Message {
		id: number;
		format: string;
		variables?: { [key: string]: string; };
		sendTelemetry?: boolean;
		showUser?: boolean;
		url?: string;
		urlLabel?: string;
	}

	interface Module {
		id: number | string;
		name: string;
		path?: string;
		isOptimized?: boolean;
		isUserCode?: boolean;
		version?: string;
		symbolStatus?: string;
		symbolFilePath?: string;
		dateTimeStamp?: string;
		addressRange?: string;
	}

	interface ColumnDescriptor {
		attributeName: string;
		label: string;
		format?: string;
		type?: 'string' | 'number' | 'boolean' | 'unixTimestampUTC';
		width?: number;
	}

	interface Thread {
		id: number;
		name: string;
	}

	interface Source {
		name?: string;
		path?: string;
		sourceReference?: number;
		presentationHint?: 'normal' | 'emphasize' | 'deemphasize';
		origin?: string;
		sources?: Source[];
		adapterData?: any;
		checksums?: Checksum[];
	}

	interface StackFrame {
		id: number;
		name: string;
		source?: Source;
		line: number;
		column: number;
		endLine?: number;
		endColumn?: number;
		canRestart?: boolean;
		instructionPointerReference?: string;
		moduleId?: number | string;
		presentationHint?: 'normal' | 'label' | 'subtle';
	}

	interface Scope {
		name: string;
		presentationHint?: 'arguments' | 'locals' | 'registers' | 'returnValue' | string;
		variablesReference: number;
		namedVariables?: number;
		indexedVariables?: number;
		expensive: boolean;
		source?: Source;
		line?: number;
		column?: number;
		endLine?: number;
		endColumn?: number;
	}

	interface Variable {
		name: string;
		value: string;
		type?: string;
		presentationHint?: VariablePresentationHint;
		evaluateName?: string;
		variablesReference: number;
		namedVariables?: number;
		indexedVariables?: number;
		memoryReference?: string;
		declarationLocationReference?: number;
		valueLocationReference?: number;
	}

	interface VariablePresentationHint {
		kind?: 'property' | 'method' | 'class' | 'data' | 'event' | 'baseClass' | 'innerClass' | 'interface' | 'mostDerivedClass' | 'virtual' | 'dataBreakpoint' | string;
		attributes?: ('static' | 'constant' | 'readOnly' | 'rawString' | 'hasObjectId' | 'canHaveObjectId' | 'hasSideEffects' | 'hasDataBreakpoint' | string)[];
		visibility?: 'public' | 'private' | 'protected' | 'internal' | 'final' | string;
		lazy?: boolean;
	}

	interface BreakpointLocation {
		line: number;
		column?: number;
		endLine?: number;
		endColumn?: number;
	}

	interface SourceBreakpoint {
		line: number;
		column?: number;
		condition?: string;
		hitCondition?: string;
		logMessage?: string;
		mode?: string;
	}

	interface FunctionBreakpoint {
		name: string;
		condition?: string;
		hitCondition?: string;
	}

	type DataBreakpointAccessType = 'read' | 'write' | 'readWrite';

	interface DataBreakpoint {
		dataId: string;
		accessType?: DataBreakpointAccessType;
		condition?: string;
		hitCondition?: string;
	}

	interface InstructionBreakpoint {
		instructionReference: string;
		offset?: number;
		condition?: string;
		hitCondition?: string;
		mode?: string;
	}

	interface Breakpoint {
		id?: number;
		verified: boolean;
		message?: string;
		source?: Source;
		line?: number;
		column?: number;
		endLine?: number;
		endColumn?: number;
		instructionReference?: string;
		offset?: number;
		reason?: 'pending' | 'failed';
	}

	type SteppingGranularity = 'statement' | 'line' | 'instruction';

	interface StepInTarget {
		id: number;
		label: string;
		line?: number;
		column?: number;
		endLine?: number;
		endColumn?: number;
	}

	interface GotoTarget {
		id: number;
		label: string;
		line: number;
		column?: number;
		endLine?: number;
		endColumn?: number;
		instructionPointerReference?: string;
	}

	interface CompletionItem {
		label: string;
		text?: string;
		sortText?: string;
		detail?: string;
		type?: CompletionItemType;
		start?: number;
		length?: number;
		selectionStart?: number;
		selectionLength?: number;
	}

	type CompletionItemType = 'method' | 'function' | 'constructor' | 'field' | 'variable' | 'class' | 'interface' | 'module' | 'property' | 'unit' | 'value' | 'enum' | 'keyword' | 'snippet' | 'text' | 'color' | 'file' | 'reference' | 'customcolor';

	type ChecksumAlgorithm = 'MD5' | 'SHA1' | 'SHA256' | 'timestamp';

	interface Checksum {
		algorithm: ChecksumAlgorithm;
		checksum: string;
	}

	interface ValueFormat {
		hex?: boolean;
	}

	interface StackFrameFormat extends ValueFormat {
		parameters?: boolean;
		parameterTypes?: boolean;
		parameterNames?: boolean;
		parameterValues?: boolean;
		line?: boolean;
		module?: boolean;
		includeAll?: boolean;
	}

	interface ExceptionFilterOptions {
		filterId: string;
		condition?: string;
		mode?: string;
	}

	interface ExceptionOptions {
		path?: ExceptionPathSegment[];
		breakMode: ExceptionBreakMode;
	}

	type ExceptionBreakMode = 'never' | 'always' | 'unhandled' | 'userUnhandled';

	interface ExceptionPathSegment {
		negate?: boolean;
		names: string[];
	}

	interface ExceptionDetails {
		message?: string;
		typeName?: string;
		fullTypeName?: string;
		evaluateName?: string;
		stackTrace?: string;
		innerException?: ExceptionDetails[];
	}

	interface DisassembledInstruction {
		address: string;
		instructionBytes?: string;
		instruction: string;
		symbol?: string;
		location?: Source;
		line?: number;
		column?: number;
		endLine?: number;
		endColumn?: number;
		presentationHint?: 'normal' | 'invalid';
	}

	type InvalidatedAreas = 'all' | 'stacks' | 'threads' | 'variables' | string;

	interface BreakpointMode {
		mode: string;
		label: string;
		description?: string;
		appliesTo: BreakpointModeApplicability[];
	}

	type BreakpointModeApplicability = 'source' | 'exception' | 'data' | 'instruction' | string;
}

