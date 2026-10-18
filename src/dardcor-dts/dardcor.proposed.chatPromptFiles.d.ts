/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export type ChatResourceSource = 'local' | 'user' | 'extension' | 'plugin' | 'builtin';

	export interface ChatResource {
		readonly uri: Uri;

		readonly when?: string;

		readonly sessionTypes?: readonly string[];
	}

	export interface ChatCustomAgent {
		readonly uri: Uri;

		readonly name: string;

		readonly description?: string;

		readonly source: ChatResourceSource;

		readonly sessionTypes?: readonly string[];

		readonly extensionId?: string;

		readonly pluginUri?: Uri;

		readonly argumentHint?: string;

		readonly tools?: readonly string[];

		readonly model?: readonly string[];

		readonly userInvocable: boolean;

		readonly disableModelInvocation: boolean;

		readonly enabled: boolean;
	}

	export interface ChatInstruction {
		readonly uri: Uri;

		readonly name: string;

		readonly description?: string;

		readonly source: ChatResourceSource;

		readonly sessionTypes?: readonly string[];

		readonly extensionId?: string;

		readonly pluginUri?: Uri;

		readonly pattern?: string;
	}

	export interface ChatSkill {
		readonly uri: Uri;

		readonly name: string;

		readonly description?: string;

		readonly source: ChatResourceSource;

		readonly sessionTypes?: readonly string[];

		readonly extensionId?: string;

		readonly pluginUri?: Uri;

		readonly userInvocable?: boolean;

		readonly disableModelInvocation: boolean;
	}

	export interface ChatSlashCommand {
		readonly uri: Uri;

		readonly name: string;

		readonly description?: string;

		readonly source: ChatResourceSource;

		readonly sessionTypes?: readonly string[];

		readonly extensionId?: string;

		readonly pluginUri?: Uri;

		readonly argumentHint?: string;

		readonly userInvocable?: boolean;
	}

	export interface ChatHook {
		readonly uri: Uri;
		readonly sessionTypes?: readonly string[];

		readonly source: ChatResourceSource;

		readonly extensionId?: string;

		readonly pluginUri?: Uri;

	}

	export interface ChatPlugin {
		readonly uri: Uri;
		readonly sessionTypes?: readonly string[];

	}



	export interface ChatCustomAgentProvider {
		readonly onDidChangeCustomAgents?: Event<void>;

		provideCustomAgents(context: unknown, token: CancellationToken): ProviderResult<ChatResource[]>;
	}

	export interface ChatInstructionsProvider {
		readonly onDidChangeInstructions?: Event<void>;

		provideInstructions(context: unknown, token: CancellationToken): ProviderResult<ChatResource[]>;
	}

	export interface ChatPromptFileProvider {
		readonly onDidChangePromptFiles?: Event<void>;

		providePromptFiles(context: unknown, token: CancellationToken): ProviderResult<ChatResource[]>;
	}



	export interface ChatHookProvider {
		readonly onDidChangeHooks?: Event<void>;

		provideHooks(context: unknown, token: CancellationToken): ProviderResult<ChatResource[]>;
	}



	export interface ChatSkillProvider {
		readonly onDidChangeSkills?: Event<void>;

		provideSkills(context: unknown, token: CancellationToken): ProviderResult<ChatResource[]>;
	}



	export namespace chat {
		export const onDidChangeCustomAgents: Event<void>;


		export function getCustomAgents(token: CancellationToken): Thenable<readonly ChatCustomAgent[]>;

		export const onDidChangeInstructions: Event<void>;


		export function getInstructions(token: CancellationToken): Thenable<readonly ChatInstruction[]>;

		export const onDidChangeSkills: Event<void>;


		export function getSkills(token: CancellationToken): Thenable<readonly ChatSkill[]>;

		export const onDidChangeSlashCommands: Event<void>;


		export function getSlashCommands(token: CancellationToken): Thenable<readonly ChatSlashCommand[]>;

		export const onDidChangeHooks: Event<void>;


		export function getHooks(token: CancellationToken): Thenable<readonly ChatHook[]>;

		export const onDidChangePlugins: Event<void>;


		export function getPlugins(token: CancellationToken): Thenable<readonly ChatPlugin[]>;

		export function registerCustomAgentProvider(provider: ChatCustomAgentProvider): Disposable;

		export function registerInstructionsProvider(provider: ChatInstructionsProvider): Disposable;

		export function registerPromptFileProvider(provider: ChatPromptFileProvider): Disposable;

		export function registerSkillProvider(provider: ChatSkillProvider): Disposable;

		export function registerHookProvider(provider: ChatHookProvider): Disposable;
	}

}
