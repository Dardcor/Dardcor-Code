/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IObservable } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { PromptsType } from './promptSyntax/promptTypes.js';
import { IChatPromptSlashCommand } from './promptSyntax/service/promptsService.js';

export const IAICustomizationWorkspaceService = createDecorator<IAICustomizationWorkspaceService>('aiCustomizationWorkspaceService');

export type AICustomizationSource = 'local' | 'user' | 'extension' | 'plugin' | 'builtin';

export namespace AICustomizationSources {
	export const local: AICustomizationSource = 'local';
	export const user: AICustomizationSource = 'user';
	export const extension: AICustomizationSource = 'extension';
	export const plugin: AICustomizationSource = 'plugin';
	export const builtin: AICustomizationSource = 'builtin';
	export const all: AICustomizationSource[] = [local, user, extension, plugin, builtin];
}

export const BUILTIN_STORAGE = AICustomizationSources.builtin;

export const AICustomizationManagementSection = {
	Agents: 'agents',
	Skills: 'skills',
	Instructions: 'instructions',
	Prompts: 'prompts',
	Hooks: 'hooks',
	Automations: 'automations',
	McpServers: 'mcpServers',
	Plugins: 'plugins',
	Models: 'models',
	Tools: 'tools',
	HarnessSettings: 'harnessSettings',
} as const;

export type AICustomizationManagementSection = typeof AICustomizationManagementSection[keyof typeof AICustomizationManagementSection];

export const AICustomizationManagementCommands = {
	OpenEditor: 'aiCustomization.openManagementEditor',
	OpenMarketplace: 'aiCustomization.openMarketplace',
	CreateNewAgent: 'aiCustomization.createNewAgent',
	CreateNewSkill: 'aiCustomization.createNewSkill',
	CreateNewInstructions: 'aiCustomization.createNewInstructions',
	CreateNewPrompt: 'aiCustomization.createNewPrompt',
	GenerateDebugReport: 'aiCustomization.generateDebugReport',
	DismissMigrationHint: 'aiCustomization.dismissMigrationHint',
} as const;

export function getCustomizationMigrationHintDismissedStorageKey(sessionType: string): string {
	return `chat.customizationMigrationHint.dismissed.${sessionType}`;
}

export interface IWelcomePageFeatures {
	readonly showGettingStartedBanner: boolean;
}

export interface IAICustomizationWorkspaceService {
	readonly _serviceBrand: undefined;

	readonly activeProjectRoot: IObservable<URI | undefined>;

	readonly activeProjectLabel: IObservable<string | undefined>;

	getActiveProjectRoot(): URI | undefined;

	readonly managementSections: readonly AICustomizationManagementSection[];

	readonly welcomePageFeatures: IWelcomePageFeatures;

	commitFiles(projectRoot: URI, fileUris: URI[]): Promise<void>;

	deleteFiles(projectRoot: URI, fileUris: URI[]): Promise<void>;

	generateCustomization(type: PromptsType): Promise<void>;

	readonly hasOverrideProjectRoot: IObservable<boolean>;

	setOverrideProjectRoot(root: URI): void;

	clearOverrideProjectRoot(): void;

	getFilteredPromptSlashCommands(token: CancellationToken): Promise<readonly IChatPromptSlashCommand[]>;

	getSkillUIIntegrations(): ReadonlyMap<string, string>;
}
