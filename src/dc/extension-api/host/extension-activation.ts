/**
 * Dardcor Code - Extension Activation Event Trigger Evaluator (Task 621)
 * Mirrors: vs/workbench/api/common/extHostExtensionService.ts (Activation Events)
 */

import { match as globMatch } from '../../core/formatting/glob';

export interface IActivationTrigger {
	readonly language?: string;
	readonly command?: string;
	readonly view?: string;
	readonly debugType?: string;
	readonly uri?: string;
	readonly scheme?: string;
	readonly customEditor?: string;
	readonly webviewPanel?: string;
	readonly workspaceContains?: string;
	readonly workspaceFolderUri?: string;
	readonly fileSystem?: string;
	readonly notebookType?: string;
	readonly chatParticipant?: string;
	readonly startup?: boolean;
}

export type ActivationEventKind =
	| 'onLanguage'
	| 'onCommand'
	| 'onView'
	| 'onDebug'
	| 'onDebugResolve'
	| 'onDebugDynamicConfigurations'
	| 'workspaceContains'
	| 'onFileSystem'
	| 'onUri'
	| 'onStartupFinished'
	| 'onCustomEditor'
	| 'onWebviewPanel'
	| 'onNotebook'
	| 'onChatParticipant'
	| 'onRendererProcess'
	| '*';

export const VALID_ACTIVATION_EVENT_KINDS: ReadonlySet<string> = new Set<ActivationEventKind>([
	'onLanguage',
	'onCommand',
	'onView',
	'onDebug',
	'onDebugResolve',
	'onDebugDynamicConfigurations',
	'workspaceContains',
	'onFileSystem',
	'onUri',
	'onStartupFinished',
	'onCustomEditor',
	'onWebviewPanel',
	'onNotebook',
	'onChatParticipant',
	'onRendererProcess',
	'*'
]);

export interface IWorkspaceContainsMatcher {
	(pattern: string, workspaceFolderUri?: string): boolean | Promise<boolean>;
}

/**
 * Evaluates whether an extension's declared activation events match a
 * runtime trigger (document language, executed command, workspace file, ...).
 */
export class ExtensionActivationEvaluator {
	constructor(
		private readonly _workspaceContainsMatcher: IWorkspaceContainsMatcher = () => false
	) {}

	public isActivationEvent(activationEvent: string): boolean {
		if (activationEvent === '*') {
			return true;
		}
		const idx = activationEvent.indexOf(':');
		const kind = idx === -1 ? activationEvent : activationEvent.substring(0, idx);
		return VALID_ACTIVATION_EVENT_KINDS.has(kind);
	}

	public isEagerActivation(activationEvents: string[] | undefined): boolean {
		if (!activationEvents || activationEvents.length === 0) {
			return false;
		}
		return activationEvents.includes('*') || activationEvents.includes('onStartupFinished');
	}

	public async matches(activationEvents: string[] | undefined, trigger: IActivationTrigger): Promise<boolean> {
		if (!activationEvents || activationEvents.length === 0) {
			return false;
		}
		for (const event of activationEvents) {
			if (await this.matchesEvent(event, trigger)) {
				return true;
			}
		}
		return false;
	}

	public async matchesEvent(activationEvent: string, trigger: IActivationTrigger): Promise<boolean> {
		if (activationEvent === '*') {
			return true;
		}
		const idx = activationEvent.indexOf(':');
		const kind = idx === -1 ? activationEvent : activationEvent.substring(0, idx);
		const target = idx === -1 ? '' : activationEvent.substring(idx + 1);
		switch (kind) {
			case 'onLanguage':
				return trigger.language !== undefined && trigger.language === target;
			case 'onCommand':
				return trigger.command !== undefined && trigger.command === target;
			case 'onView':
				return trigger.view !== undefined && trigger.view === target;
			case 'onDebug':
				return trigger.debugType !== undefined && trigger.debugType === target;
			case 'onDebugResolve':
				return trigger.debugType !== undefined && trigger.debugType === target;
			case 'onDebugDynamicConfigurations':
				return trigger.debugType !== undefined;
			case 'workspaceContains':
				return await this._workspaceContainsMatcher(target, trigger.workspaceFolderUri);
			case 'onFileSystem':
				return trigger.scheme !== undefined && trigger.scheme === target;
			case 'onUri':
				return trigger.uri !== undefined && (target === '' || trigger.uri.startsWith(target));
			case 'onStartupFinished':
				return !!trigger.startup;
			case 'onCustomEditor':
				return trigger.customEditor !== undefined && trigger.customEditor === target;
			case 'onWebviewPanel':
				return trigger.webviewPanel !== undefined && trigger.webviewPanel === target;
			case 'onNotebook':
				return trigger.notebookType !== undefined && trigger.notebookType === target;
			case 'onChatParticipant':
				return trigger.chatParticipant !== undefined && trigger.chatParticipant === target;
			case 'onRendererProcess':
				return true;
			default:
				return false;
		}
	}

	/**
	 * Basic `workspaceContains` check used when no explicit matcher is
	 * configured: literal paths are tested as-is, glob patterns are
	 * evaluated against the provided file list.
	 */
	public static createGlobWorkspaceContainsMatcher(fileListProvider: () => string[]): IWorkspaceContainsMatcher {
		return (pattern: string) => {
			const files = fileListProvider();
			for (const file of files) {
				const normalized = file.replace(/\\/g, '/');
				if (globMatch(pattern, normalized)) {
					return true;
				}
			}
			return false;
		};
	}
}
