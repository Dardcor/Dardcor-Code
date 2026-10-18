/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Separator } from '../../../../../base/common/actions.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../../base/common/iterator.js';
import { IJSONSchema } from '../../../../../base/common/jsonSchema.js';
import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { derived, IObservable, IReader, ITransaction, ObservableSet } from '../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { Location } from '../../../../../editor/common/languages.js';
import { localize } from '../../../../../nls.js';
import { ConfirmationOption } from '../../../../../platform/agentHost/common/state/protocol/state.js';
import { ContextKeyExpression, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IProgress } from '../../../../../platform/progress/common/progress.js';
import { ChatRequestToolReferenceEntry } from '../attachments/chatVariableEntries.js';
import { IVariableReference } from '../chatModes.js';
import { ConfirmedReason, IChatAgentFeedbackReviewConfirmationData, IChatAutomationConfigurationData, IChatAutomationConfiguredData, IChatExtensionsContent, IChatGeneratedImageData, IChatModifiedFilesConfirmationData, IChatSearchToolInvocationData, IChatSessionCreatedData, IChatSimpleToolInvocationData, IChatSubagentToolInvocationData, IChatTodoListContent, IChatToolInputInvocationData, IChatToolInvocation, type IChatTerminalToolInvocationData } from '../chatService/chatService.js';
import { ILanguageModelChatMetadata, LanguageModelPartAudience } from '../languageModels.js';
import { UserSelectedTools } from '../participants/chatAgents.js';
import { PromptElementJSON, stringifyPromptElementJSON } from './promptTsxTypes.js';

export interface ILanguageModelChatSelector {
	readonly vendor?: string;
	readonly family?: string;
	readonly version?: string;
	readonly id?: string;
}

export interface IToolData {
	readonly id: string;
	readonly source: ToolDataSource;
	readonly toolReferenceName?: string;
	readonly legacyToolReferenceFullNames?: readonly string[];
	readonly icon?: { dark: URI; light?: URI } | ThemeIcon;
	readonly when?: ContextKeyExpression;
	readonly tags?: readonly string[];
	readonly displayName: string;
	readonly userDescription?: string;
	readonly modelDescription: string;
	readonly inputSchema?: IJSONSchema;
	readonly canBeReferencedInPrompt?: boolean;
	readonly runsInWorkspace?: boolean;
	readonly alwaysDisplayInputOutput?: boolean;
	readonly canRequestPreApproval?: boolean;
	readonly canRequestPostApproval?: boolean;
	readonly models?: readonly ILanguageModelChatSelector[];
}

export function toolMatchesModel(toolData: IToolData, model: ILanguageModelChatMetadata | undefined): boolean {
	if (!toolData.models || toolData.models.length === 0) {
		return true;
	}
	if (!model) {
		return true;
	}
	return toolData.models.some(selector =>
		(!selector.id || selector.id === model.id) &&
		(!selector.vendor || selector.vendor === model.vendor) &&
		(!selector.family || selector.family === model.family) &&
		(!selector.version || selector.version === model.version)
	);
}

export interface IToolProgressStep {
	readonly message: string | IMarkdownString | undefined;
	readonly progress?: number;
}

export type ToolProgress = IProgress<IToolProgressStep>;

export type ToolDataSource =
	| {
		type: 'extension';
		label: string;
		extensionId: ExtensionIdentifier;
	}
	| {
		type: 'mcp';
		label: string;
		serverLabel: string | undefined;
		instructions: string | undefined;
		collectionId: string;
		definitionId: string;
	}
	| {
		type: 'user';
		label: string;
		file: URI;
	}
	| {
		type: 'internal';
		label: string;
	} | {
		type: 'external';
		label: string;
	};

export namespace ToolDataSource {

	export const Internal: ToolDataSource = { type: 'internal', label: 'Built-In' };

	export const External: ToolDataSource = { type: 'external', label: 'External' };

	export function toKey(source: ToolDataSource): string {
		switch (source.type) {
			case 'extension': return `extension:${source.extensionId.value}`;
			case 'mcp': return `mcp:${source.collectionId}:${source.definitionId}`;
			case 'user': return `user:${source.file.toString()}`;
			case 'internal': return 'internal';
			case 'external': return 'external';
		}
	}

	export function equals(a: ToolDataSource, b: ToolDataSource): boolean {
		return toKey(a) === toKey(b);
	}

	export function classify(source: ToolDataSource): { readonly ordinal: number; readonly label: string } {
		if (source.type === 'internal') {
			return { ordinal: 1, label: localize('builtin', 'Built-In') };
		} else if (source.type === 'mcp') {
			return { ordinal: 2, label: source.serverLabel || source.label };
		} else if (source.type === 'user') {
			return { ordinal: 0, label: localize('user', 'User Defined') };
		} else {
			return { ordinal: 3, label: source.label };
		}
	}
}

export interface IExternalPreToolUseHookResult {
	permissionDecision?: 'allow' | 'deny' | 'ask';
	permissionDecisionReason?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	updatedInput?: Record<string, any>;
}

export interface IToolInvocation {
	callId: string;
	toolId: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	parameters: Record<string, any>;
	tokenBudget?: number;
	context: IToolInvocationContext | undefined;
	chatRequestId?: string;
	chatInteractionId?: string;
	chatStreamToolCallId?: string;
	subAgentInvocationId?: string;
	toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData | IChatSessionCreatedData | IChatGeneratedImageData | IChatAutomationConfigurationData | IChatAutomationConfiguredData;
	modelId?: string;
	userSelectedTools?: UserSelectedTools;
	selectedCustomButton?: string;
	preToolUseResult?: IExternalPreToolUseHookResult;
	preApproved?: ConfirmedReason;
	traceparent?: string;
	tracestate?: string;
}

export interface IToolInvocationContext {
	readonly sessionResource: URI;
	readonly workingDirectory?: URI;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isToolInvocationContext(obj: any): obj is IToolInvocationContext {
	return obj !== null && typeof obj === 'object' && URI.isUri(obj.sessionResource);
}

export interface IToolInvocationPreparationContext {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	parameters: any;
	toolCallId: string;
	chatRequestId?: string;
	chatSessionResource: URI | undefined;
	chatInteractionId?: string;
	modelId?: string;
	forceConfirmationReason?: string;
	workingDirectory?: URI;
}

export type ToolInputOutputBase = {
	mimeType?: string;
	uri?: URI;
	asResource?: boolean;
	audience?: LanguageModelPartAudience[];
};

export type ToolInputOutputEmbedded = ToolInputOutputBase & {
	type: 'embed';
	value: string;
	isText?: boolean;
};

export type ToolInputOutputReference = ToolInputOutputBase & { type: 'ref'; uri: URI };

export interface IToolResultInputOutputDetails {
	readonly input: string;
	readonly inputLanguage?: string;
	readonly output: (ToolInputOutputEmbedded | ToolInputOutputReference)[];
	readonly isError?: boolean;
	readonly mcpOutput?: unknown;
}

export interface IToolResultOutputDetails {
	readonly output: { type: 'data'; mimeType: string; value: VSBuffer };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isToolResultInputOutputDetails(obj: any): obj is IToolResultInputOutputDetails {
	return typeof obj === 'object' && typeof obj?.input === 'string' && (typeof obj?.output === 'string' || Array.isArray(obj?.output));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isToolResultOutputDetails(obj: any): obj is IToolResultOutputDetails {
	return typeof obj === 'object' && typeof obj?.output === 'object' && typeof obj?.output?.mimeType === 'string' && obj?.output?.type === 'data';
}

export interface IToolResult {
	content: (IToolResultPromptTsxPart | IToolResultTextPart | IToolResultDataPart)[];
	toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData | IChatSessionCreatedData | IChatGeneratedImageData | IChatAutomationConfiguredData;
	toolResultMessage?: string | IMarkdownString;
	toolResultDetails?: Array<URI | Location> | IToolResultInputOutputDetails | IToolResultOutputDetails;
	toolResultError?: string | boolean;
	toolMetadata?: unknown;
	confirmResults?: boolean;
}

export function toolContentToA11yString(part: IToolResult['content']) {
	return part.map(p => {
		switch (p.kind) {
			case 'promptTsx':
				return stringifyPromptTsxPart(p);
			case 'text':
				return p.value;
			case 'data':
				return localize('toolResultDataPartA11y', "{0} of {1} binary data", ByteSize.formatSize(p.value.data.byteLength), p.value.mimeType || 'unknown');
		}
	}).join(', ');
}

export function toolResultHasBuffers(result: IToolResult): boolean {
	return result.content.some(part => part.kind === 'data');
}

export interface IToolResultPromptTsxPart {
	kind: 'promptTsx';
	value: unknown;
}

export function stringifyPromptTsxPart(part: IToolResultPromptTsxPart): string {
	return stringifyPromptElementJSON(part.value as PromptElementJSON);
}

export interface IToolResultTextPart {
	kind: 'text';
	value: string;
	audience?: LanguageModelPartAudience[];
	title?: string;
}

export interface IToolResultDataPart {
	kind: 'data';
	value: {
		mimeType: string;
		data: VSBuffer;
	};
	audience?: LanguageModelPartAudience[];
	title?: string;
}

export type IToolApprovalReason =
	| { readonly status: 'loading' }
	| {
		readonly status: 'complete';
		readonly explanation: string | IMarkdownString;
		readonly safety: number;
	};

export interface IToolConfirmationMessages {
	title?: string | IMarkdownString;
	message?: string | IMarkdownString;
	disclaimer?: string | IMarkdownString;
	approvalReason?: IToolApprovalReason;
	allowAutoConfirm?: boolean;
	terminalCustomActions?: ToolConfirmationAction[];
	confirmResults?: boolean;
	confirmationNotNeededReason?: string | IMarkdownString;
	customOptions?: ConfirmationOption[];
	approveCombination?: {
		label: string | IMarkdownString;
		key: string;
		arguments?: string;
	};
}

export interface IToolConfirmationAction {
	label: string;
	disabled?: boolean;
	tooltip?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: any;
}

export type ToolConfirmationAction = IToolConfirmationAction | Separator;

export enum ToolInvocationPresentation {
	Hidden = 'hidden',
	HiddenAfterComplete = 'hiddenAfterComplete'
}

export interface IToolInvocationStreamContext {
	toolCallId: string;
	rawInput: unknown;
	chatRequestId?: string;
	chatSessionResource?: URI;
	chatInteractionId?: string;
}

export interface IStreamedToolInvocation {
	invocationMessage?: string | IMarkdownString;
}

export interface IPreparedToolInvocation {
	invocationMessage?: string | IMarkdownString;
	pastTenseMessage?: string | IMarkdownString;
	originMessage?: string | IMarkdownString;
	confirmationMessages?: IToolConfirmationMessages;
	presentation?: ToolInvocationPresentation;
	icon?: ThemeIcon;
	toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData | IChatSessionCreatedData | IChatGeneratedImageData | IChatAutomationConfigurationData | IChatAutomationConfiguredData;
}

export interface IToolImpl {
	invoke(invocation: IToolInvocation, countTokens: CountTokensCallback, progress: ToolProgress, token: CancellationToken): Promise<IToolResult>;
	prepareToolInvocation?(context: IToolInvocationPreparationContext, token: CancellationToken): Promise<IPreparedToolInvocation | undefined>;
	handleToolStream?(context: IToolInvocationStreamContext, token: CancellationToken): Promise<IStreamedToolInvocation | undefined>;
}

export interface IToolSet {
	readonly id: string;
	readonly referenceName: string;
	readonly icon: ThemeIcon;
	readonly source: ToolDataSource;
	readonly description?: string;
	readonly detail?: string;
	readonly legacyFullNames?: string[];
	readonly deprecated?: boolean;
	readonly hiddenInToolsPicker?: boolean;

	getTools(r?: IReader): Iterable<IToolData>;
}



export class ToolAndToolSetEnablementMap implements Iterable<[IToolData | IToolSet, boolean]> {

	static fromEntries(entries: Iterable<[IToolData | IToolSet, boolean]>): ToolAndToolSetEnablementMap {
		return new ToolAndToolSetEnablementMap(new Map(entries));
	}

	static fromMap(map: Map<IToolData | IToolSet, boolean>): ToolAndToolSetEnablementMap {
		return new ToolAndToolSetEnablementMap(new Map(map));
	}

	private constructor(private readonly _map: Map<IToolData | IToolSet, boolean>) {
	}

	[Symbol.iterator](): IterableIterator<[IToolData | IToolSet, boolean]> {
		return this._map[Symbol.iterator]();
	}

	public get(toolOrToolSet: IToolData | IToolSet): boolean | undefined {
		return this._map.get(toolOrToolSet);
	}

	public has(toolOrToolSet: IToolData | IToolSet): boolean {
		return this._map.has(toolOrToolSet);
	}

	public get size(): number {
		return this._map.size;
	}

	public entries(): IterableIterator<[IToolData | IToolSet, boolean]> {
		return this._map.entries();
	}
}

export function isToolSet(obj: IToolData | IToolSet | undefined): obj is IToolSet {
	return !!obj && (obj as IToolSet).getTools !== undefined;
}

export class ToolSet implements IToolSet {

	protected readonly _tools = new ObservableSet<IToolData>();

	protected readonly _toolSets = new ObservableSet<IToolSet>();

	readonly isHomogenous: IObservable<boolean>;

	constructor(
		readonly id: string,
		readonly referenceName: string,
		readonly icon: ThemeIcon,
		readonly source: ToolDataSource,
		readonly description: string | undefined,
		readonly detail: string | undefined,
		readonly legacyFullNames: string[] | undefined,
		readonly deprecated: boolean | undefined,
		readonly hiddenInToolsPicker: boolean | undefined,
		private readonly _contextKeyService: IContextKeyService,
	) {

		this.isHomogenous = derived(r => {
			return !Iterable.some(this._tools.observable.read(r), tool => !ToolDataSource.equals(tool.source, this.source))
				&& !Iterable.some(this._toolSets.observable.read(r), toolSet => !ToolDataSource.equals(toolSet.source, this.source));
		});
	}

	addTool(data: IToolData, tx?: ITransaction): IDisposable {
		this._tools.add(data, tx);
		return toDisposable(() => {
			this._tools.delete(data);
		});
	}

	addToolSet(toolSet: IToolSet, tx?: ITransaction): IDisposable {
		if (toolSet === this) {
			return Disposable.None;
		}
		this._toolSets.add(toolSet, tx);
		return toDisposable(() => {
			this._toolSets.delete(toolSet);
		});
	}

	getTools(r?: IReader): Iterable<IToolData> {
		return Iterable.concat(
			Iterable.filter(this._tools.observable.read(r), toolData => this._contextKeyService.contextMatchesRules(toolData.when)),
			...Iterable.map(this._toolSets.observable.read(r), toolSet => toolSet.getTools(r))
		);
	}
}

export class ToolSetForModel {
	public get id() {
		return this._toolSet.id;
	}

	public get referenceName() {
		return this._toolSet.referenceName;
	}

	public get icon() {
		return this._toolSet.icon;
	}

	public get source() {
		return this._toolSet.source;
	}

	public get description() {
		return this._toolSet.description;
	}

	public get detail() {
		return this._toolSet.detail;
	}

	public get legacyFullNames() {
		return this._toolSet.legacyFullNames;
	}

	public get deprecated() {
		return this._toolSet.deprecated;
	}

	public get hiddenInToolsPicker() {
		return this._toolSet.hiddenInToolsPicker;
	}

	constructor(
		private readonly _toolSet: IToolSet,
		private readonly model: ILanguageModelChatMetadata | undefined,
		private readonly toolFilter?: (toolData: IToolData) => boolean,
	) { }

	public getTools(r?: IReader): Iterable<IToolData> {
		return Iterable.filter(this._toolSet.getTools(r), toolData => toolMatchesModel(toolData, this.model) && (!this.toolFilter || this.toolFilter(toolData)));
	}
}


export interface IBeginToolCallOptions {
	toolCallId: string;
	toolId: string;
	chatRequestId?: string;
	sessionResource?: URI;
	subagentInvocationId?: string;
	force?: boolean;
}

export interface IToolInvokedEvent {
	readonly toolId: string;
	readonly sessionResource: URI | undefined;
	readonly requestId: string | undefined;
	readonly subagentInvocationId: string | undefined;
}

export const ILanguageModelToolsService = createDecorator<ILanguageModelToolsService>('ILanguageModelToolsService');

export type CountTokensCallback = (input: string, token: CancellationToken) => Promise<number>;

export interface ILanguageModelToolsService {
	_serviceBrand: undefined;
	readonly vscodeToolSet: ToolSet;
	readonly executeToolSet: ToolSet;
	readonly readToolSet: ToolSet;
	readonly agentToolSet: ToolSet;
	readonly onDidChangeTools: Event<void>;
	readonly onDidPrepareToolCallBecomeUnresponsive: Event<{ readonly sessionResource: URI; readonly toolData: IToolData }>;
	readonly onDidInvokeTool: Event<IToolInvokedEvent>;
	registerToolData(toolData: IToolData): IDisposable;
	registerToolImplementation(id: string, tool: IToolImpl): IDisposable;
	registerTool(toolData: IToolData, tool: IToolImpl): IDisposable;

	getTools(model: ILanguageModelChatMetadata | undefined): Iterable<IToolData>;

	observeTools(model: ILanguageModelChatMetadata | undefined): IObservable<readonly IToolData[]>;

	getAllToolsIncludingDisabled(): Iterable<IToolData>;

	getTool(id: string): IToolData | undefined;

	getToolByName(name: string): IToolData | undefined;

	beginToolCall(options: IBeginToolCallOptions): IChatToolInvocation | undefined;

	updateToolStream(toolCallId: string, partialInput: unknown, token: CancellationToken): Promise<void>;

	invokeTool(invocation: IToolInvocation, countTokens: CountTokensCallback, token: CancellationToken): Promise<IToolResult>;
	cancelToolCallsForRequest(requestId: string): void;
	flushToolUpdates(): void;

	readonly toolSets: IObservable<Iterable<IToolSet>>;
	getToolSetsForModel(model: ILanguageModelChatMetadata | undefined, reader?: IReader): Iterable<IToolSet>;
	getToolSet(id: string): IToolSet | undefined;
	getToolSetByName(name: string): IToolSet | undefined;
	createToolSet(source: ToolDataSource, id: string, referenceName: string, options?: { icon?: ThemeIcon; description?: string; detail?: string; legacyFullNames?: string[]; deprecated?: boolean; hiddenInToolsPicker?: boolean }): ToolSet & IDisposable;

	getFullReferenceNames(): Iterable<string>;
	getFullReferenceName(tool: IToolData | IToolSet, toolSet?: IToolSet): string;
	getFullReferenceNameMap(): Map<IToolData | IToolSet, string>;
	getToolByFullReferenceName(fullReferenceName: string): IToolData | IToolSet | undefined;
	getDeprecatedFullReferenceNames(): Map<string, Set<string>>;

	toToolAndToolSetEnablementMap(fullReferenceNames: readonly string[], model: ILanguageModelChatMetadata | undefined): ToolAndToolSetEnablementMap;

	toFullReferenceNames(map: ToolAndToolSetEnablementMap): string[];
	toToolReferences(variableReferences: readonly IVariableReference[]): ChatRequestToolReferenceEntry[];
}


export function createToolInputUri(toolCallId: string): URI {
	return URI.from({ scheme: Schemas.inMemory, path: `/lm/tool/${toolCallId}/tool_input.json` });
}

export function createToolSchemaUri(toolOrId: IToolData | string): URI {
	if (typeof toolOrId !== 'string') {
		toolOrId = toolOrId.id;
	}
	return URI.from({ scheme: Schemas.vscode, authority: 'schemas', path: `/lm/tool/${toolOrId}` });
}

export namespace SpecedToolAliases {
	export const execute = 'execute';
	export const edit = 'edit';
	export const search = 'search';
	export const agent = 'agent';
	export const read = 'read';
	export const web = 'web';
	export const todo = 'todo';
}

export namespace VSCodeToolReference {
	export const runSubagent = 'runSubagent';
	export const vscode = 'vscode';

}
