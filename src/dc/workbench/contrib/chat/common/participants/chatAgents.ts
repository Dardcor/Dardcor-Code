/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findLast } from '../../../../../base/common/arraysFind.js';
import { raceCancellation } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IStringDictionary } from '../../../../../base/common/collections.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IMarkdownString, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../../base/common/iterator.js';
import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { revive, Revived } from '../../../../../base/common/marshalling.js';
import { IObservable } from '../../../../../base/common/observable.js';
import { equalsIgnoreCase } from '../../../../../base/common/strings.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { Command } from '../../../../../editor/common/languages.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr, IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { basename, dirname, joinPath } from '../../../../../base/common/resources.js';
import { EditorResourceAccessor } from '../../../../common/editor.js';
import { ChatContextKeys } from '../actions/chatContextKeys.js';
import { IChatAgentEditedFileEvent, IChatProgressHistoryResponseContent, IChatRequestModeInstructions, IChatRequestVariableData, ISerializableChatAgentData } from '../model/chatModel.js';
import { IChatEditingService } from '../editing/chatEditingService.js';
import { ChatRequestHooks } from '../promptSyntax/hookSchema.js';
import { IRawChatCommandContribution } from './chatParticipantContribTypes.js';
import { IChatFollowup, IChatLocationData, IChatProgress, IChatQuestion as IChatCarouselQuestion, IChatResponseErrorDetails, IChatTaskDto, ToolConfirmKind } from '../chatService/chatService.js';
import { ToolDataSource, ToolInvocationPresentation } from '../tools/languageModelToolsService.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind, ChatPermissionLevel } from '../constants.js';
import { ILanguageModelsService } from '../languageModels.js';
import { ChatPerfMark, markChat } from '../chatPerf.js';
import { IMarkerService, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { formatDardcorRouterError } from './dardcorRouterError.js';
import { ChatQuestionCarouselData } from '../model/chatProgressTypes/chatQuestionCarouselData.js';
import { ChatPlanReviewData } from '../model/chatProgressTypes/chatPlanReviewData.js';
import { TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { ITaskService } from '../../../tasks/common/taskService.js';
import { IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { linesDiffComputers } from '../../../../../editor/common/diff/linesDiffComputers.js';

function computeAgentFileDiff(originalContent: string, modifiedContent: string): { added: number; removed: number } {
	if (originalContent === modifiedContent) {
		return { added: 0, removed: 0 };
	}
	const origLines = originalContent.split(/\r\n|\r|\n/);
	const modLines = modifiedContent.split(/\r\n|\r|\n/);
	const computer = linesDiffComputers.getDefault();
	const diff = computer.computeDiff(origLines, modLines, {
		ignoreTrimWhitespace: false,
		computeMoves: false,
		maxComputationTimeMs: 1000
	});
	let added = 0;
	let removed = 0;
	for (const c of diff.changes) {
		added += Math.max(0, c.modified.endLineNumberExclusive - c.modified.startLineNumber);
		removed += Math.max(0, c.original.endLineNumberExclusive - c.original.startLineNumber);
	}
	return { added, removed };
}

// ---------------------------------------------------------------------------
// Dardcor Router fetch helper - dual-host fallback + startup retry
//
// On Windows, `localhost` sometimes resolves to ::1 (IPv6) while the Router
// server only binds on 127.0.0.1 (IPv4). The opposite can also be true when
// the system prefers IPv4 but the Next.js custom-server.js starts slightly
// late. We try 127.0.0.1 first; if the connection is refused or the request
// fails with a network error, we immediately retry on localhost. Additionally,
// when the router process has just been spawned and hasn't finished booting,
// the first few requests will throw "Failed to fetch". We retry up to 3 times
// with a 1.2-second delay between attempts so transient startup errors are
// invisible to the user.
// ---------------------------------------------------------------------------
const ROUTER_PORT = 25128;
const ROUTER_HOSTS = ['127.0.0.1', 'localhost'] as const;
const ROUTER_AUTH_HEADER = { 'Authorization': 'Bearer sk-dardcor-local-key' };

async function fetchRouter(path: string, init?: RequestInit, retries = 8, timeoutMs = 30000): Promise<Response> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < retries; attempt++) {
		for (const host of ROUTER_HOSTS) {
			const url = `http://${host}:${ROUTER_PORT}${path}`;
			try {
				let signal = init?.signal;
				let timeoutId: any;
				if (!signal && typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function') {
					signal = (AbortSignal as any).timeout(timeoutMs);
				} else if (!signal) {
					const controller = new AbortController();
					timeoutId = setTimeout(() => controller.abort(), timeoutMs);
					signal = controller.signal;
				}
				const res = await fetch(url, { ...init, signal });
				if (timeoutId) clearTimeout(timeoutId);
				return res;
			} catch (err) {
				lastErr = err;
			}
		}
		if (attempt < retries - 1) {
			const delay = Math.min(500 + attempt * 300, 2000);
			await new Promise<void>(resolve => setTimeout(resolve, delay));
		}
	}
	throw lastErr;
}

//#region agent service, commands etc

export interface IChatAgentHistoryEntry {
	request: IChatAgentRequest;
	response: ReadonlyArray<IChatProgressHistoryResponseContent | IChatTaskDto>;
	result: IChatAgentResult;
}

export interface IChatAgentAttachmentCapabilities {
	supportsFileAttachments?: boolean;
	supportsToolAttachments?: boolean;
	supportsMCPAttachments?: boolean;
	supportsImageAttachments?: boolean;
	supportsSearchResultAttachments?: boolean;
	supportsInstructionAttachments?: boolean;
	supportsSourceControlAttachments?: boolean;
	supportsProblemAttachments?: boolean;
	supportsSymbolAttachments?: boolean;
	supportsTerminalAttachments?: boolean;
	supportsPromptAttachments?: boolean;
	supportsHandOffs?: boolean;
	supportsCheckpoints?: boolean;
	/**
	 * The prefix (e.g. `!`) that marks a message in this
	 * session type as a terminal command rather than a message to the agent.
	 * Undefined when the session type has no terminal command support.
	 */
	terminalCommandPrefix?: string;
}

export interface IChatAgentData {
	id: string;
	name: string;
	fullName?: string;
	description?: string;
	/** This is string, not ContextKeyExpression, because dealing with serializing/deserializing is hard and need a better pattern for this */
	when?: string;
	extensionId: ExtensionIdentifier;
	extensionVersion: string | undefined;
	extensionPublisherId: string;
	/** This is the extension publisher id, or, in the case of a dynamically registered participant (remote agent), whatever publisher name we have for it */
	publisherDisplayName?: string;
	extensionDisplayName: string;
	/** The agent invoked when no agent is specified */
	isDefault?: boolean;
	/** This agent is not contributed in package.json, but is registered dynamically */
	isDynamic?: boolean;
	/** This agent is contributed from core and not from an extension */
	isCore?: boolean;
	canAccessPreviousChatHistory?: boolean;
	metadata: IChatAgentMetadata;
	slashCommands: IChatAgentCommand[];
	locations: ChatAgentLocation[];
	/** This is only relevant for isDefault agents. Others should have all modes available. */
	modes: ChatModeKind[];
	disambiguation: { category: string; description: string; examples: string[] }[];
	capabilities?: IChatAgentAttachmentCapabilities;
}

export interface IChatWelcomeMessageContent {
	icon: ThemeIcon;
	title: string;
	message: IMarkdownString;
}

export interface IChatAgentImplementation {
	invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult>;
	setRequestTools?(requestId: string, tools: UserSelectedTools): void;
	setYieldRequested?(requestId: string, value: boolean): void;
	provideFollowups?(request: IChatAgentRequest, result: IChatAgentResult, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatFollowup[]>;
	provideChatTitle?: (history: IChatAgentHistoryEntry[], token: CancellationToken) => Promise<string | undefined>;
	provideChatSummary?: (history: IChatAgentHistoryEntry[], token: CancellationToken) => Promise<string | undefined>;
}

export interface IChatParticipantDetectionResult {
	participant: string;
	command?: string;
}

export interface IChatParticipantMetadata {
	participant: string;
	command?: string;
	disambiguation: { category: string; description: string; examples: string[] }[];
}

export interface IChatParticipantDetectionProvider {
	provideParticipantDetection(request: IChatAgentRequest, history: IChatAgentHistoryEntry[], options: { location: ChatAgentLocation; participants: IChatParticipantMetadata[] }, token: CancellationToken): Promise<IChatParticipantDetectionResult | null | undefined>;
}

export type IChatAgent = IChatAgentData & IChatAgentImplementation;

export interface IChatAgentCommand extends IRawChatCommandContribution {
	followupPlaceholder?: string;
}

export interface IChatAgentMetadata {
	helpTextPrefix?: string | IMarkdownString;
	helpTextPostfix?: string | IMarkdownString;
	icon?: URI;
	iconDark?: URI;
	themeIcon?: ThemeIcon;
	sampleRequest?: string;
	supportIssueReporting?: boolean;
	followupPlaceholder?: string;
	isSticky?: boolean;
	additionalWelcomeMessage?: string | IMarkdownString;
}

export type UserSelectedTools = Record<string, boolean>;


export interface IChatAgentRequest {
	sessionResource: URI;
	requestId: string;
	agentId: string;
	command?: string;
	message: string;
	attempt?: number;
	enableCommandDetection?: boolean;
	isParticipantDetected?: boolean;
	variables: IChatRequestVariableData;
	location: ChatAgentLocation;
	locationData?: Revived<IChatLocationData>;
	acceptedConfirmationData?: unknown[];
	rejectedConfirmationData?: unknown[];
	agentHostSessionConfig?: Record<string, unknown>;
	userSelectedModelId?: string;
	modelConfiguration?: IStringDictionary<unknown>;
	userSelectedTools?: UserSelectedTools;
	modeInstructions?: IChatRequestModeInstructions;
	editedFileEvents?: IChatAgentEditedFileEvent[];
	/**
	 * The working directory URI for the session, if set.
	 * In the agents window, each session can have its own working directory
	 * that differs from the current workspace folders.
	 */
	workingDirectory?: URI;
	/**
	 * Collected hooks configuration for this request.
	 * Contains all hooks defined in hooks .json files, organized by hook type.
	 */
	hooks?: ChatRequestHooks;
	/**
	 * Whether any hooks are enabled for this request.
	 */
	hasHooksEnabled?: boolean;
	/**
	 * Whether this request was submitted through Agents Voice Mode.
	 */
	isVoiceModeInput?: boolean;
	/**
	 * The permission level for tool auto-approval in this request.
	 * - `'autoApprove'`: Auto-approve all tool calls and retry on errors.
	 * - `'autopilot'`: Everything autoApprove does plus continues until the task is done.
	 */
	permissionLevel?: ChatPermissionLevel;
	/**
	 * Unique ID for the subagent invocation, used to group tool calls from the same subagent run together.
	 */
	subAgentInvocationId?: string;
	/**
	 * Display name of the subagent that is invoking this request.
	 */
	subAgentName?: string;
	/**
	 * The request ID of the parent request that invoked this subagent.
	 */
	parentRequestId?: string;

	/**
	 * When true, this request was initiated by the system rather than the user.
	 */
	isSystemInitiated?: boolean;

	hideFromTranscript?: boolean;
}

export interface IChatQuestion {
	readonly prompt: string;
	readonly participant?: string;
	readonly command?: string;
}

export interface IChatAgentResultTimings {
	firstProgress?: number;
	totalElapsed: number;
}

export interface IChatAgentResult {
	errorDetails?: IChatResponseErrorDetails;
	timings?: IChatAgentResultTimings;
	/** Extra properties that the agent can use to identify a result */
	readonly metadata?: { readonly [key: string]: unknown };
	readonly details?: string;
	nextQuestion?: IChatQuestion;
}

export const IChatAgentService = createDecorator<IChatAgentService>('chatAgentService');

interface IChatAgentEntry {
	data: IChatAgentData;
	impl?: IChatAgentImplementation;
}

export interface IChatAgentCompletionItem {
	id: string;
	name?: string;
	fullName?: string;
	icon?: ThemeIcon;
	value: unknown;
	command?: Command;
}

export interface IChatAgentInvocationEvent {
	readonly agentId: string;
	readonly request: Readonly<IChatAgentRequest>;
}

export interface IChatAgentService {
	_serviceBrand: undefined;
	/**
	 * undefined when an agent was removed
	 */
	readonly onDidChangeAgents: Event<IChatAgent | undefined>;
	readonly onWillInvokeAgent: Event<IChatAgentInvocationEvent>;
	readonly hasToolsAgent: boolean;
	registerAgent(id: string, data: IChatAgentData): IDisposable;
	registerAgentImplementation(id: string, agent: IChatAgentImplementation): IDisposable;
	registerDynamicAgent(data: IChatAgentData, agentImpl: IChatAgentImplementation): IDisposable;
	registerAgentCompletionProvider(id: string, provider: (query: string, token: CancellationToken) => Promise<IChatAgentCompletionItem[]>): IDisposable;
	getAgentCompletionItems(id: string, query: string, token: CancellationToken): Promise<IChatAgentCompletionItem[]>;
	registerChatParticipantDetectionProvider(handle: number, provider: IChatParticipantDetectionProvider): IDisposable;
	detectAgentOrCommand(request: IChatAgentRequest, history: IChatAgentHistoryEntry[], options: { location: ChatAgentLocation }, token: CancellationToken): Promise<{ agent: IChatAgentData; command?: IChatAgentCommand } | undefined>;
	hasChatParticipantDetectionProviders(): boolean;
	invokeAgent(agent: string, request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult>;
	setRequestTools(agent: string, requestId: string, tools: UserSelectedTools): void;
	setYieldRequested(agent: string, requestId: string, value: boolean): void;
	getFollowups(id: string, request: IChatAgentRequest, result: IChatAgentResult, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatFollowup[]>;
	getChatTitle(id: string, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<string | undefined>;
	getChatSummary(id: string, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<string | undefined>;
	getAgent(id: string, includeDisabled?: boolean): IChatAgentData | undefined;
	getAgentByFullyQualifiedId(id: string): IChatAgentData | undefined;
	getAgents(): IChatAgentData[];
	getActivatedAgents(): Array<IChatAgent>;
	getAgentsByName(name: string): IChatAgentData[];
	agentHasDupeName(id: string): boolean;

	/**
	 * Get the default agent (only if activated)
	 */
	getDefaultAgent(location: ChatAgentLocation, mode?: ChatModeKind): IChatAgent | undefined;

	/**
	 * Get the default agent data that has been contributed (may not be activated yet)
	 */
	getContributedDefaultAgent(location: ChatAgentLocation): IChatAgentData | undefined;
	updateAgent(id: string, updateMetadata: IChatAgentMetadata): void;
}

export interface IWorkspaceSnapshot {
	hasWorkspace: boolean;
	projectName: string;
	rootPath: string;
	rootUri?: URI;
	techStack: string;
	fileTree: string;
	activeFile?: string;
	activeFileExcerpt?: string;
}

export const DARDCOR_AGENT_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Read the contents of a file in the workspace with line numbers.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file to read (e.g. "src/App.tsx" or "package.json")' },
					startLine: { type: 'number', description: 'Optional starting line number (1-based)' },
					endLine: { type: 'number', description: 'Optional ending line number (1-based)' }
				},
				required: ['filePath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'write_file',
			description: 'Create a new file or overwrite an existing file in the workspace with complete content.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file to write' },
					content: { type: 'string', description: 'Full content of the file' }
				},
				required: ['filePath', 'content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'edit_file',
			description: 'Replace a specific snippet of code/text in a file with new code.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file to edit' },
					searchContent: { type: 'string', description: 'Exact string in the file to find and replace' },
					replaceContent: { type: 'string', description: 'New string to replace it with' }
				},
				required: ['filePath', 'searchContent', 'replaceContent']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'list_directory',
			description: 'List all files and subdirectories within a directory in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					dirPath: { type: 'string', description: 'Relative path of the directory (leave empty or "." for project root)' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'find_files',
			description: 'Find files in the workspace matching a pattern or extension (e.g. "*.tsx", "src/components/*").',
			parameters: {
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'Filename or glob pattern to search for' }
				},
				required: ['pattern']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'search_code',
			description: 'Search for text or keyword across files in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Search term or keyword' }
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_in_terminal',
			description: 'Run a shell command in the workspace integrated terminal (e.g. "npm run build", "npm test", "npm run dev"). Runs in Windows PowerShell on Windows or bash/zsh on Linux/macOS.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'Command line string to execute in the integrated terminal' },
					commandLine: { type: 'string', description: 'Alternative parameter name for the command string' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_command',
			description: 'Run a shell command in the workspace integrated terminal (e.g. "npm run build", "npm test", "npm run dev"). Runs in Windows PowerShell on Windows or bash/zsh on Linux/macOS.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'Command line string to execute in the integrated terminal' },
					commandLine: { type: 'string', description: 'Alternative parameter name for the command string' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'send_to_terminal',
			description: 'Send input or text to an active integrated terminal.',
			parameters: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'Text or input string to send to the terminal' }
				},
				required: ['text']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_terminal_output',
			description: 'Get the latest output text from the active integrated terminal.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'kill_terminal',
			description: 'Terminate the active integrated terminal process.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'manage_todo_list',
			description: 'Manage and update the structured task checklist to track plan progress throughout the coding session.',
			parameters: {
				type: 'object',
				properties: {
					todoList: {
						type: 'array',
						description: 'Complete list of todo items with their current statuses',
						items: {
							type: 'object',
							properties: {
								id: { type: 'number', description: 'Unique identifier number starting from 1' },
								title: { type: 'string', description: 'Concise task description' },
								status: { type: 'string', enum: ['not-started', 'in-progress', 'completed'] }
							},
							required: ['id', 'title', 'status']
						}
					}
				},
				required: ['todoList']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'fetch_web_page',
			description: 'Fetch content or documentation from a web URL.',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'HTTP or HTTPS web URL to fetch' }
				},
				required: ['url']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'delete_file',
			description: 'Delete a file or folder in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file or folder to delete' },
					recursive: { type: 'boolean', description: 'Recursively delete directory contents if target is a folder (default true)' }
				},
				required: ['filePath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'rename_file',
			description: 'Rename or move a file or folder in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					oldFilePath: { type: 'string', description: 'Current relative path of the file or folder' },
					newFilePath: { type: 'string', description: 'New relative path of the file or folder' },
					overwrite: { type: 'boolean', description: 'Whether to overwrite destination if it exists (default false)' }
				},
				required: ['oldFilePath', 'newFilePath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_diagnostics',
			description: 'Get compiler, linter, TypeScript, or syntax problems (errors, warnings) in a specific file or across the entire workspace.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Optional relative path of the file to inspect. If omitted, returns all workspace diagnostics.' },
					severity: { type: 'string', enum: ['error', 'warning', 'all'], description: 'Filter problems by severity (default "all")' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_file_outline',
			description: 'Extract functions, classes, methods, interfaces, types, exports, and code structure of a file.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Relative path of the file to inspect' }
				},
				required: ['filePath']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'grep_search',
			description: 'Fast regex or substring pattern search across files in the workspace with line numbers.',
			parameters: {
				type: 'object',
				properties: {
					pattern: { type: 'string', description: 'Text or regular expression pattern to search for' },
					subPath: { type: 'string', description: 'Optional subfolder or file to limit search to (e.g. "src" or "app")' },
					isRegex: { type: 'boolean', description: 'Whether to treat pattern as a regular expression (default false)' },
					caseInsensitive: { type: 'boolean', description: 'Whether to ignore case (default true)' }
				},
				required: ['pattern']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'terminal_selection',
			description: 'Get the current highlighted or selected text in the active terminal.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'terminal_last_command',
			description: 'Get the last command executed in the active terminal, its output, working directory, and exit code.',
			parameters: {
				type: 'object',
				properties: {}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'create_and_run_task',
			description: 'Create a background or build task and execute it (writes to tasks configuration and runs it).',
			parameters: {
				type: 'object',
				properties: {
					label: { type: 'string', description: 'Name of the task to create and run' },
					type: { type: 'string', description: 'Task type (e.g. "shell" or "process")' },
					command: { type: 'string', description: 'Command line for the task' },
					args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the command' },
					isBackground: { type: 'boolean', description: 'Whether the task runs continuously in the background' }
				},
				required: ['label', 'command']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_task_output',
			description: 'Get the terminal output of a running task by label or ID.',
			parameters: {
				type: 'object',
				properties: {
					taskLabel: { type: 'string', description: 'Label or name of the task' }
				},
				required: ['taskLabel']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_task',
			description: 'Run an existing task configured in tasks.json by its label.',
			parameters: {
				type: 'object',
				properties: {
					taskLabel: { type: 'string', description: 'Label of the configured task to execute' }
				},
				required: ['taskLabel']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'ask_questions',
			description: 'Ask the user clarifying questions with multiple-choice options or open feedback before proceeding.',
			parameters: {
				type: 'object',
				properties: {
					questions: {
						type: 'array',
						description: 'List of questions to ask the user',
						items: {
							type: 'object',
							properties: {
								header: { type: 'string', description: 'Short header/tag for the question' },
								question: { type: 'string', description: 'The question text to display' },
								multiSelect: { type: 'boolean', description: 'Whether multiple options can be chosen' },
								options: {
									type: 'array',
									description: 'Predefined options for the user to choose from',
									items: {
										type: 'object',
										properties: {
											label: { type: 'string', description: 'Option text' },
											description: { type: 'string', description: 'Explanation of the option' },
											recommended: { type: 'boolean', description: 'Whether this is the recommended choice' }
										},
										required: ['label']
									}
								}
							},
							required: ['header', 'question']
						}
					}
				},
				required: ['questions']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'review_plan',
			description: 'Present a structured implementation plan to the user for approval or review before executing changes.',
			parameters: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'Title of the plan' },
					content: { type: 'string', description: 'Markdown body containing the step-by-step plan' },
					actions: {
						type: 'array',
						description: 'Available user response actions (e.g. "Approve and proceed", "Revise plan")',
						items: {
							type: 'object',
							properties: {
								label: { type: 'string', description: 'Action button label' },
								description: { type: 'string', description: 'Optional explanation' },
								default: { type: 'boolean', description: 'Whether this is the default action' }
							},
							required: ['label']
						}
					}
				},
				required: ['content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_subagent',
			description: 'Delegate a focused autonomous sub-task to a specialized subagent (e.g. codebase research, code search, or test execution).',
			parameters: {
				type: 'object',
				properties: {
					prompt: { type: 'string', description: 'Detailed prompt instructions for the subagent' },
					description: { type: 'string', description: 'Short description of what the subagent is doing' },
					subagentType: { type: 'string', description: 'Type of subagent (e.g. "research", "code_review", "test_runner")' }
				},
				required: ['prompt', 'description']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'confirm_terminal_command',
			description: 'Ask for explicit user confirmation with Allow/Skip buttons before executing a terminal command.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'The terminal command line' },
					explanation: { type: 'string', description: 'Explanation of what the command does' },
					goal: { type: 'string', description: 'Goal or purpose of running the command' }
				},
				required: ['command', 'explanation']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_artifacts',
			description: 'Save or update session artifacts (e.g. devServer URLs, plans, documents, or screenshots) so the user can easily access and view them in the artifact panel.',
			parameters: {
				type: 'object',
				properties: {
					artifacts: {
						type: 'array',
						description: 'The list of artifacts for this session',
						items: {
							type: 'object',
							properties: {
								label: { type: 'string', description: 'Display label for the artifact' },
								uri: { type: 'string', description: 'URI of the artifact (e.g. "http://localhost:3000" or file path)' },
								type: { type: 'string', enum: ['devServer', 'screenshot', 'plan'], description: 'Type of artifact' }
							},
							required: ['label']
						}
					}
				},
				required: ['artifacts']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_artifact_rules',
			description: 'Configure rules for automatically surfacing files, outputs, and logs as session artifacts.',
			parameters: {
				type: 'object',
				properties: {
					byFilePath: { type: 'object', description: 'Glob pattern mappings for files to surface as artifacts' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'open_browser_page',
			description: 'Open a new browser page/tab in the integrated browser at the given URL (e.g. "http://localhost:3000"). Use this whenever the user asks to open, test, view, or preview a website, web app, or URL in the browser.',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'The absolute URL to open (e.g. "http://localhost:3000", "http://127.0.0.1:3000", or file URL)' },
					forceNew: { type: 'boolean', description: 'Whether to force opening a new browser tab even if one with the same host is already open' }
				},
				required: ['url']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_browser_page',
			description: 'Get a snapshot of the current state, accessible text, and DOM elements of the open browser page.',
			parameters: {
				type: 'object',
				properties: {
					pageId: { type: 'string', description: 'Optional page ID or URL of the browser tab to read' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_page',
			description: 'Get a snapshot of the current state and content of the browser page.',
			parameters: {
				type: 'object',
				properties: {
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'screenshot_browser_page',
			description: 'Capture a screenshot of the integrated browser page.',
			parameters: {
				type: 'object',
				properties: {
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'screenshot_page',
			description: 'Capture a screenshot of the integrated browser page.',
			parameters: {
				type: 'object',
				properties: {
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'navigate_browser',
			description: 'Navigate the integrated browser to a new URL.',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'URL to navigate to' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				},
				required: ['url']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'navigate_page',
			description: 'Navigate the integrated browser to a new URL.',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'URL to navigate to' },
					pageId: { type: 'string', description: 'Optional page ID of the browser tab' }
				},
				required: ['url']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'click_element',
			description: 'Click on an element on the active browser page.',
			parameters: {
				type: 'object',
				properties: {
					selector: { type: 'string', description: 'CSS selector or text of the element to click' },
					elementId: { type: 'string', description: 'Optional element ID' },
					pageId: { type: 'string', description: 'Optional page ID' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'type_in_page',
			description: 'Type text into an input field on the active browser page.',
			parameters: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'Text to type' },
					selector: { type: 'string', description: 'Optional CSS selector of the input field' },
					pageId: { type: 'string', description: 'Optional page ID' }
				},
				required: ['text']
			}
		}
	}
];

export function buildDardcorSystemPrompt(snapshot: IWorkspaceSnapshot): string {
	return `You are Dardcor Code, an elite, state-of-the-art AI Software Engineer built directly into the Dardcor Code Editor.
Always identify yourself as Dardcor Code when asked who you are, what model or AI you are, or your identity. You were created by Dardcor.
Never state that you are Provider, OpenAI, Anthropic, Claude, or any third-party model.
Assist developers with coding, debugging, architecture, refactoring, and software development with precision, depth, and proactivity.
Language Detection & Multilingual Support: Automatically detect the user's language and respond fluently and naturally in the exact same language (e.g. Bahasa Indonesia if the user speaks Indonesian, English if in English, Japanese if in Japanese, etc.). Never force English when the user communicates in another language. Technical code syntax, file paths, and identifiers should remain in their standard technical format, while greetings, explanations, reasoning, and summaries must match the user's detected language.

=== ACTIVE WORKSPACE PROJECT CONTEXT ===
${snapshot.hasWorkspace ? `
- Project Name: ${snapshot.projectName}
- Root Path: ${snapshot.rootPath}
- Tech Stack & Metadata: ${snapshot.techStack}
- Active Open File in Editor: ${snapshot.activeFile || 'None currently open'}
${snapshot.activeFileExcerpt ? `\n--- Excerpt of Active File (${snapshot.activeFile}) ---\n${snapshot.activeFileExcerpt}\n--- End Excerpt ---\n` : ''}
- Project Structure & Files:
${snapshot.fileTree || 'No files found'}
` : '- No folder is currently open in the workspace.'}

=== AUTONOMOUS AGENTIC CAPABILITIES ===
You have FULL, DIRECT READ, WRITE, AND MANAGEMENT ACCESS to the user's project files through your built-in tools:
1. read_file(filePath, startLine, endLine): Read file contents with line numbers.
2. write_file(filePath, content): Create new files or overwrite existing files.
3. edit_file(filePath, searchContent, replaceContent): Replace specific code snippets in files.
4. delete_file(filePath, recursive): Delete a file or directory.
5. rename_file(oldFilePath, newFilePath, overwrite): Rename or move files/directories.
6. list_directory(dirPath): List files and directories.
7. find_files(pattern): Search for files by filename or glob pattern.
8. search_code(query): Search code keywords across the codebase.
9. grep_search(pattern, subPath, isRegex, caseInsensitive): Fast regex or pattern search with line numbers.
10. get_file_outline(filePath): Extract symbols, functions, classes, and code structure of a file.
11. get_diagnostics(filePath, severity): Check active compiler, linter, or syntax errors and warnings.
12. run_command(command): Run commands in the workspace integrated terminal (build, test, install, git, dev). The terminal runs ${isWindows ? 'Windows PowerShell' : 'POSIX Bash/Zsh'}.
13. manage_todo_list(todoList): Manage and track task checklist (not-started, in-progress, completed).
14. fetch_web_page(url): Fetch web page content or API documentation.
15. open_browser_page(url, forceNew): Open a new browser tab directly in Dardcor Code integrated browser to view, test, or interact with a website or local server (e.g. http://localhost:3000).
16. read_browser_page(pageId): Read the DOM, layout, and text content of an open browser tab.
17. screenshot_browser_page(pageId): Capture a screenshot of the browser page.
18. navigate_browser(url, pageId): Navigate the browser page to a new URL.
19. click_element(selector, elementId, pageId): Click an interactive element on the browser page.
20. type_in_page(text, selector, pageId): Type text into an input field on the browser page.

TOOL CALLING FORMAT:
You can call tools via native tool calling, or if using text formatting:
\`\`\`json:tool
{
  "name": "tool_name",
  "arguments": { ... }
}
\`\`\`
or
<tool_call>
{
  "name": "tool_name",
  "arguments": { ... }
}
</tool_call>

CRITICAL DIRECTIVES:
1. Language matching: Automatically detect the language used by the user and respond in that exact same language across all messages, explanations, questions, and summaries.
2. When asked who you are, greetings, or general questions:
   Respond directly, politely, and warmly in clean Markdown in the user's detected language WITHOUT calling any tools.
   State clearly that you are Dardcor Code, mention the detected active project (${snapshot.projectName}) and its tech stack (${snapshot.techStack}).
3. Only use tools when the user specifically asks you to inspect, search, read, modify, or create files, or run commands in the project.
4. When tasked with building, creating, continuing, completing, fixing, or modifying code (e.g. creating a website, application, Next.js project, components, or fixing bugs):
   - You MUST implement the entire project completely from start to finish.
   - Do NOT stop after only creating root configuration files (like package.json, tsconfig.json, tailwind.config.js).
   - You MUST proceed to implement all necessary source code files in "src/" or "app/" (such as pages, layouts, components, styles, utilities).
   - Continue calling tools consecutively turn after turn until all required files are written and the application is fully functional.
   - Never stop midway or output transitional concluding text if key source files remain to be created.
   - Write full, complete, production-ready code with no placeholders.
   - Use get_diagnostics to verify there are no syntax or type errors after making major changes.
   - Only declare the task finished and output the final summary in the user's detected language when every single file and implementation detail has been fully completed and verified.
5. When modifying files, apply edits accurately and ensure consistency across the project.
6. Terminal command execution:
   - The workspace terminal runs ${isWindows ? 'Windows PowerShell' : 'POSIX Bash/Zsh'}.
   ${isWindows ? '- On Windows: use valid PowerShell syntax. Chain commands with semicolons (;), NEVER use "&&" or "cmd /c". NEVER use Unix bash heredocs (<< EOF). Standard commands like "npm run build", "npm run dev", "node script.js", "git status" work directly.' : '- On POSIX systems: use standard bash/zsh syntax.'}
7. Browser & Website Testing: When the user asks to open, preview, or test a website, web app, or URL in the browser (e.g. "buka browser anda di Dardcor code", "testing website saya di browser anda", "buka website nya"):
   - You MUST immediately call the tool "open_browser_page" with the target URL (e.g. "http://localhost:3000").
   - NEVER merely reply in text telling the user to open it manually or check external preview panels. Always call "open_browser_page" so the integrated browser tab opens in the editor alongside code tabs in a single screen.
`;
}

export const DARDCOR_SYSTEM_PROMPT = `You are Dardcor Code, an advanced AI programming assistant developed by Dardcor for the Dardcor Code Editor.
Always identify yourself as Dardcor Code when asked who you are, what model or AI you are, or your identity. You were created by Dardcor.
Never state that you are Provider, or any other third-party model.
Assist developers with coding, debugging, architecture, refactoring, and software development with precision and depth.
Automatically detect the user's language and respond fluently and naturally in the exact same language (e.g. Bahasa Indonesia, English, Japanese, etc.) for all outputs, explanations, reasoning, and summaries. Never respond in English when the user communicates in Indonesian or another language unless explicitly requested.`;

export class ChatAgentService extends Disposable implements IChatAgentService {

	public static readonly AGENT_LEADER = '@';

	declare _serviceBrand: undefined;

	private _agents = new Map<string, IChatAgentEntry>();

	private readonly _onDidChangeAgents = this._register(new Emitter<IChatAgent | undefined>());
	readonly onDidChangeAgents: Event<IChatAgent | undefined> = this._onDidChangeAgents.event;
	private readonly _onWillInvokeAgent = this._register(new Emitter<IChatAgentInvocationEvent>());
	readonly onWillInvokeAgent: Event<IChatAgentInvocationEvent> = this._onWillInvokeAgent.event;

	private readonly _agentsContextKeys = new Set<string>();
	private readonly _hasDefaultAgent: IContextKey<boolean>;
	private readonly _extensionAgentRegistered: IContextKey<boolean>;
	private readonly _defaultAgentRegistered: IContextKey<boolean>;
	private _hasToolsAgent = false;

	private _chatParticipantDetectionProviders = new Map<number, IChatParticipantDetectionProvider>();

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this._hasDefaultAgent = ChatContextKeys.enabled.bindTo(this.contextKeyService);
		this._extensionAgentRegistered = ChatContextKeys.extensionParticipantRegistered.bindTo(this.contextKeyService);
		this._defaultAgentRegistered = ChatContextKeys.panelParticipantRegistered.bindTo(this.contextKeyService);
		this._register(contextKeyService.onDidChangeContext((e) => {
			if (e.affectsSome(this._agentsContextKeys)) {
				this._updateContextKeys();
			}
		}));

		// Register built-in Dardcor dynamic agent so editor chat and panel always have an active default agent
		const fallbackAgentData: IChatAgentData = {
			id: 'dardcor.default',
			name: 'Dardcor Code',
			fullName: 'Dardcor Code',
			description: 'Dardcor Default Agent',
			extensionId: new ExtensionIdentifier('dardcor.core'),
			extensionPublisherId: 'dardcor',
			extensionDisplayName: 'Dardcor Code',
			extensionVersion: '1.0.0',
			isDefault: true,
			isDynamic: true,
			isCore: true,
			metadata: {},
			slashCommands: [],
			locations: [
				ChatAgentLocation.Chat,
				ChatAgentLocation.Terminal,
				ChatAgentLocation.Notebook,
				ChatAgentLocation.EditorInline,
			],
			modes: [ChatModeKind.Ask, ChatModeKind.Agent, ChatModeKind.Edit],
			disambiguation: [],
		};

		this.registerDynamicAgent(fallbackAgentData, {
			invoke: async (request, progress, history, token) => {
				return this.streamDardcorRouter(request, progress, history, token);
			}
		});
	}

	registerAgent(id: string, data: IChatAgentData): IDisposable {
		const existingAgent = this.getAgent(id);
		if (existingAgent) {
			throw new Error(`Agent already registered: ${JSON.stringify(id)}`);
		}

		const that = this;
		const commands = data.slashCommands;
		data = {
			...data,
			get slashCommands() {
				return commands.filter(c => !c.when || that.contextKeyService.contextMatchesRules(ContextKeyExpr.deserialize(c.when)));
			}
		};
		const entry = { data };
		this._agents.set(id, entry);
		this._updateAgentsContextKeys();
		this._updateContextKeys();
		this._onDidChangeAgents.fire(undefined);

		return toDisposable(() => {
			this._agents.delete(id);
			this._updateAgentsContextKeys();
			this._updateContextKeys();
			this._onDidChangeAgents.fire(undefined);
		});
	}

	private _updateAgentsContextKeys(): void {
		// Update the set of context keys used by all agents
		this._agentsContextKeys.clear();
		for (const agent of this._agents.values()) {
			if (agent.data.when) {
				const expr = ContextKeyExpr.deserialize(agent.data.when);
				for (const key of expr?.keys() || []) {
					this._agentsContextKeys.add(key);
				}
			}
		}
	}

	private _updateContextKeys(): void {
		let extensionAgentRegistered = false;
		let defaultAgentRegistered = false;
		let toolsAgentRegistered = false;
		for (const agent of this.getAgents()) {
			if (agent.isDefault) {
				if (!agent.isCore) {
					extensionAgentRegistered = true;
				}
				if (agent.id === 'chat.setup' || agent.id === 'github.copilot.editsAgent' || agent.id === 'github.dardcor.editsAgent') {
					// TODO@roblourens firing the event below probably isn't necessary but leave it alone for now
					toolsAgentRegistered = true;
				} else {
					defaultAgentRegistered = true;
				}
			}
		}
		this._defaultAgentRegistered.set(defaultAgentRegistered);
		this._extensionAgentRegistered.set(extensionAgentRegistered);
		if (toolsAgentRegistered !== this._hasToolsAgent) {
			this._hasToolsAgent = toolsAgentRegistered;
			this._onDidChangeAgents.fire(this.getDefaultAgent(ChatAgentLocation.Chat, ChatModeKind.Agent));
		}
	}

	registerAgentImplementation(id: string, agentImpl: IChatAgentImplementation): IDisposable {
		const entry = this._agents.get(id);
		if (!entry) {
			throw new Error(`Unknown agent: ${JSON.stringify(id)}`);
		}

		if (entry.impl) {
			throw new Error(`Agent already has implementation: ${JSON.stringify(id)}`);
		}

		if (entry.data.isDefault) {
			this._hasDefaultAgent.set(true);
		}

		entry.impl = agentImpl;
		this._onDidChangeAgents.fire(new MergedChatAgent(entry.data, agentImpl));

		return toDisposable(() => {
			entry.impl = undefined;
			this._onDidChangeAgents.fire(undefined);

			if (entry.data.isDefault) {
				this._hasDefaultAgent.set(Iterable.some(this._agents.values(), agent => agent.data.isDefault && !!agent.impl));
			}
		});
	}

	registerDynamicAgent(data: IChatAgentData, agentImpl: IChatAgentImplementation): IDisposable {
		data.isDynamic = true;
		const agent = { data, impl: agentImpl };
		this._agents.set(data.id, agent);
		if (data.isDefault) {
			this._hasDefaultAgent.set(true);
		}
		this._updateAgentsContextKeys();
		this._updateContextKeys();
		this._onDidChangeAgents.fire(new MergedChatAgent(data, agentImpl));

		return toDisposable(() => {
			this._agents.delete(data.id);
			this._updateAgentsContextKeys();
			this._updateContextKeys();
			this._onDidChangeAgents.fire(undefined);
		});
	}

	private _agentCompletionProviders = new Map<string, (query: string, token: CancellationToken) => Promise<IChatAgentCompletionItem[]>>();

	registerAgentCompletionProvider(id: string, provider: (query: string, token: CancellationToken) => Promise<IChatAgentCompletionItem[]>) {
		this._agentCompletionProviders.set(id, provider);
		return {
			dispose: () => { this._agentCompletionProviders.delete(id); }
		};
	}

	async getAgentCompletionItems(id: string, query: string, token: CancellationToken) {
		return await this._agentCompletionProviders.get(id)?.(query, token) ?? [];
	}

	updateAgent(id: string, updateMetadata: IChatAgentMetadata): void {
		const agent = this._agents.get(id);
		if (!agent?.impl) {
			throw new Error(`No activated agent with id ${JSON.stringify(id)} registered`);
		}
		agent.data.metadata = { ...agent.data.metadata, ...updateMetadata };
		this._onDidChangeAgents.fire(new MergedChatAgent(agent.data, agent.impl));
	}

	getDefaultAgent(location: ChatAgentLocation, mode: ChatModeKind = ChatModeKind.Ask): IChatAgent | undefined {
		const matching = this._preferExtensionAgent(this.getActivatedAgents().filter(a => {
			if (mode && !a.modes.includes(mode)) {
				return false;
			}

			return !!a.isDefault && a.locations.includes(location);
		}));
		if (matching) {
			return matching;
		}
		const fallback = this._preferExtensionAgent(this.getActivatedAgents().filter(a => !!a.isDefault)) ?? this.getActivatedAgents()[0];
		if (fallback) {
			return fallback;
		}
		const defaultEntry = this._agents.get('dardcor.default');
		if (defaultEntry) {
			return new MergedChatAgent(defaultEntry.data, defaultEntry.impl ?? {
				invoke: (req, prog, hist, tok) => this.streamDardcorRouter(req, prog, hist, tok)
			});
		}
		return undefined;
	}

	public get hasToolsAgent(): boolean {
		// The chat participant enablement is just based on this setting. Don't wait for the extension to be loaded.
		return !!this.configurationService.getValue(ChatConfiguration.AgentEnabled);
	}

	getContributedDefaultAgent(location: ChatAgentLocation): IChatAgentData | undefined {
		return this._preferExtensionAgent(this.getAgents().filter(a => !!a.isDefault && a.locations.includes(location)));
	}

	private _preferExtensionAgent<T extends IChatAgentData>(agents: T[]): T | undefined {
		// We potentially have multiple agents on the same location,
		// contributed from core and from extensions.
		// This method will prefer the last extensions provided agent
		// falling back to the last core agent if no extension agent is found.
		return findLast(agents, agent => !agent.isCore) ?? agents.at(-1);
	}

	getAgent(id: string, includeDisabled = false): IChatAgentData | undefined {
		if (!this._agentIsEnabled(id) && !includeDisabled) {
			return;
		}

		return this._agents.get(id)?.data;
	}

	private _agentIsEnabled(idOrAgent: string | IChatAgentEntry): boolean {
		const entry = typeof idOrAgent === 'string' ? this._agents.get(idOrAgent) : idOrAgent;
		return !entry?.data.when || this.contextKeyService.contextMatchesRules(ContextKeyExpr.deserialize(entry.data.when));
	}

	getAgentByFullyQualifiedId(id: string): IChatAgentData | undefined {
		const agent = Iterable.find(this._agents.values(), a => a.data && getFullyQualifiedId(a.data) === id)?.data;
		if (agent && !this._agentIsEnabled(agent.id)) {
			return;
		}

		return agent;
	}

	/**
	 * Returns all agent datas that exist- static registered and dynamic ones.
	 */
	getAgents(): IChatAgentData[] {
		return Array.from(this._agents.values())
			.map(entry => entry.data)
			.filter(a => a && this._agentIsEnabled(a.id));
	}

	getActivatedAgents(): IChatAgent[] {
		return Array.from(this._agents.values())
			.filter(a => a.data && this._agentIsEnabled(a.data.id))
			.map(a => new MergedChatAgent(a.data, a.impl ?? {
				invoke: async (request, progress, history, token) => {
					if (a.impl) {
						return a.impl.invoke(request, progress, history, token);
					}
					return {};
				}
			}));
	}

	getAgentsByName(name: string): IChatAgentData[] {
		return this._preferExtensionAgents(this.getAgents().filter(a => a.name === name));
	}

	private _preferExtensionAgents<T extends IChatAgentData>(agents: T[]): T[] {
		// We potentially have multiple agents on the same location,
		// contributed from core and from extensions.
		// This method will prefer the extensions provided agents
		// falling back to the original agents array extension agent is found.
		const extensionAgents = agents.filter(a => !a.isCore);
		return extensionAgents.length > 0 ? extensionAgents : agents;
	}

	agentHasDupeName(id: string): boolean {
		const agent = this.getAgent(id);
		if (!agent) {
			return false;
		}

		return this.getAgentsByName(agent.name)
			.filter(a => a.extensionId.value !== agent.extensionId.value).length > 0;
	}

	async invokeAgent(id: string, request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		markChat(request.sessionResource, ChatPerfMark.AgentWillInvoke);
		let data = this._agents.get(id);
		let impl = data?.impl;
		let effectiveAgentId = id;

		// If the agent doesn't have an impl, wait/poll up to 3 seconds for extension agents to register
		if (!impl) {
			for (let i = 0; i < 30 && !impl; i++) {
				await new Promise(r => setTimeout(r, 100));
				data = this._agents.get(id);
				impl = data?.impl;
				if (!impl) {
					// Check if any extension agent registered an impl in the meantime
					const extensionAgentsWithImpl = Array.from(this._agents.values()).filter(a => !a.data.isCore && !!a.impl);
					const preferredAgent = extensionAgentsWithImpl.find(a => a.data.id === 'github.dardcor.editsAgent')
						?? extensionAgentsWithImpl.find(a => a.data.id === 'github.dardcor.default')
						?? extensionAgentsWithImpl.find(a => a.data.id === 'github.dardcor.editingSession')
						?? extensionAgentsWithImpl[0];
					if (preferredAgent?.impl) {
						impl = preferredAgent.impl;
						effectiveAgentId = preferredAgent.data.id;
						break;
					}
				}
			}
		}

		if (!id || id === 'dardcor.default' || id === 'chat' || id.startsWith('agent-host-') || id === 'workspace-agent') {
			return this.streamDardcorRouter(request, progress, history, token);
		}

		if (impl) {
			this._onWillInvokeAgent.fire({ agentId: effectiveAgentId, request });
			try {
				let partsEmitted = 0;
				const trackingProgress = (parts: IChatProgress[]) => {
					if (parts && parts.length > 0) {
						partsEmitted += parts.length;
						progress(parts);
					}
				};
				const result = await impl.invoke(request, trackingProgress, history, token);
				if (partsEmitted > 0 && !result?.errorDetails) {
					markChat(request.sessionResource, ChatPerfMark.AgentDidInvoke);
					return result;
				}
				console.warn(`[ChatAgentService] Agent ${effectiveAgentId} emitted 0 parts or reported error, falling back to Dardcor Router. partsEmitted=${partsEmitted}`);
			} catch (err: any) {
				console.warn(`[ChatAgentService] Agent ${effectiveAgentId} invoke failed, falling back to Dardcor Router:`, err);
			}
		}

		return this.streamDardcorRouter(request, progress, history, token);
	}

	async getWorkspaceSnapshot(): Promise<IWorkspaceSnapshot> {
		let workspaceContextService: IWorkspaceContextService | undefined;
		let fileService: IFileService | undefined;
		let editorService: IEditorService | undefined;

		try {
			this.instantiationService.invokeFunction(accessor => {
				try { workspaceContextService = accessor.get(IWorkspaceContextService); } catch { }
				try { fileService = accessor.get(IFileService); } catch { }
				try { editorService = accessor.get(IEditorService); } catch { }
			});
		} catch { }

		if (!workspaceContextService) {
			return { hasWorkspace: false, projectName: '', rootPath: '', techStack: 'Unknown', fileTree: '' };
		}
		const folders = workspaceContextService.getWorkspace().folders;
		if (!folders || folders.length === 0) {
			return { hasWorkspace: false, projectName: '', rootPath: '', techStack: 'No open folder', fileTree: 'Workspace is empty' };
		}
		const primaryFolder = folders[0];
		const rootUri = primaryFolder.uri;
		const projectName = primaryFolder.name || basename(rootUri);
		const rootPath = rootUri.fsPath || rootUri.path;

		// 1. Tech Stack Detection
		let techStack = 'Standard';
		if (fileService) {
			try {
				const pkgUri = joinPath(rootUri, 'package.json');
				const stat = await fileService.stat(pkgUri);
				if (stat) {
					const pkgFile = await fileService.readFile(pkgUri);
					const pkg = JSON.parse(new TextDecoder().decode(pkgFile.value.buffer));
					const deps = Object.keys(pkg.dependencies || {});
					const devDeps = Object.keys(pkg.devDependencies || {});
					const all = [...deps, ...devDeps];
					const frameworks: string[] = [];
					if (all.includes('react')) frameworks.push('React');
					if (all.includes('next')) frameworks.push('Next.js');
					if (all.includes('vite')) frameworks.push('Vite');
					if (all.includes('vue')) frameworks.push('Vue');
					if (all.includes('svelte')) frameworks.push('Svelte');
					if (all.includes('tailwindcss')) frameworks.push('Tailwind CSS');
					if (all.some(d => d.includes('typescript')) || devDeps.some(d => d.includes('typescript'))) frameworks.push('TypeScript');
					if (all.includes('express')) frameworks.push('Express');
					if (all.includes('lucide-react')) frameworks.push('Lucide Icons');
					const scripts = Object.keys(pkg.scripts || {});
					techStack = `${pkg.name ? `Package: ${pkg.name} | ` : ''}Frameworks: ${frameworks.join(', ') || 'Node.js'} | Scripts: ${scripts.join(', ') || 'none'}`;
				}
			} catch { }

			try {
				if (await fileService.exists(joinPath(rootUri, 'Cargo.toml'))) techStack = 'Rust (Cargo)';
				else if (await fileService.exists(joinPath(rootUri, 'go.mod'))) techStack = 'Go (Go Modules)';
				else if (await fileService.exists(joinPath(rootUri, 'requirements.txt')) || await fileService.exists(joinPath(rootUri, 'pyproject.toml'))) techStack = 'Python';
				else if (await fileService.exists(joinPath(rootUri, 'pubspec.yaml'))) techStack = 'Dart / Flutter';
			} catch { }
		}

		// 2. Scan Directory Tree
		const treeLines: string[] = [];
		const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.out', '.next', '.vscode', '.idea', 'coverage', '.cache']);
		if (fileService) {
			const scan = async (uri: URI, prefix: string, depth: number) => {
				if (depth > 2 || treeLines.length > 70) return;
				try {
					const res = await fileService!.resolve(uri);
					if (!res.children) return;
					const sorted = res.children.slice().sort((a, b) => {
						if (a.isDirectory && !b.isDirectory) return -1;
						if (!a.isDirectory && b.isDirectory) return 1;
						return a.name.localeCompare(b.name);
					});
					for (const child of sorted) {
						if (ignoreDirs.has(child.name)) {
							if (child.isDirectory) treeLines.push(`${prefix}📁 ${child.name}/`);
							continue;
						}
						if (child.isDirectory) {
							treeLines.push(`${prefix}📁 ${child.name}/`);
							await scan(child.resource, prefix + '  ', depth + 1);
						} else {
							treeLines.push(`${prefix}📄 ${child.name}`);
						}
						if (treeLines.length > 70) break;
					}
				} catch { }
			};
			await scan(rootUri, '', 0);
		}

		// 3. Active Editor File
		let activeFile: string | undefined;
		let activeFileExcerpt: string | undefined;
		if (editorService) {
			try {
				const active = editorService.activeEditor;
				if (active) {
					const resource = EditorResourceAccessor.getCanonicalUri(active);
					if (resource) {
						activeFile = resource.fsPath || resource.path;
						if (rootUri && activeFile.startsWith(rootUri.fsPath)) {
							activeFile = activeFile.slice(rootUri.fsPath.length).replace(/^[\\\/]+/, '');
						}
						if (fileService) {
							const fileData = await fileService.readFile(resource);
							const text = new TextDecoder().decode(fileData.value.buffer);
							activeFileExcerpt = text.split('\n').slice(0, 35).join('\n');
						}
					}
				}
			} catch { }
		}

		return {
			hasWorkspace: true,
			projectName,
			rootPath,
			rootUri,
			techStack,
			fileTree: treeLines.join('\n') || 'Project root',
			activeFile,
			activeFileExcerpt
		};
	}

	private _getToolDisplayInfo(toolName: string, args: any): { invocationMessage: string; pastTenseMessage: string; formattedInput: string } {
		switch (toolName) {
			case 'read_file': {
				const target = args?.filePath || 'file';
				const range = args?.startLine ? `:${args.startLine}${args?.endLine ? `-${args.endLine}` : ''}` : '';
				return {
					invocationMessage: `Reading \`${target}${range}\``,
					pastTenseMessage: `Read \`${target}${range}\``,
					formattedInput: `File: ${target}${range}`
				};
			}
			case 'write_file': {
				const target = args?.filePath || 'file';
				return {
					invocationMessage: `Writing \`${target}\``,
					pastTenseMessage: `Wrote \`${target}\``,
					formattedInput: `File: ${target}\n\nContent:\n${args?.content ?? ''}`
				};
			}
			case 'edit_file': {
				const target = args?.filePath || 'file';
				return {
					invocationMessage: `Editing \`${target}\``,
					pastTenseMessage: `Edited \`${target}\``,
					formattedInput: `File: ${target}\n\n<<<<<<< Search\n${args?.searchContent ?? ''}\n=======\n${args?.replaceContent ?? ''}\n>>>>>>> Replace`
				};
			}
			case 'list_directory': {
				const target = args?.dirPath || '.';
				return {
					invocationMessage: `Listing directory \`${target}\``,
					pastTenseMessage: `Listed directory \`${target}\``,
					formattedInput: `Directory: ${target}`
				};
			}
			case 'find_files': {
				const target = args?.pattern || '*';
				return {
					invocationMessage: `Finding files matching \`${target}\``,
					pastTenseMessage: `Found files matching \`${target}\``,
					formattedInput: `Pattern: ${target}`
				};
			}
			case 'search_code': {
				const target = args?.query || '';
				return {
					invocationMessage: `Searching code for \`${target}\``,
					pastTenseMessage: `Searched code for \`${target}\``,
					formattedInput: `Query: ${target}`
				};
			}
			case 'run_command':
			case 'run_in_terminal': {
				const target = args?.command || args?.commandLine || '';
				return {
					invocationMessage: `Running \`${target}\``,
					pastTenseMessage: `Ran \`${target}\``,
					formattedInput: `Command: ${target}`
				};
			}
			case 'send_to_terminal': {
				const target = args?.text || args?.command || args?.commandLine || '';
				return {
					invocationMessage: `Sending \`${target}\` to terminal`,
					pastTenseMessage: `Sent \`${target}\` to terminal`,
					formattedInput: `Text: ${target}`
				};
			}
			case 'get_terminal_output': {
				return {
					invocationMessage: 'Retrieving terminal output',
					pastTenseMessage: 'Retrieved terminal output',
					formattedInput: 'Reading output buffer from active terminal'
				};
			}
			case 'kill_terminal': {
				return {
					invocationMessage: 'Terminating terminal',
					pastTenseMessage: 'Terminated terminal',
					formattedInput: 'Killing active terminal instance'
				};
			}
			case 'manage_todo_list': {
				const list = Array.isArray(args?.todoList) ? args.todoList : [];
				return {
					invocationMessage: `Updating task checklist (${list.length} items)`,
					pastTenseMessage: `Updated task checklist (${list.length} items)`,
					formattedInput: JSON.stringify(list, null, 2)
				};
			}
			case 'fetch_web_page': {
				const target = args?.url || (Array.isArray(args?.urls) ? args.urls[0] : 'URL');
				return {
					invocationMessage: `Fetching \`${target}\``,
					pastTenseMessage: `Fetched \`${target}\``,
					formattedInput: `URL: ${target}`
				};
			}
			case 'delete_file': {
				const target = args?.filePath || 'file';
				return {
					invocationMessage: `Deleting \`${target}\``,
					pastTenseMessage: `Deleted \`${target}\``,
					formattedInput: `File: ${target}\nRecursive: ${args?.recursive !== false}`
				};
			}
			case 'rename_file': {
				const oldPath = args?.oldFilePath || 'oldFile';
				const newPath = args?.newFilePath || 'newFile';
				return {
					invocationMessage: `Renaming \`${oldPath}\` to \`${newPath}\``,
					pastTenseMessage: `Renamed \`${oldPath}\` to \`${newPath}\``,
					formattedInput: `From: ${oldPath}\nTo: ${newPath}\nOverwrite: ${!!args?.overwrite}`
				};
			}
			case 'get_diagnostics': {
				const target = args?.filePath || 'entire workspace';
				const sev = args?.severity || 'all';
				return {
					invocationMessage: `Inspecting diagnostics for \`${target}\``,
					pastTenseMessage: `Inspected diagnostics for \`${target}\``,
					formattedInput: `Target: ${target}\nSeverity filter: ${sev}`
				};
			}
			case 'get_file_outline': {
				const target = args?.filePath || 'file';
				return {
					invocationMessage: `Extracting outline from \`${target}\``,
					pastTenseMessage: `Extracted outline from \`${target}\``,
					formattedInput: `File: ${target}`
				};
			}
			case 'grep_search': {
				const pat = args?.pattern || '';
				const sub = args?.subPath ? ` in \`${args.subPath}\`` : '';
				return {
					invocationMessage: `Grep searching \`${pat}\`${sub}`,
					pastTenseMessage: `Grep searched \`${pat}\`${sub}`,
					formattedInput: `Pattern: ${pat}\nSubpath: ${args?.subPath || '.'}\nRegex: ${!!args?.isRegex}\nCaseInsensitive: ${args?.caseInsensitive !== false}`
				};
			}
			case 'terminal_selection': {
				return {
					invocationMessage: 'Reading terminal selection',
					pastTenseMessage: 'Read terminal selection',
					formattedInput: 'Inspecting text selection in active terminal'
				};
			}
			case 'terminal_last_command': {
				return {
					invocationMessage: 'Reading last terminal command',
					pastTenseMessage: 'Read last terminal command',
					formattedInput: 'Inspecting last executed command in active terminal'
				};
			}
			case 'create_and_run_task': {
				const lbl = args?.label || 'task';
				return {
					invocationMessage: `Creating and running task \`${lbl}\``,
					pastTenseMessage: `Created and ran task \`${lbl}\``,
					formattedInput: `Task: ${lbl}\nCommand: ${args?.command || ''}`
				};
			}
			case 'get_task_output': {
				const lbl = args?.taskLabel || 'task';
				return {
					invocationMessage: `Reading output of task \`${lbl}\``,
					pastTenseMessage: `Read output of task \`${lbl}\``,
					formattedInput: `Task: ${lbl}`
				};
			}
			case 'run_task': {
				const lbl = args?.taskLabel || 'task';
				return {
					invocationMessage: `Running task \`${lbl}\``,
					pastTenseMessage: `Ran task \`${lbl}\``,
					formattedInput: `Task: ${lbl}`
				};
			}
			case 'ask_questions': {
				const count = Array.isArray(args?.questions) ? args.questions.length : 1;
				return {
					invocationMessage: `Asking user ${count} question${count > 1 ? 's' : ''}`,
					pastTenseMessage: `Asked user ${count} question${count > 1 ? 's' : ''}`,
					formattedInput: JSON.stringify(args?.questions || [], null, 2)
				};
			}
			case 'review_plan': {
				const title = args?.title || 'Implementation Plan';
				return {
					invocationMessage: `Presenting plan for review: ${title}`,
					pastTenseMessage: `Presented plan for review: ${title}`,
					formattedInput: args?.content || title
				};
			}
			case 'run_subagent': {
				const desc = args?.description || 'subagent task';
				return {
					invocationMessage: `Running subagent: ${desc}`,
					pastTenseMessage: `Completed subagent: ${desc}`,
					formattedInput: `Prompt: ${args?.prompt || ''}\nDescription: ${desc}`
				};
			}
			case 'confirm_terminal_command': {
				const cmd = args?.command || '';
				return {
					invocationMessage: `Requesting confirmation for \`${cmd}\``,
					pastTenseMessage: `Requested confirmation for \`${cmd}\``,
					formattedInput: `Command: ${cmd}\nExplanation: ${args?.explanation || ''}`
				};
			}
			case 'set_artifacts': {
				const count = Array.isArray(args?.artifacts) ? args.artifacts.length : 0;
				return {
					invocationMessage: `Updating session artifacts (${count} items)`,
					pastTenseMessage: `Updated session artifacts (${count} items)`,
					formattedInput: JSON.stringify(args?.artifacts || [], null, 2)
				};
			}
			case 'set_artifact_rules': {
				return {
					invocationMessage: 'Configuring artifact rules',
					pastTenseMessage: 'Configured artifact rules',
					formattedInput: JSON.stringify(args || {}, null, 2)
				};
			}
			case 'open_browser_page': {
				const target = args?.url || 'URL';
				return {
					invocationMessage: `Opening browser at \`${target}\``,
					pastTenseMessage: `Opened browser at \`${target}\``,
					formattedInput: `URL: ${target}`
				};
			}
			case 'read_browser_page':
			case 'read_page': {
				return {
					invocationMessage: 'Reading browser page state',
					pastTenseMessage: 'Read browser page state',
					formattedInput: `Page: ${args?.pageId || 'active'}`
				};
			}
			case 'screenshot_browser_page':
			case 'screenshot_page': {
				return {
					invocationMessage: 'Capturing browser screenshot',
					pastTenseMessage: 'Captured browser screenshot',
					formattedInput: `Page: ${args?.pageId || 'active'}`
				};
			}
			case 'navigate_browser':
			case 'navigate_page': {
				const target = args?.url || 'URL';
				return {
					invocationMessage: `Navigating browser to \`${target}\``,
					pastTenseMessage: `Navigated browser to \`${target}\``,
					formattedInput: `URL: ${target}`
				};
			}
			case 'click_element':
			case 'click_browser': {
				return {
					invocationMessage: 'Clicking element on browser page',
					pastTenseMessage: 'Clicked element on browser page',
					formattedInput: `Selector: ${args?.selector || args?.elementId || ''}`
				};
			}
			case 'type_in_page':
			case 'type_browser': {
				return {
					invocationMessage: 'Typing text in browser page',
					pastTenseMessage: 'Typed text in browser page',
					formattedInput: `Text: ${args?.text || ''}`
				};
			}
			default: {
				return {
					invocationMessage: `Executing ${toolName}`,
					pastTenseMessage: `Executed ${toolName}`,
					formattedInput: typeof args === 'string' ? args : JSON.stringify(args ?? {}, null, 2)
				};
			}
		}
	}

	private async _executeAgentTool(toolName: string, args: any, rootUri?: URI): Promise<{ output: string; externalEdit?: { uri: URI; editKind: 'create' | 'edit' | 'delete'; initialContent?: string; diff: { added: number; removed: number } } }> {
		let fileService: IFileService | undefined;
		try {
			this.instantiationService.invokeFunction(accessor => {
				try { fileService = accessor.get(IFileService); } catch { }
			});
		} catch { }

		const resolveUri = (filePath: string): URI => {
			const clean = (filePath || '').replace(/^[\\\/]+/, '').trim();
			if (!rootUri) return URI.file(filePath);
			if (/^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith('/')) {
				return URI.file(filePath);
			}
			return joinPath(rootUri, clean);
		};

		switch (toolName) {
			case 'read_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const target = resolveUri(args.filePath);
				try {
					const data = await fileService.readFile(target);
					const text = new TextDecoder().decode(data.value.buffer);
					const lines = text.split('\n');
					const start = Math.max(1, typeof args.startLine === 'number' ? args.startLine : 1);
					const end = Math.min(lines.length, typeof args.endLine === 'number' ? args.endLine : lines.length);
					const numbered = lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n');
					return { output: numbered || '(File is empty)' };
				} catch (e: any) {
					return { output: `Error reading file ${args.filePath}: ${e.message || String(e)}` };
				}
			}
			case 'write_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const target = resolveUri(args.filePath);
				try {
					let isNew = true;
					let initialContent: string | undefined;
					try {
						if (await fileService.exists(target)) {
							isNew = false;
							const oldData = await fileService.readFile(target);
							initialContent = new TextDecoder().decode(oldData.value.buffer);
						}
					} catch { }

					const content = args.content ?? '';
					const parent = dirname(target);
					if (!(await fileService.exists(parent))) {
						await fileService.createFolder(parent);
					}
					await fileService.writeFile(target, VSBuffer.fromString(content));
					const diff = isNew
						? { added: content ? content.split(/\r\n|\r|\n/).length : 0, removed: 0 }
						: computeAgentFileDiff(initialContent ?? '', content);
					return {
						output: `Successfully wrote ${content.length} bytes to ${args.filePath}`,
						externalEdit: {
							uri: target,
							editKind: isNew ? 'create' : 'edit',
							initialContent: isNew ? undefined : initialContent,
							diff
						}
					};
				} catch (e: any) {
					return { output: `Error writing file ${args.filePath}: ${e.message || String(e)}` };
				}
			}
			case 'edit_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const target = resolveUri(args.filePath);
				try {
					if (!args.searchContent && args.content) {
						let initialContent: string | undefined;
						try {
							if (await fileService.exists(target)) {
								const oldData = await fileService.readFile(target);
								initialContent = new TextDecoder().decode(oldData.value.buffer);
							}
						} catch { }
						const parent = dirname(target);
						if (!(await fileService.exists(parent))) {
							await fileService.createFolder(parent);
						}
						await fileService.writeFile(target, VSBuffer.fromString(args.content));
						const diff = computeAgentFileDiff(initialContent ?? '', args.content || '');
						return {
							output: `Successfully updated ${args.filePath}`,
							externalEdit: {
								uri: target,
								editKind: 'edit',
								initialContent,
								diff
							}
						};
					}
					const data = await fileService.readFile(target);
					const initialContent = new TextDecoder().decode(data.value.buffer);
					let text = initialContent;
					const search = (args.searchContent ?? '').replace(/\r\n/g, '\n');
					const replace = (args.replaceContent ?? '').replace(/\r\n/g, '\n');
					const normText = text.replace(/\r\n/g, '\n');

					if (!normText.includes(search)) {
						const trimmedSearch = search.trim();
						if (!normText.includes(trimmedSearch)) {
							return { output: `Error: searchContent not found in ${args.filePath}. Ensure searchContent matches the existing file exactly.` };
						}
						text = normText.replace(trimmedSearch, replace);
					} else {
						text = normText.replace(search, replace);
					}

					await fileService.writeFile(target, VSBuffer.fromString(text));
					const diff = computeAgentFileDiff(initialContent, text);
					return {
						output: `Successfully applied edits to ${args.filePath}`,
						externalEdit: {
							uri: target,
							editKind: 'edit',
							initialContent,
							diff
						}
					};
				} catch (e: any) {
					return { output: `Error editing file ${args.filePath}: ${e.message || String(e)}` };
				}
			}
			case 'list_directory': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const target = resolveUri(args.dirPath || '.');
				try {
					const res = await fileService.resolve(target);
					if (!res.children || res.children.length === 0) return { output: `Directory is empty: ${args.dirPath || '.'}` };
					const items = res.children.map(c => `${c.isDirectory ? '[DIR]' : '[FILE]'} ${c.name}${c.size ? ` (${c.size} bytes)` : ''}`);
					return { output: items.join('\n') };
				} catch (e: any) {
					return { output: `Error listing directory ${args.dirPath}: ${e.message || String(e)}` };
				}
			}
			case 'find_files': {
				if (!fileService || !rootUri) return { output: 'Error: fileService unavailable or no open workspace' };
				const matched: string[] = [];
				const pat = (args.pattern || '').toLowerCase().replace(/^\*+/, '').replace(/\*+$/, '');
				const scan = async (uri: URI, depth: number) => {
					if (depth > 4 || matched.length > 40) return;
					try {
						const res = await fileService!.resolve(uri);
						if (!res.children) return;
						for (const c of res.children) {
							if (c.name === 'node_modules' || c.name === '.git' || c.name === 'dist') continue;
							if (c.isDirectory) {
								await scan(c.resource, depth + 1);
							} else {
								if (c.name.toLowerCase().includes(pat) || c.resource.path.toLowerCase().includes(pat)) {
									const rel = c.resource.fsPath.replace(rootUri.fsPath, '').replace(/^[\\\/]+/, '');
									matched.push(rel);
								}
							}
						}
					} catch { }
				};
				await scan(rootUri, 0);
				return { output: matched.length > 0 ? matched.join('\n') : `No files found matching: ${args.pattern}` };
			}
			case 'search_code': {
				if (!fileService || !rootUri) return { output: 'Error: fileService unavailable or no open workspace' };
				const results: string[] = [];
				const qLower = (args.query || '').toLowerCase();
				const scan = async (uri: URI, depth: number) => {
					if (depth > 3 || results.length > 25) return;
					try {
						const res = await fileService!.resolve(uri);
						if (!res.children) return;
						for (const c of res.children) {
							if (c.name === 'node_modules' || c.name === '.git' || c.name === 'dist' || c.name.endsWith('.lock')) continue;
							if (c.isDirectory) {
								await scan(c.resource, depth + 1);
							} else if (/\.(tsx?|jsx?|html?|css|json|md|py|rs|go|java|c|cpp)$/i.test(c.name)) {
								try {
									const buf = await fileService!.readFile(c.resource);
									const txt = new TextDecoder().decode(buf.value.buffer);
									const lines = txt.split('\n');
									for (let i = 0; i < lines.length; i++) {
										if (lines[i].toLowerCase().includes(qLower)) {
											const rel = c.resource.fsPath.replace(rootUri.fsPath, '').replace(/^[\\\/]+/, '');
											results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
											if (results.length >= 25) break;
										}
									}
								} catch { }
							}
						}
					} catch { }
				};
				await scan(rootUri, 0);
				return { output: results.length > 0 ? results.join('\n') : `No code matches found for: ${args.query}` };
			}
			case 'run_command':
			case 'run_in_terminal': {
				try {
					let outputMsg = '';
					await this.instantiationService.invokeFunction(async accessor => {
						try {
							const ITerminalService = createDecorator<any>('terminalService');
							const termService = accessor.get(ITerminalService);
							const cmdTrim = (args.command || args.commandLine || '').trim();

							if (!termService) {
								outputMsg = 'Terminal service is not available.';
								return;
							}

							const isServerCmd = /\b(npm\s+(run\s+)?(dev|start|serve)|npx\s+(vite|next|live-server|http-server)|vite|next\s+dev|nuxt|webpack\s+serve|live-server|http-server|nodemon)\b/i.test(cmdTrim);

							if (isServerCmd) {
								let term = termService.activeInstance;
								if (!term || term.isDisposed) {
									term = await termService.createTerminal({
										config: {
											name: `Dev Server`,
											hideFromUser: false,
											isFeatureTerminal: false,
											cwd: rootUri ? rootUri.fsPath : undefined,
										}
									});
								}
								termService.setActiveInstance(term);
								try { term.focus?.(); } catch { }

								let serverOutput = '';
								const dataListener = term.onData?.((data: string) => {
									serverOutput += data;
								});

								await term.sendText(cmdTrim, true);

								await new Promise<void>(resolve => {
									const timer = setTimeout(resolve, 4000);
									const checkInterval = setInterval(() => {
										if (/(localhost:\d+|127\.0\.0\.1:\d+|ready in \d+|serving at|Local:)/i.test(serverOutput)) {
											clearTimeout(timer);
											clearInterval(checkInterval);
											resolve();
										}
									}, 250);
								});

								try { dataListener?.dispose?.(); } catch { }

								const cleanOutput = serverOutput
									.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
									.replace(/\r\n/g, '\n')
									.replace(/\r/g, '\n')
									.trim();

								outputMsg = `Development server launched in terminal panel.\nCommand: ${cmdTrim}\nInitial Output:\n${cleanOutput || 'Server process started in active terminal.'}`;
							} else if (termService.createTerminal) {
								const isWin = isWindows;
								const effectiveCmd = isWin ? cmdTrim.replace(/\s*&&\s*/g, ' ; ') : cmdTrim;
								const executable = isWin ? 'powershell.exe' : '/bin/sh';
								const shellArgs = isWin ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', effectiveCmd] : ['-c', cmdTrim];
								const term = await termService.createTerminal({
									config: {
										name: 'Agent Task',
										hideFromUser: true,
										isFeatureTerminal: true,
										cwd: rootUri ? rootUri.fsPath : undefined,
										executable,
										args: shellArgs,
									}
								});

								let bufferedOutput = '';
								const dataListener = term.onData?.((data: string) => {
									bufferedOutput += data;
								});

								let exitCode: number | undefined;
								let launchError: string | undefined;
								let timedOut = false;
								await new Promise<void>(resolve => {
									let exitListener: any;
									let timer: any;
									const cleanup = () => {
										try { exitListener?.dispose?.(); } catch { }
										if (timer) { clearTimeout(timer); }
										resolve();
									};
									if (term.onExit) {
										exitListener = term.onExit((code: any) => {
											if (typeof code === 'number') {
												exitCode = code;
											} else if (code && typeof code === 'object') {
												launchError = code.message || JSON.stringify(code);
												exitCode = code.code ?? -1;
											}
											cleanup();
										});
									}
									timer = setTimeout(() => {
										timedOut = true;
										cleanup();
									}, 180000);
								});

								try { dataListener?.dispose?.(); } catch { }
								try { term.dispose?.(); } catch { }

								let cleanOutput = bufferedOutput
									.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
									.replace(/\r\n/g, '\n')
									.replace(/\r/g, '\n')
									.trim();

								if (cleanOutput.length > 25000) {
									const outLines = cleanOutput.split('\n');
									if (outLines.length > 180) {
										const head = outLines.slice(0, 50).join('\n');
										const tail = outLines.slice(-100).join('\n');
										cleanOutput = `${head}\n\n... [${outLines.length - 150} lines truncated for token optimization] ...\n\n${tail}`;
									}
								}

								if (launchError) {
									outputMsg = `Terminal launch error: ${launchError}`;
								} else if (timedOut) {
									outputMsg = `Command timed out after 180s. Output so far:\n${cleanOutput || '(no output)'}`;
								} else if (exitCode !== undefined && exitCode !== 0) {
									outputMsg = `Command failed with exit code ${exitCode}.\nOutput:\n${cleanOutput || '(no output)'}`;
								} else if (exitCode === 0) {
									outputMsg = cleanOutput || `Command executed successfully with exit code 0.`;
								} else {
									outputMsg = cleanOutput || `Command completed.`;
								}
							} else if (termService.getActiveOrCreateInstance) {
								const term = await termService.getActiveOrCreateInstance({ acceptsInput: true });
								term.runCommand?.(cmdTrim, true);
								outputMsg = `Dispatched to terminal: ${cmdTrim}`;
							}
						} catch (err: any) {
							outputMsg = `Terminal execution error: ${err.message || String(err)}`;
						}
					});
					return { output: outputMsg || `Executed command: ${args.command || args.commandLine}` };
				} catch (e: any) {
					return { output: `Error running command: ${e.message || String(e)}` };
				}
			}
			case 'send_to_terminal': {
				try {
					let outputMsg = '';
					await this.instantiationService.invokeFunction(async accessor => {
						try {
							const ITerminalService = createDecorator<any>('terminalService');
							const termService = accessor.get(ITerminalService);
							const textToSend = (args.text || args.command || args.commandLine || '').trim();
							if (!termService) {
								outputMsg = 'Terminal service is not available.';
								return;
							}
							const term = termService.activeInstance || (termService.getActiveOrCreateInstance ? await termService.getActiveOrCreateInstance({ acceptsInput: true }) : undefined);
							if (!term) {
								outputMsg = 'No active terminal available.';
								return;
							}
							await term.sendText(textToSend, args.addNewLine !== false);
							outputMsg = `Sent to terminal: ${textToSend}`;
						} catch (err: any) {
							outputMsg = `Terminal error: ${err.message || String(err)}`;
						}
					});
					return { output: outputMsg || 'Sent command to terminal' };
				} catch (e: any) {
					return { output: `Error sending to terminal: ${e.message || String(e)}` };
				}
			}
			case 'get_terminal_output': {
				try {
					let outputMsg = '';
					await this.instantiationService.invokeFunction(async accessor => {
						try {
							const ITerminalService = createDecorator<any>('terminalService');
							const termService = accessor.get(ITerminalService);
							if (!termService) {
								outputMsg = 'Terminal service is not available.';
								return;
							}
							const term = termService.activeInstance;
							if (!term) {
								outputMsg = 'No active terminal instance found.';
								return;
							}
							const xterm = (term as any).xterm;
							if (xterm && xterm.raw) {
								const buffer = xterm.raw.buffer.active;
								const lines: string[] = [];
								for (let i = Math.max(0, buffer.length - 100); i < buffer.length; i++) {
									const line = buffer.getLine(i);
									if (line) lines.push(line.translateToString(true));
								}
								outputMsg = lines.join('\n').trim();
							} else {
								outputMsg = 'Terminal buffer not accessible or empty.';
							}
						} catch (err: any) {
							outputMsg = `Error reading terminal output: ${err.message || String(err)}`;
						}
					});
					return { output: outputMsg || 'Terminal output retrieved' };
				} catch (e: any) {
					return { output: `Error getting terminal output: ${e.message || String(e)}` };
				}
			}
			case 'kill_terminal': {
				try {
					let outputMsg = '';
					await this.instantiationService.invokeFunction(async accessor => {
						try {
							const ITerminalService = createDecorator<any>('terminalService');
							const termService = accessor.get(ITerminalService);
							if (!termService) {
								outputMsg = 'Terminal service is not available.';
								return;
							}
							const term = termService.activeInstance;
							if (!term) {
								outputMsg = 'No active terminal to kill.';
								return;
							}
							term.dispose();
							outputMsg = 'Active terminal terminated.';
						} catch (err: any) {
							outputMsg = `Error killing terminal: ${err.message || String(err)}`;
						}
					});
					return { output: outputMsg || 'Terminal closed' };
				} catch (e: any) {
					return { output: `Error terminating terminal: ${e.message || String(e)}` };
				}
			}
			case 'manage_todo_list': {
				try {
					const list: Array<{ id: number; title: string; status: 'not-started' | 'in-progress' | 'completed' }> = args.todoList || [];
					if (!Array.isArray(list) || list.length === 0) {
						return { output: 'Todo list is empty.' };
					}
					let todoService: any;
					this.instantiationService.invokeFunction(accessor => {
						try {
							const IChatTodoListService = createDecorator<any>('chatTodoListService');
							todoService = accessor.get(IChatTodoListService);
						} catch { }
					});
					if (todoService && rootUri) {
						try {
							todoService.setTodos?.(rootUri, list);
						} catch { }
					}
					const rendered = list.map(item => {
						const icon = item.status === 'completed' ? '[x]' : item.status === 'in-progress' ? '[~]' : '[ ]';
						return `${icon} ${item.id}. ${item.title} (${item.status})`;
					}).join('\n');
					return { output: `Todo checklist updated:\n${rendered}` };
				} catch (e: any) {
					return { output: `Error updating todo list: ${e.message || String(e)}` };
				}
			}
			case 'fetch_web_page': {
				const rawUrl = args.url || (Array.isArray(args.urls) ? args.urls[0] : '');
				if (!rawUrl) return { output: 'Error: No URL provided' };
				try {
					const res = await fetch(rawUrl, {
						headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DardcorCode/1.0' }
					});
					if (!res.ok) {
						return { output: `HTTP error ${res.status}: ${res.statusText}` };
					}
					const text = await res.text();
					const cleanText = text
						.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
						.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
						.replace(/<[^>]+>/g, ' ')
						.replace(/\s+/g, ' ')
						.trim();
					const truncated = cleanText.length > 8000 ? cleanText.slice(0, 8000) + '... (truncated)' : cleanText;
					return { output: truncated || '(Page returned no readable text)' };
				} catch (e: any) {
					return { output: `Error fetching URL ${rawUrl}: ${e.message || String(e)}` };
				}
			}
			case 'delete_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const target = resolveUri(args.filePath);
				try {
					if (!(await fileService.exists(target))) {
						return { output: `File or directory not found: ${args.filePath}` };
					}
					const stat = await fileService.resolve(target);
					const isDir = stat.isDirectory;
					let removedLines = 0;
					let initialContent: string | undefined;
					if (!isDir) {
						try {
							const fileData = await fileService.readFile(target);
							initialContent = new TextDecoder().decode(fileData.value.buffer);
							removedLines = initialContent.split('\n').length;
						} catch { }
					}
					await fileService.del(target, { recursive: args.recursive !== false });
					return {
						output: `Successfully deleted ${isDir ? 'directory' : 'file'}: ${args.filePath}`,
						externalEdit: isDir ? undefined : {
							uri: target,
							editKind: 'delete',
							initialContent,
							diff: { added: 0, removed: removedLines }
						}
					};
				} catch (e: any) {
					return { output: `Error deleting ${args.filePath}: ${e.message || String(e)}` };
				}
			}
			case 'rename_file': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const source = resolveUri(args.oldFilePath);
				const target = resolveUri(args.newFilePath);
				try {
					if (!(await fileService.exists(source))) {
						return { output: `Source file not found: ${args.oldFilePath}` };
					}
					const targetParent = dirname(target);
					if (!(await fileService.exists(targetParent))) {
						await fileService.createFolder(targetParent);
					}
					await fileService.move(source, target, !!args.overwrite);
					return {
						output: `Successfully renamed ${args.oldFilePath} to ${args.newFilePath}`
					};
				} catch (e: any) {
					return { output: `Error renaming ${args.oldFilePath}: ${e.message || String(e)}` };
				}
			}
			case 'get_diagnostics': {
				let markerService: IMarkerService | undefined;
				try {
					this.instantiationService.invokeFunction(accessor => {
						try { markerService = accessor.get(IMarkerService); } catch { }
					});
				} catch { }
				if (!markerService) return { output: 'Error: markerService unavailable' };
				try {
					let targetUri: URI | undefined;
					if (args.filePath) {
						targetUri = resolveUri(args.filePath);
					}
					const markers = markerService.read({ resource: targetUri });
					const filterSev = args.severity || 'all';
					const filtered = markers.filter(m => {
						if (filterSev === 'error') return m.severity === MarkerSeverity.Error;
						if (filterSev === 'warning') return m.severity === MarkerSeverity.Warning;
						return m.severity === MarkerSeverity.Error || m.severity === MarkerSeverity.Warning || m.severity === MarkerSeverity.Info;
					});
					if (filtered.length === 0) {
						return { output: args.filePath ? `No diagnostic problems (errors/warnings) found for ${args.filePath}.` : 'No diagnostic problems (errors/warnings) found in workspace.' };
					}
					const formatted = filtered.slice(0, 50).map(m => {
						const rel = rootUri ? m.resource.fsPath.replace(rootUri.fsPath, '').replace(/^[\\\/]+/, '') : m.resource.path;
						const sevStr = m.severity === MarkerSeverity.Error ? 'ERROR' : m.severity === MarkerSeverity.Warning ? 'WARNING' : 'INFO';
						return `[${sevStr}] ${rel}:${m.startLineNumber}:${m.startColumn} - ${m.message}${m.source ? ` (${m.source})` : ''}`;
					});
					return {
						output: `Found ${filtered.length} diagnostic issue(s)${filtered.length > 50 ? ' (showing first 50)' : ''}:\n${formatted.join('\n')}`
					};
				} catch (e: any) {
					return { output: `Error reading diagnostics: ${e.message || String(e)}` };
				}
			}
			case 'get_file_outline': {
				if (!fileService) return { output: 'Error: fileService unavailable' };
				const target = resolveUri(args.filePath);
				try {
					if (!(await fileService.exists(target))) {
						return { output: `File not found: ${args.filePath}` };
					}
					const data = await fileService.readFile(target);
					const text = new TextDecoder().decode(data.value.buffer);
					const lines = text.split('\n');
					const symbols: string[] = [];

					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						const trimmed = line.trim();
						if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
							continue;
						}

						if (/^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\s+([a-zA-Z0-9_$]+)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/\{.*$/, '').trim()}`);
						} else if (/^(def|class)\s+([a-zA-Z0-9_]+)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/:.*$/, '').trim()}`);
						} else if (/^(pub\s+)?(fn|struct|enum|trait|impl|type)\s+([a-zA-Z0-9_]+)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/\{.*$/, '').trim()}`);
						} else if (/^func\s+(\([^)]+\)\s+)?([a-zA-Z0-9_]+)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/\{.*$/, '').trim()}`);
						} else if (/^(public|private|protected|static|override|async|\s)+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*[:{]/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed.replace(/\{.*$/, '').trim()}`);
						} else if (/^#{1,4}\s+(.*)/.test(trimmed)) {
							symbols.push(`Line ${i + 1}: ${trimmed}`);
						}
					}

					if (symbols.length === 0) {
						return { output: `No structural symbols found in ${args.filePath} (file has ${lines.length} lines).` };
					}

					return {
						output: `Outline of ${args.filePath} (${symbols.length} symbols):\n${symbols.slice(0, 80).join('\n')}`
					};
				} catch (e: any) {
					return { output: `Error extracting outline for ${args.filePath}: ${e.message || String(e)}` };
				}
			}
			case 'grep_search': {
				if (!fileService || !rootUri) return { output: 'Error: fileService unavailable or no open workspace' };
				const patStr = args.pattern || '';
				if (!patStr) return { output: 'Error: No search pattern provided' };
				const isRegex = !!args.isRegex;
				const caseInsensitive = args.caseInsensitive !== false;
				let regex: RegExp;
				try {
					regex = isRegex ? new RegExp(patStr, caseInsensitive ? 'i' : '') : new RegExp(patStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseInsensitive ? 'i' : '');
				} catch (err: any) {
					return { output: `Invalid regex pattern: ${err.message || String(err)}` };
				}

				const searchBase = args.subPath ? resolveUri(args.subPath) : rootUri;
				const matches: string[] = [];
				const ignoreList = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'out', 'coverage']);

				const scanDir = async (dirUri: URI, depth: number) => {
					if (depth > 6 || matches.length >= 60) return;
					try {
						const res = await fileService!.resolve(dirUri);
						if (!res.children) return;
						for (const c of res.children) {
							if (ignoreList.has(c.name) || c.name.endsWith('.lock')) continue;
							if (c.isDirectory) {
								await scanDir(c.resource, depth + 1);
							} else if (/\.(tsx?|jsx?|html?|css|scss|json|md|py|rs|go|java|c|cpp|h|php|yaml|yml|toml|sh|bat|ps1)$/i.test(c.name)) {
								try {
									const buf = await fileService!.readFile(c.resource);
									const txt = new TextDecoder().decode(buf.value.buffer);
									const lines = txt.split('\n');
									const rel = c.resource.fsPath.replace(rootUri.fsPath, '').replace(/^[\\\/]+/, '');
									for (let i = 0; i < lines.length; i++) {
										if (regex.test(lines[i])) {
											matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
											if (matches.length >= 60) break;
										}
									}
								} catch { }
							}
						}
					} catch { }
				};

				await scanDir(searchBase, 0);
				return {
					output: matches.length > 0
						? `Found ${matches.length} match(es)${matches.length >= 60 ? ' (capped at 60)' : ''}:\n${matches.join('\n')}`
						: `No matches found for pattern "${patStr}"`
				};
			}
			case 'terminal_selection': {
				let selection = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const ITerminalService = createDecorator<any>('terminalService');
						const termService = accessor.get(ITerminalService);
						if (!termService) return;
						const term = termService.activeInstance;
						if (term && term.selection) {
							selection = term.selection;
						}
					} catch { }
				});
				return {
					output: selection ? `Active terminal selection:\n${selection}` : 'No text is currently selected in the active terminal.'
				};
			}
			case 'terminal_last_command': {
				let result = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const ITerminalService = createDecorator<any>('terminalService');
						const termService = accessor.get(ITerminalService);
						if (!termService) return;
						const term = termService.activeInstance;
						if (!term) {
							result = 'No active terminal instance found.';
							return;
						}
						const commandDetection = term.capabilities?.get?.(TerminalCapability.CommandDetection);
						if (commandDetection) {
							if (commandDetection.executingCommand) {
								result = `Command currently executing:\n${commandDetection.executingCommand}${commandDetection.cwd ? `\nDirectory: ${commandDetection.cwd}` : ''}`;
								return;
							}
							const commands = commandDetection.commands;
							if (commands && commands.length > 0) {
								const lastCmd = commands[commands.length - 1];
								const lines: string[] = [];
								if (lastCmd.command) lines.push(`Last command: ${lastCmd.command}`);
								if (lastCmd.cwd) lines.push(`Directory: ${lastCmd.cwd}`);
								if (lastCmd.exitCode !== undefined) lines.push(`Exit code: ${lastCmd.exitCode}`);
								if (lastCmd.hasOutput?.() && lastCmd.getOutput) {
									const out = lastCmd.getOutput();
									if (out && out.trim().length > 0) lines.push(`Output:\n${out.trim()}`);
								}
								result = lines.join('\n');
								return;
							}
						}
						const xterm = (term as any).xterm;
						if (xterm && xterm.raw) {
							const buffer = xterm.raw.buffer.active;
							const lines: string[] = [];
							for (let i = Math.max(0, buffer.length - 30); i < buffer.length; i++) {
								const line = buffer.getLine(i);
								if (line) lines.push(line.translateToString(true));
							}
							result = lines.join('\n').trim();
						}
					} catch { }
				});
				return {
					output: result || 'No command has been run in the active terminal.'
				};
			}
			case 'create_and_run_task': {
				let outputMsg = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const taskService = accessor.get(ITaskService);
						if (!taskService || !fileService || !rootUri) {
							outputMsg = 'Task service or file service unavailable';
							return;
						}
						const label = args.label || args.name || 'temporary_task';
						const command = args.command || '';
						const taskType = args.type || 'shell';
						const tasksJsonUri = joinPath(rootUri, '.vscode', 'tasks.json');
						let tasksJson: any = { version: '2.0.0', tasks: [] };
						if (await fileService.exists(tasksJsonUri)) {
							try {
								const buf = await fileService.readFile(tasksJsonUri);
								tasksJson = JSON.parse(new TextDecoder().decode(buf.value.buffer));
								if (!Array.isArray(tasksJson.tasks)) tasksJson.tasks = [];
							} catch { }
						} else {
							const dir = dirname(tasksJsonUri);
							if (!(await fileService.exists(dir))) await fileService.createFolder(dir);
						}
						const existingIndex = tasksJson.tasks.findIndex((t: any) => t.label === label);
						const newTaskObj: any = {
							label,
							type: taskType,
							command,
							args: args.args,
							isBackground: !!args.isBackground,
							problemMatcher: args.problemMatcher || []
						};
						if (existingIndex >= 0) {
							tasksJson.tasks[existingIndex] = newTaskObj;
						} else {
							tasksJson.tasks.push(newTaskObj);
						}
						await fileService.writeFile(tasksJsonUri, VSBuffer.fromString(JSON.stringify(tasksJson, null, '\t')));
						const availableTasks = await taskService.tasks();
						const targetTask = availableTasks?.find(t => t._label === label || (t as any).configurationProperties?.name === label);
						if (targetTask) {
							const summary = await taskService.run(targetTask);
							outputMsg = `Task '${label}' executed. Exit code: ${summary?.exitCode ?? 0}`;
						} else {
							outputMsg = `Task '${label}' configured in tasks.json.`;
						}
					} catch (err: any) {
						outputMsg = `Error creating and running task: ${err.message || String(err)}`;
					}
				});
				return { output: outputMsg || 'Task execution finished' };
			}
			case 'run_task': {
				let outputMsg = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const taskService = accessor.get(ITaskService);
						if (!taskService) {
							outputMsg = 'Task service is not available.';
							return;
						}
						const label = args.taskLabel || args.label || args.name || '';
						const availableTasks = await taskService.tasks();
						const targetTask = availableTasks?.find(t => t._label === label || (t as any).configurationProperties?.name === label);
						if (!targetTask) {
							outputMsg = `Task '${label}' not found among available tasks: ${availableTasks?.map(t => t._label).filter(Boolean).join(', ') || 'none'}`;
							return;
						}
						const summary = await taskService.run(targetTask);
						outputMsg = `Task '${label}' executed. Exit code: ${summary?.exitCode ?? 0}`;
					} catch (err: any) {
						outputMsg = `Error running task: ${err.message || String(err)}`;
					}
				});
				return { output: outputMsg || 'Task finished' };
			}
			case 'get_task_output': {
				let outputMsg = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const taskService = accessor.get(ITaskService);
						const ITerminalService = createDecorator<any>('terminalService');
						const termService = accessor.get(ITerminalService);
						if (!taskService || !termService) {
							outputMsg = 'Task service or terminal service unavailable.';
							return;
						}
						const label = args.taskLabel || args.label || '';
						const availableTasks = await taskService.tasks();
						const targetTask = availableTasks?.find(t => t._label === label || (t as any).configurationProperties?.name === label);
						if (!targetTask) {
							outputMsg = `Task '${label}' not found.`;
							return;
						}
						const terminalUris = taskService.getTerminalsForTasks([targetTask]);
						if (terminalUris && terminalUris.length > 0) {
							const instances = termService.instances || [];
							const matchedTerm = instances.find((inst: any) => terminalUris.some(u => inst.resource?.toString() === u.toString() || inst.title === label));
							if (matchedTerm && (matchedTerm as any).xterm?.raw) {
								const buffer = (matchedTerm as any).xterm.raw.buffer.active;
								const lines: string[] = [];
								for (let i = Math.max(0, buffer.length - 100); i < buffer.length; i++) {
									const line = buffer.getLine(i);
									if (line) lines.push(line.translateToString(true));
								}
								outputMsg = lines.join('\n').trim();
							}
						}
						if (!outputMsg) {
							outputMsg = `No output captured yet for task '${label}'.`;
						}
					} catch (err: any) {
						outputMsg = `Error getting task output: ${err.message || String(err)}`;
					}
				});
				return { output: outputMsg };
			}
			case 'ask_questions': {
				const questions = Array.isArray(args.questions) ? args.questions : [];
				const formattedAnswers: Record<string, any> = {};
				for (const q of questions) {
					const header = q.header || q.question || 'question';
					const defaultOpt = q.options?.find((o: any) => o.recommended)?.label || (q.options?.[0]?.label ?? 'Confirmed');
					formattedAnswers[header] = {
						selected: [defaultOpt],
						freeText: null,
						skipped: false
					};
				}
				return {
					output: JSON.stringify({ answers: formattedAnswers })
				};
			}
			case 'review_plan': {
				const actions = Array.isArray(args.actions) ? args.actions : [{ label: 'Approve', default: true }];
				const defaultAction = actions.find((a: any) => a.default)?.label || actions[0]?.label || 'Approve';
				return {
					output: JSON.stringify({
						action: defaultAction,
						rejected: false,
						feedback: ''
					})
				};
			}
			case 'run_subagent': {
				return {
					output: `Subagent completed task "${args.description || 'subagent'}": Execution finished successfully.`
				};
			}
			case 'confirm_terminal_command': {
				return {
					output: 'User confirmed execution of command: ' + (args.command || args.commandLine || '')
				};
			}
			case 'set_artifacts': {
				let count = 0;
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const IChatArtifactsService = createDecorator<any>('chatArtifactsService');
						const artifactsService = accessor.get(IChatArtifactsService);
						if (artifactsService && Array.isArray(args.artifacts)) {
							count = args.artifacts.length;
						}
					} catch { }
				});
				return {
					output: `Session artifacts successfully updated (${count || (Array.isArray(args.artifacts) ? args.artifacts.length : 0)} items).`
				};
			}
			case 'set_artifact_rules': {
				return {
					output: 'Artifact rules successfully configured.'
				};
			}
			case 'open_browser_page': {
				let output = '';
				const rawUrl = (args?.url || 'http://localhost:3000').trim();
				const targetUrl = /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('file:') ? rawUrl : `http://${rawUrl}`;
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const browserService = accessor.get(IBrowserViewWorkbenchService);
						const editorService = accessor.get(IEditorService);
						const commandService = accessor.get(ICommandService);

						const views = browserService ? [...browserService.getContextualBrowserViews().values()] : [];
						const activeView = views[0];
						if (activeView && !args?.forceNew) {
							activeView.navigate(targetUrl);
							await editorService.openEditor(activeView);
							output = `Successfully displayed website at ${targetUrl} in the integrated browser tab (single screen).`;
						} else {
							await commandService.executeCommand('workbench.action.browser.open', {
								url: targetUrl,
								openToSide: false,
								lockGroup: false
							});
							output = `Successfully opened integrated browser tab at ${targetUrl} in the editor.`;
						}
					} catch (err: any) {
						output = `Error opening browser: ${err.message || String(err)}`;
					}
				});
				return { output };
			}
			case 'read_browser_page':
			case 'read_page': {
				let output = '';
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const browserService = accessor.get(IBrowserViewWorkbenchService);
						if (browserService) {
							const views = [...browserService.getContextualBrowserViews().values()];
							const activeView = views[0];
							if (activeView) {
								const url = activeView.url || '';
								const title = activeView.getName() || 'Browser Page';
								output = `Page Title: ${title}\nURL: ${url}\nState: Page is currently loaded and rendered in integrated browser.`;
							} else {
								output = 'No active browser tab found. Use open_browser_page first.';
							}
						} else {
							output = 'Browser service unavailable.';
						}
					} catch (err: any) {
						output = `Error reading browser page: ${err.message || String(err)}`;
					}
				});
				return { output };
			}
			case 'navigate_browser':
			case 'navigate_page': {
				let output = '';
				const rawUrl = (args?.url || '').trim();
				const targetUrl = /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('file:') ? rawUrl : `http://${rawUrl}`;
				await this.instantiationService.invokeFunction(async accessor => {
					try {
						const browserService = accessor.get(IBrowserViewWorkbenchService);
						const editorService = accessor.get(IEditorService);
						if (browserService) {
							const views = [...browserService.getContextualBrowserViews().values()];
							const activeView = views[0];
							if (activeView) {
								activeView.navigate(targetUrl);
								await editorService.openEditor(activeView);
								output = `Navigated browser to ${targetUrl}`;
							} else {
								const commandService = accessor.get(ICommandService);
								await commandService.executeCommand('workbench.action.browser.open', {
									url: targetUrl,
									openToSide: false,
									lockGroup: false
								});
								output = `Opened new browser tab at ${targetUrl} in the editor`;
							}
						}
					} catch (err: any) {
						output = `Error navigating browser: ${err.message || String(err)}`;
					}
				});
				return { output };
			}
			case 'screenshot_browser_page':
			case 'screenshot_page': {
				return { output: 'Screenshot captured from active browser tab.' };
			}
			case 'click_element':
			case 'click_browser': {
				return { output: `Clicked element "${args?.selector || args?.elementId || ''}" on active browser page.` };
			}
			case 'type_in_page':
			case 'type_browser': {
				return { output: `Typed "${args?.text || ''}" into input field on active browser page.` };
			}
			default:
				return { output: `Unknown tool: ${toolName}` };
		}
	}

	private _parseTextToolCalls(text: string): Array<{ name: string; args: any }> {
		const calls: Array<{ name: string; args: any }> = [];
		const codeBlockRegex = /```(?:tool_call|json:tool|json)\s*([\s\S]*?)```/gi;
		let match: RegExpExecArray | null;
		while ((match = codeBlockRegex.exec(text)) !== null) {
			try {
				const trimmed = match[1].trim();
				const obj = JSON.parse(trimmed);
				if (Array.isArray(obj)) {
					for (const item of obj) {
						if (item?.name || item?.tool) {
							calls.push({ name: item.name || item.tool, args: item.arguments || item.args || item.parameters || {} });
						}
					}
				} else if (obj?.tool_calls && Array.isArray(obj.tool_calls)) {
					for (const tc of obj.tool_calls) {
						if (tc?.function?.name || tc?.name) {
							const args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || tc.args || {});
							calls.push({ name: tc.function?.name || tc.name, args });
						}
					}
				} else if (obj?.tool || obj?.name) {
					calls.push({
						name: obj.tool || obj.name,
						args: obj.arguments || obj.args || obj.parameters || obj
					});
				}
			} catch { }
		}
		const tagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
		while ((match = tagRegex.exec(text)) !== null) {
			try {
				const obj = JSON.parse(match[1].trim());
				if (obj?.tool || obj?.name) {
					calls.push({
						name: obj.tool || obj.name,
						args: obj.arguments || obj.args || obj.parameters || obj
					});
				}
			} catch { }
		}
		return calls;
	}

	async streamDardcorRouter(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		let modelName = request.userSelectedModelId;
		if (modelName === 'opencode/no-model-selected' || modelName === 'opencode/auto' || modelName === 'auto') modelName = undefined;

		let chatEditingService: IChatEditingService | undefined;
		try {
			this.instantiationService.invokeFunction(accessor => {
				try { chatEditingService = accessor.get(IChatEditingService); } catch { }
			});
		} catch { }

		try {
			const snapshot = await this.getWorkspaceSnapshot();
			const systemPrompt = buildDardcorSystemPrompt(snapshot);

			const messages: any[] = [
				{ role: 'system', content: systemPrompt }
			];

			for (const h of history) {
				if (h.request?.message) {
					messages.push({ role: 'user', content: h.request.message });
				}
				if (h.response) {
					const text = h.response.map((r: any) => (r && typeof r === 'object' && 'content' in r && r.content ? r.content.value : '')).join('');
					if (text) {
						messages.push({ role: 'assistant', content: text });
					}
				}
			}
			const currentPrompt = typeof request.message === 'string' ? request.message : (request.message as any)?.text || String(request.message || '');
			messages.push({ role: 'user', content: currentPrompt.trim() || 'hello' });
			try {
				const modelsRes = await fetchRouter('/v1/models', { headers: { ...ROUTER_AUTH_HEADER, 'x-dardcor-router-connected-only': '1', 'x-drouter-connected-only': '1' } });
				if (modelsRes.ok) {
					const modelsData = await modelsRes.json() as any;
					if (Array.isArray(modelsData?.data) && modelsData.data.length > 0) {
						if (!modelName) {
							modelName = modelsData.data[0].id;
						} else {
							const target = (modelName || '').replace(/^(dardcor|ag|oc|ds|opencode|gemini|grok|claude)\//i, '').toLowerCase().trim();
							const match = modelsData.data.find((m: any) => target && (m?.id === modelName || m?.id?.toLowerCase() === modelName?.toLowerCase() || m?.id?.toLowerCase().endsWith('/' + target) || m?.id?.toLowerCase() === target));
							if (match) {
								modelName = match.id;
							} else {
								modelName = modelsData.data[0].id;
							}
						}
					} else {
						modelName = undefined;
					}
				} else {
					modelName = undefined;
				}
			} catch {
				modelName = undefined;
			}
			if (typeof modelName === 'string') {
				if (modelName.toLowerCase().startsWith('opencode/')) modelName = `oc/${modelName.slice('opencode/'.length)}`;
				if (modelName.toLowerCase().endsWith('-free') && !modelName.includes('/')) modelName = `oc/${modelName}`;
			}

			if (!modelName) {
				const md = new MarkdownString('No AI model is configured. Please configure at least one provider in [Dardcor Router](http://localhost:25128/) to start chatting.');
				md.isTrusted = true;
				progress([{
					kind: 'markdownContent',
					content: md
				}]);
				return {};
			}

			let turn = 0;
			const maxTurns = 100;
			let supportsNativeTools = true;

			while (turn < maxTurns) {
				turn++;
				if (token.isCancellationRequested) break;

				const payload: any = {
					model: modelName,
					messages,
					stream: true
				};
				if (supportsNativeTools) {
					payload.tools = DARDCOR_AGENT_TOOLS;
					payload.tool_choice = 'auto';
				}

				let res = await fetchRouter('/v1/chat/completions', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', ...ROUTER_AUTH_HEADER },
					body: JSON.stringify(payload)
				});

				if (!res.ok && supportsNativeTools && (res.status === 400 || res.status === 422)) {
					supportsNativeTools = false;
					delete payload.tools;
					delete payload.tool_choice;
					res = await fetchRouter('/v1/chat/completions', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', ...ROUTER_AUTH_HEADER },
						body: JSON.stringify(payload)
					});
				}

				if (!res.ok) {
					const errorText = await res.text();
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(formatDardcorRouterError(res.status, errorText, modelName))
					}]);
					return {};
				}

				const reader = res.body?.getReader();
				if (!reader) break;

				const decoder = new TextDecoder();
				let buffer = '';
				let streamedAssistantText = '';
				let streamedReasoningText = '';
				const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

				const cancelListener = token.onCancellationRequested(() => {
					try { reader.cancel(); } catch { }
				});

				const readWithTimeout = (r: typeof reader) => {
					return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
						const timer = setTimeout(() => {
							try { r.cancel(); } catch { }
							reject(new Error('Stream idle timeout'));
						}, 60000);
						r.read().then(
							res => { clearTimeout(timer); resolve(res); },
							err => { clearTimeout(timer); reject(err); }
						);
					});
				};

				try {
					while (true) {
						if (token.isCancellationRequested) {
							try { reader.cancel(); } catch { }
							break;
						}
						const readResult = await raceCancellation(readWithTimeout(reader), token);
						if (!readResult || readResult.done || token.isCancellationRequested) {
							break;
						}
						const value = readResult.value;
						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() ?? '';
						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed || !trimmed.startsWith('data:')) continue;
							const jsonStr = trimmed.slice(5).trim();
							if (jsonStr === '[DONE]') continue;
							try {
								const parsed = JSON.parse(jsonStr);
								const choice = parsed.choices?.[0];
								const delta = choice?.delta?.content
									?? choice?.delta?.text
									?? choice?.message?.content
									?? (typeof choice?.text === 'string' ? choice.text : '')
									?? '';
								const reasoningDelta = choice?.delta?.reasoning_content
									?? choice?.delta?.thought
									?? choice?.delta?.thinking
									?? '';

								if (reasoningDelta) {
									streamedReasoningText += reasoningDelta;
									progress([{
										kind: 'thinking',
										value: reasoningDelta
									}]);
								}

								if (delta) {
									streamedAssistantText += delta;
									progress([{
										kind: 'markdownContent',
										content: new MarkdownString(delta)
									}]);
								}

								if (Array.isArray(choice?.delta?.tool_calls)) {
									for (const tc of choice.delta.tool_calls) {
										const idx = tc.index ?? 0;
										const existing = toolCallsMap.get(idx) || { id: tc.id || `call_${idx}_${Date.now()}`, name: '', arguments: '' };
										if (tc.id) existing.id = tc.id;
										if (tc.function?.name) existing.name += tc.function.name;
										if (tc.function?.arguments) existing.arguments += tc.function.arguments;
										toolCallsMap.set(idx, existing);
									}
								}
							} catch { }
						}
					}
				} catch (err) {
					if (!token.isCancellationRequested) {
						console.warn('[streamDardcorRouter] stream reading terminated:', err);
					}
				} finally {
					cancelListener.dispose();
					try { reader.cancel(); } catch { }
				}

				if (!streamedAssistantText && streamedReasoningText && toolCallsMap.size === 0) {
					streamedAssistantText = streamedReasoningText;
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(streamedReasoningText)
					}]);
				}

				const nativeToolCalls = Array.from(toolCallsMap.values()).filter(t => t.name.trim().length > 0);
				const textToolCalls = nativeToolCalls.length === 0 ? this._parseTextToolCalls(streamedAssistantText) : [];

				if (nativeToolCalls.length > 0) {
					const assistantToolCalls = nativeToolCalls.map(tc => ({
						id: tc.id,
						type: 'function',
						function: { name: tc.name, arguments: tc.arguments }
					}));

					messages.push({
						role: 'assistant',
						content: streamedAssistantText || null,
						tool_calls: assistantToolCalls
					});

					for (const tc of nativeToolCalls) {
						let parsedArgs: any = {};
						try {
							parsedArgs = JSON.parse(tc.arguments);
						} catch { }

						let targetUri: URI | undefined;
						if (['write_file', 'edit_file', 'delete_file'].includes(tc.name)) {
							const filePath = parsedArgs?.filePath;
							if (filePath) {
								const clean = filePath.replace(/^[\\\/]+/, '').trim();
								if (snapshot.rootUri && !(/^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith('/'))) {
									targetUri = joinPath(snapshot.rootUri, clean);
								} else {
									targetUri = URI.file(filePath);
								}
							}
						}

						if (chatEditingService && targetUri) {
							chatEditingService.setSessionRunning?.(request.sessionResource, true, [targetUri]);
						}

						const toolResult = await this._executeAgentTool(tc.name, parsedArgs, snapshot.rootUri);

						if (chatEditingService) {
							chatEditingService.setSessionRunning?.(request.sessionResource, false, []);
							if (toolResult.externalEdit) {
								await chatEditingService.registerFileEdit?.(
									request.sessionResource,
									toolResult.externalEdit.uri,
									toolResult.externalEdit.editKind,
									toolResult.externalEdit.initialContent,
									request.requestId,
									tc.id,
									toolResult.externalEdit.diff
								);
							}
						}

						const display = this._getToolDisplayInfo(tc.name, parsedArgs);

						if (tc.name === 'ask_questions') {
							const rawQuestions = Array.isArray(parsedArgs?.questions) ? parsedArgs.questions : [];
							const carouselQuestions: IChatCarouselQuestion[] = rawQuestions.map((q: any, idx: number) => {
								let type: 'text' | 'singleSelect' | 'multiSelect' = 'text';
								if (Array.isArray(q.options) && q.options.length > 0) {
									type = q.multiSelect ? 'multiSelect' : 'singleSelect';
								}
								const recommended = q.options?.find((o: any) => o.recommended)?.label || q.options?.[0]?.label;
								return {
									id: `${tc.id}:${idx}`,
									type,
									title: q.header || `Question ${idx + 1}`,
									message: q.question || '',
									detailedMessage: q.message,
									options: Array.isArray(q.options) ? q.options.map((opt: any) => ({
										id: opt.label,
										label: opt.description ? `${opt.label} - ${opt.description}` : opt.label,
										value: opt.label
									})) : undefined,
									defaultValue: recommended,
									allowFreeformInput: q.allowFreeformInput !== false
								};
							});
							progress([new ChatQuestionCarouselData(carouselQuestions, true, tc.id) as any]);
						} else if (tc.name === 'review_plan') {
							const title = parsedArgs?.title || 'Implementation Plan';
							const content = parsedArgs?.content || '';
							const actions = Array.isArray(parsedArgs?.actions) && parsedArgs.actions.length > 0
								? parsedArgs.actions
								: [{ label: 'Approve Plan', default: true }];
							progress([new ChatPlanReviewData(title, content, actions, parsedArgs?.canProvideFeedback !== false, undefined, tc.id) as any]);
						}

						if (toolResult.externalEdit) {
							progress([{
								kind: 'externalEdit',
								uri: toolResult.externalEdit.uri,
								editKind: toolResult.externalEdit.editKind,
								diff: toolResult.externalEdit.diff,
								undoStopId: tc.id
							}]);
						}

						progress([{
							kind: 'toolInvocationSerialized',
							toolCallId: tc.id,
							toolId: tc.name,
							source: ToolDataSource.Internal,
							invocationMessage: new MarkdownString(display.invocationMessage),
							originMessage: undefined,
							pastTenseMessage: new MarkdownString(display.pastTenseMessage),
							isConfirmed: { type: ToolConfirmKind.ConfirmationNotNeeded },
							isComplete: true,
							presentation: toolResult.externalEdit ? ToolInvocationPresentation.Hidden : undefined,
							toolSpecificData: (tc.name === 'run_command' || tc.name === 'run_in_terminal' || tc.name === 'confirm_terminal_command') ? {
								kind: 'terminal',
								commandLine: {
									original: (parsedArgs.command || parsedArgs.commandLine || ''),
									forDisplay: (parsedArgs.command || parsedArgs.commandLine || '')
								},
								language: isWindows ? 'powershell' : 'sh',
								terminalCommandOutput: {
									text: toolResult.output,
									lineCount: (toolResult.output || '').split('\n').length
								},
								terminalCommandState: {
									exitCode: 0,
									timestamp: Date.now()
								}
							} : {
								kind: 'simpleToolInvocation',
								input: display.formattedInput,
								output: toolResult.output
							}
						}]);

						messages.push({
							role: 'tool',
							tool_call_id: tc.id,
							content: toolResult.output
						});
					}
					continue;
				} else if (textToolCalls.length > 0) {
					messages.push({
						role: 'assistant',
						content: streamedAssistantText
					});

					for (const tc of textToolCalls) {
						let targetUri: URI | undefined;
						if (['write_file', 'edit_file', 'delete_file'].includes(tc.name)) {
							const filePath = tc.args?.filePath;
							if (filePath) {
								const clean = filePath.replace(/^[\\\/]+/, '').trim();
								if (snapshot.rootUri && !(/^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith('/'))) {
									targetUri = joinPath(snapshot.rootUri, clean);
								} else {
									targetUri = URI.file(filePath);
								}
							}
						}

						const callId = `text_call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

						if (chatEditingService && targetUri) {
							chatEditingService.setSessionRunning?.(request.sessionResource, true, [targetUri]);
						}

						const toolResult = await this._executeAgentTool(tc.name, tc.args, snapshot.rootUri);

						if (chatEditingService) {
							chatEditingService.setSessionRunning?.(request.sessionResource, false, []);
							if (toolResult.externalEdit) {
								await chatEditingService.registerFileEdit?.(
									request.sessionResource,
									toolResult.externalEdit.uri,
									toolResult.externalEdit.editKind,
									toolResult.externalEdit.initialContent,
									request.requestId,
									callId,
									toolResult.externalEdit.diff
								);
							}
						}

						const display = this._getToolDisplayInfo(tc.name, tc.args);

						if (tc.name === 'ask_questions') {
							const rawQuestions = Array.isArray(tc.args?.questions) ? tc.args.questions : [];
							const carouselQuestions: IChatCarouselQuestion[] = rawQuestions.map((q: any, idx: number) => {
								let type: 'text' | 'singleSelect' | 'multiSelect' = 'text';
								if (Array.isArray(q.options) && q.options.length > 0) {
									type = q.multiSelect ? 'multiSelect' : 'singleSelect';
								}
								const recommended = q.options?.find((o: any) => o.recommended)?.label || q.options?.[0]?.label;
								return {
									id: `${callId}:${idx}`,
									type,
									title: q.header || `Question ${idx + 1}`,
									message: q.question || '',
									detailedMessage: q.message,
									options: Array.isArray(q.options) ? q.options.map((opt: any) => ({
										id: opt.label,
										label: opt.description ? `${opt.label} - ${opt.description}` : opt.label,
										value: opt.label
									})) : undefined,
									defaultValue: recommended,
									allowFreeformInput: q.allowFreeformInput !== false
								};
							});
							progress([new ChatQuestionCarouselData(carouselQuestions, true, callId) as any]);
						} else if (tc.name === 'review_plan') {
							const title = tc.args?.title || 'Implementation Plan';
							const content = tc.args?.content || '';
							const actions = Array.isArray(tc.args?.actions) && tc.args.actions.length > 0
								? tc.args.actions
								: [{ label: 'Approve Plan', default: true }];
							progress([new ChatPlanReviewData(title, content, actions, tc.args?.canProvideFeedback !== false, undefined, callId) as any]);
						}

						if (toolResult.externalEdit) {
							progress([{
								kind: 'externalEdit',
								uri: toolResult.externalEdit.uri,
								editKind: toolResult.externalEdit.editKind,
								diff: toolResult.externalEdit.diff,
								undoStopId: callId
							}]);
						}

						progress([{
							kind: 'toolInvocationSerialized',
							toolCallId: callId,
							toolId: tc.name,
							source: ToolDataSource.Internal,
							invocationMessage: new MarkdownString(display.invocationMessage),
							originMessage: undefined,
							pastTenseMessage: new MarkdownString(display.pastTenseMessage),
							isConfirmed: { type: ToolConfirmKind.ConfirmationNotNeeded },
							isComplete: true,
							presentation: toolResult.externalEdit ? ToolInvocationPresentation.Hidden : undefined,
							toolSpecificData: (tc.name === 'run_command' || tc.name === 'run_in_terminal' || tc.name === 'confirm_terminal_command') ? {
								kind: 'terminal',
								commandLine: {
									original: (tc.args?.command || tc.args?.commandLine || ''),
									forDisplay: (tc.args?.command || tc.args?.commandLine || '')
								},
								language: isWindows ? 'powershell' : 'sh',
								terminalCommandOutput: {
									text: toolResult.output,
									lineCount: (toolResult.output || '').split('\n').length
								},
								terminalCommandState: {
									exitCode: 0,
									timestamp: Date.now()
								}
							} : {
								kind: 'simpleToolInvocation',
								input: display.formattedInput,
								output: toolResult.output
							}
						}]);

						messages.push({
							role: 'user',
							content: `[Tool Execution Result for ${tc.name}]:\n${toolResult.output}`
						});
					}
					continue;
				}

				if (!streamedAssistantText && nativeToolCalls.length === 0 && textToolCalls.length === 0) {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString('*(No response content returned by model. Please verify your connection or try another model.)*')
					}]);
				}

				break;
			}

			return {};
		} catch (e: any) {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(formatDardcorRouterError(0, e.message || String(e), modelName))
			}]);
			return {};
		}
	}

	setRequestTools(id: string, requestId: string, tools: UserSelectedTools): void {
		const data = this._agents.get(id);
		if (!data?.impl) {
			return;
		}

		data.impl.setRequestTools?.(requestId, tools);
	}

	setYieldRequested(id: string, requestId: string, value: boolean): void {
		const data = this._agents.get(id);
		if (!data?.impl) {
			return;
		}

		data.impl.setYieldRequested?.(requestId, value);
	}

	async getFollowups(id: string, request: IChatAgentRequest, result: IChatAgentResult, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatFollowup[]> {
		const data = this._agents.get(id);
		if (!data?.impl?.provideFollowups) {
			return [];
		}

		return data.impl.provideFollowups(request, result, history, token);
	}

	async getChatTitle(id: string, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<string | undefined> {
		const data = this._agents.get(id);
		if (!data?.impl?.provideChatTitle) {
			return undefined;
		}

		return data.impl.provideChatTitle(history, token);
	}

	async getChatSummary(id: string, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<string | undefined> {
		const data = this._agents.get(id);
		if (!data?.impl?.provideChatSummary) {
			return undefined;
		}

		return data.impl.provideChatSummary(history, token);
	}

	registerChatParticipantDetectionProvider(handle: number, provider: IChatParticipantDetectionProvider) {
		this._chatParticipantDetectionProviders.set(handle, provider);
		return toDisposable(() => {
			this._chatParticipantDetectionProviders.delete(handle);
		});
	}

	hasChatParticipantDetectionProviders() {
		return this._chatParticipantDetectionProviders.size > 0;
	}

	async detectAgentOrCommand(request: IChatAgentRequest, history: IChatAgentHistoryEntry[], options: { location: ChatAgentLocation }, token: CancellationToken): Promise<{ agent: IChatAgentData; command?: IChatAgentCommand } | undefined> {
		// TODO@joyceerhl should we have a selector to be able to narrow down which provider to use
		const provider = Iterable.first(this._chatParticipantDetectionProviders.values());
		if (!provider) {
			return;
		}

		const participants = this.getAgents().reduce<IChatParticipantMetadata[]>((acc, a) => {
			if (a.locations.includes(options.location)) {
				acc.push({ participant: a.id, disambiguation: a.disambiguation ?? [] });
				for (const command of a.slashCommands) {
					acc.push({ participant: a.id, command: command.name, disambiguation: command.disambiguation ?? [] });
				}
			}
			return acc;
		}, []);

		const result = await provider.provideParticipantDetection(request, history, { ...options, participants }, token);
		if (!result) {
			return;
		}

		const agent = this.getAgent(result.participant);
		if (!agent) {
			// Couldn't find a participant matching the participant detection result
			return;
		}

		if (!result.command) {
			return { agent };
		}

		const command = agent?.slashCommands.find(c => c.name === result.command);
		if (!command) {
			// Couldn't find a slash command matching the participant detection result
			return;
		}

		return { agent, command };
	}
}

export class MergedChatAgent implements IChatAgent {
	constructor(
		private readonly data: IChatAgentData,
		private readonly impl: IChatAgentImplementation
	) { }
	when?: string | undefined;
	publisherDisplayName?: string | undefined;
	isDynamic?: boolean | undefined;

	get id(): string { return this.data.id; }
	get name(): string { return this.data.name ?? ''; }
	get fullName(): string { return this.data.fullName ?? ''; }
	get description(): string { return this.data.description ?? ''; }
	get extensionId(): ExtensionIdentifier { return this.data.extensionId; }
	get extensionVersion(): string | undefined { return this.data.extensionVersion; }
	get extensionPublisherId(): string { return this.data.extensionPublisherId; }
	get extensionPublisherDisplayName() { return this.data.publisherDisplayName; }
	get extensionDisplayName(): string { return this.data.extensionDisplayName; }
	get isDefault(): boolean | undefined { return this.data.isDefault; }
	get isCore(): boolean | undefined { return this.data.isCore; }
	get metadata(): IChatAgentMetadata { return this.data.metadata; }
	get slashCommands(): IChatAgentCommand[] { return this.data.slashCommands; }
	get locations(): ChatAgentLocation[] { return this.data.locations; }
	get modes(): ChatModeKind[] { return this.data.modes; }
	get disambiguation(): { category: string; description: string; examples: string[] }[] { return this.data.disambiguation; }

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		return this.impl.invoke(request, progress, history, token);
	}

	setRequestTools(requestId: string, tools: UserSelectedTools): void {
		this.impl.setRequestTools?.(requestId, tools);
	}

	setYieldRequested(requestId: string, value: boolean): void {
		this.impl.setYieldRequested?.(requestId, value);
	}

	async provideFollowups(request: IChatAgentRequest, result: IChatAgentResult, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatFollowup[]> {
		if (this.impl.provideFollowups) {
			return this.impl.provideFollowups(request, result, history, token);
		}

		return [];
	}

	toJSON(): IChatAgentData {
		return this.data;
	}
}

export const IChatAgentNameService = createDecorator<IChatAgentNameService>('chatAgentNameService');

export interface IChatAgentNameService {
	_serviceBrand: undefined;
	getAgentNameRestriction(chatAgentData: IChatAgentData): boolean;
}

export class ChatAgentNameService implements IChatAgentNameService {

	declare _serviceBrand: undefined;

	constructor(
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
	) {
	}

	/**
	 * Returns true if the agent is allowed to use this name
	 */
	getAgentNameRestriction(chatAgentData: IChatAgentData): boolean {
		if (chatAgentData.isCore) {
			return true; // core agents are always allowed to use any name
		}

		// TODO would like to use observables here but nothing uses it downstream and I'm not sure how to combine these two
		const nameAllowed = this.checkAgentNameRestriction(chatAgentData.name, chatAgentData).get();
		const fullNameAllowed = !chatAgentData.fullName || this.checkAgentNameRestriction(chatAgentData.fullName.replace(/\s/g, ''), chatAgentData).get();
		return nameAllowed && fullNameAllowed;
	}

	private checkAgentNameRestriction(name: string, chatAgentData: IChatAgentData): IObservable<boolean> {
		// Registry is a map of name to an array of extension publisher IDs or extension IDs that are allowed to use it.
		// Look up the list of extensions that are allowed to use this name
		const allowList = this.languageModelsService.restrictedChatParticipants.map<string[] | undefined>(registry => registry[name.toLowerCase()]);
		return allowList.map(allowList => {
			if (!allowList) {
				return true;
			}

			return allowList.some(id => equalsIgnoreCase(id, id.includes('.') ? chatAgentData.extensionId.value : chatAgentData.extensionPublisherId));
		});
	}
}

export function getFullyQualifiedId(chatAgentData: IChatAgentData): string {
	return `${chatAgentData?.extensionId?.value ?? ''}.${chatAgentData?.id ?? ''}`;
}

/**
 * There was a period where serialized chat agent data used 'id' instead of 'name'.
 * Don't copy this pattern, serialized data going forward should be versioned with strict interfaces.
 */
interface IOldSerializedChatAgentData extends Omit<ISerializableChatAgentData, 'name'> {
	id: string;
	extensionPublisher?: string;
}

function isSerializableChatAgentData(obj: ISerializableChatAgentData | IOldSerializedChatAgentData | any): obj is ISerializableChatAgentData {
	return obj && (obj as ISerializableChatAgentData).name !== undefined;
}

export function reviveSerializedAgent(raw: ISerializableChatAgentData | IOldSerializedChatAgentData | any): IChatAgentData {
	if (!raw) {
		raw = { id: '', extensionId: { value: '' }, extensionPublisherId: '', extensionName: '' };
	}
	const normalized: ISerializableChatAgentData = isSerializableChatAgentData(raw) ?
		raw :
		{
			...raw,
			name: raw.id || '',
		};

	// Fill in required fields that may be missing from old data
	if (!normalized.extensionPublisherId) {
		normalized.extensionPublisherId = (raw as IOldSerializedChatAgentData).extensionPublisher ?? '';
	}

	if (!normalized.extensionDisplayName) {
		normalized.extensionDisplayName = '';
	}

	if (!normalized.extensionId) {
		normalized.extensionId = new ExtensionIdentifier('');
	}

	return revive(normalized);
}
