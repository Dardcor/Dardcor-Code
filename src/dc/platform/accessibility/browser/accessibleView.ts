/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IKeyboardEvent } from '../../keybinding/common/keybinding.js';
import { IPickerQuickAccessItem } from '../../quickinput/browser/pickerQuickAccess.js';
import { Event } from '../../../base/common/event.js';
import { IAction } from '../../../base/common/actions.js';
import { IQuickPickItem } from '../../quickinput/common/quickInput.js';
import { IDisposable, Disposable } from '../../../base/common/lifecycle.js';

export const IAccessibleViewService = createDecorator<IAccessibleViewService>('accessibleViewService');

export const enum AccessibleViewProviderId {
	Terminal = 'terminal',
	TerminalChat = 'terminal-chat',
	TerminalHelp = 'terminal-help',
	DiffEditor = 'diffEditor',
	MergeEditor = 'mergeEditor',
	PanelChat = 'panelChat',
	ChatTerminalOutput = 'chatTerminalOutput',
	ChatThinking = 'chatThinking',
	InlineChat = 'inlineChat',
	AgentChat = 'agentChat',
	QuickChat = 'quickChat',
	ChatInputWindow = 'chatInputWindow',
	InlineCompletions = 'inlineCompletions',
	KeybindingsEditor = 'keybindingsEditor',
	Notebook = 'notebook',
	ReplEditor = 'replEditor',
	Editor = 'editor',
	Hover = 'hover',
	Notification = 'notification',
	EmptyEditorHint = 'emptyEditorHint',
	Comments = 'comments',
	CommentThread = 'commentThread',
	Repl = 'repl',
	ReplHelp = 'replHelp',
	RunAndDebug = 'runAndDebug',
	Walkthrough = 'walkthrough',
	SourceControl = 'scm',
	EditorFindHelp = 'editorFindHelp',
	SearchHelp = 'searchHelp',
	TerminalFindHelp = 'terminalFindHelp',
	WebviewFindHelp = 'webviewFindHelp',
	OutputFindHelp = 'outputFindHelp',
	ProblemsFilterHelp = 'problemsFilterHelp',
	SessionsChat = 'sessionsChat',
	SessionsChanges = 'sessionsChanges',
	Survey = 'survey',
	Automations = 'automations',
	BrowserElementCommenting = 'browserElementCommenting',
	ChatFindHelp = 'chatFindHelp',
	ChatPetAchievements = 'chatPetAchievements',
}

export const enum AccessibleViewType {
	Help = 'help',
	View = 'view'
}

export const enum NavigationType {
	Previous = 'previous',
	Next = 'next'
}

export interface IAccessibleViewOptions {
	readMoreUrl?: string;
	language?: string;
	type: AccessibleViewType;
	position?: 'bottom' | 'initial-bottom' | 'initial-bottom-preserve';
	customHelp?: () => string;
	id?: AccessibleViewProviderId;

	configureKeybindingItems?: IQuickPickItem[];

	configuredKeybindingItems?: IQuickPickItem[];
}


export interface IAccessibleViewContentProvider extends IBasicContentProvider, IDisposable {
	id: AccessibleViewProviderId;
	verbositySettingKey: string;
	onKeyDown?(e: IKeyboardEvent): void;
	getSymbols?(): IAccessibleViewSymbol[];
	readonly onDidRequestClearLastProvider?: Event<AccessibleViewProviderId>;
}


export interface IAccessibleViewSymbol extends IPickerQuickAccessItem {
	markdownToParse?: string;
	firstListItem?: string;
	lineNumber?: number;
	endLineNumber?: number;
}

export interface IPosition {
	lineNumber: number;
	column: number;
}

export interface IAccessibleViewService {
	readonly _serviceBrand: undefined;
	show(provider: AccesibleViewContentProvider, position?: IPosition): void;
	showLastProvider(id: AccessibleViewProviderId): void;
	showAccessibleViewHelp(): void;
	next(): void;
	previous(): void;
	navigateToCodeBlock(type: 'next' | 'previous'): void;
	goToSymbol(): void;
	disableHint(): void;
	getPosition(id: AccessibleViewProviderId): IPosition | undefined;
	setPosition(position: IPosition, reveal?: boolean, select?: boolean): void;
	getLastPosition(): IPosition | undefined;
	getOpenAriaHint(verbositySettingKey: string): string | null;
	getCodeBlockContext(): ICodeBlockActionContext | undefined;
	configureKeybindings(unassigned: boolean): void;
	openHelpLink(): void;
}


export interface ICodeBlockActionContext {
	code: string;
	languageId?: string;
	codeBlockIndex: number;
	element: unknown;
}

export type AccesibleViewContentProvider = AccessibleContentProvider | ExtensionContentProvider;

export class AccessibleContentProvider extends Disposable implements IAccessibleViewContentProvider {

	constructor(
		public id: AccessibleViewProviderId,
		public options: IAccessibleViewOptions,
		public provideContent: () => string,
		public onClose: () => void,
		public verbositySettingKey: string,
		public onOpen?: () => void,
		public actions?: IAction[],
		public provideNextContent?: () => string | undefined,
		public providePreviousContent?: () => string | undefined,
		public onDidChangeContent?: Event<void>,
		public onKeyDown?: (e: IKeyboardEvent) => void,
		public getSymbols?: () => IAccessibleViewSymbol[],
		public onDidRequestClearLastProvider?: Event<AccessibleViewProviderId>,
	) {
		super();
	}
}

export function isIAccessibleViewContentProvider(obj: unknown): obj is IAccessibleViewContentProvider {
	if (!obj || typeof obj !== 'object') {
		return false;
	}

	const candidate = obj as Partial<IAccessibleViewContentProvider>;
	return !!candidate.id
		&& !!candidate.options
		&& typeof candidate.provideContent === 'function'
		&& typeof candidate.onClose === 'function'
		&& typeof candidate.verbositySettingKey === 'string';
}

export class ExtensionContentProvider extends Disposable implements IBasicContentProvider {

	constructor(
		public readonly id: string,
		public options: IAccessibleViewOptions,
		public provideContent: () => string,
		public onClose: () => void,
		public onOpen?: () => void,
		public provideNextContent?: () => string | undefined,
		public providePreviousContent?: () => string | undefined,
		public actions?: IAction[],
		public onDidChangeContent?: Event<void>,
	) {
		super();
	}
}

export interface IBasicContentProvider extends IDisposable {
	id: string;
	options: IAccessibleViewOptions;
	onClose(): void;
	provideContent(): string;
	onOpen?(): void;
	actions?: IAction[];
	providePreviousContent?(): void;
	provideNextContent?(): void;
	readonly onDidChangeContent?: Event<void>;
}
