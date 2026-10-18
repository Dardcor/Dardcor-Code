/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAICustomizationWorkspaceService } from '../../common/aiCustomizationWorkspaceService.js';
import { IChatWidgetService } from '../chat.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { ChatModeKind } from '../../common/constants.js';
import { PromptsType } from '../../common/promptSyntax/promptTypes.js';
import { getPromptFileDefaultLocations } from '../../common/promptSyntax/config/promptFileLocations.js';
import { IPromptsService, PromptsStorage } from '../../common/promptSyntax/service/promptsService.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { localize } from '../../../../../nls.js';
import { ICustomizationHarnessService } from '../../common/customizationHarnessService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { PromptsServiceCustomizationItemProvider } from './promptsServiceCustomizationItemProvider.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { getChatSessionType } from '../../common/model/chatUri.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';

export class CustomizationCreatorService {

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IChatService private readonly chatService: IChatService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@IAICustomizationWorkspaceService private readonly workspaceService: IAICustomizationWorkspaceService,
		@IPromptsService private readonly promptsService: IPromptsService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICustomizationHarnessService private readonly harnessService: ICustomizationHarnessService,

	) { }

	async createWithAI(type: PromptsType): Promise<void> {
		const currentSessionResource = this.harnessService.activeSessionResource.get();


		const typeLabel = getTypeLabel(type);
		const name = await this.quickInputService.input({
			prompt: localize('generateName', "Name for the new {0}", typeLabel),
			placeHolder: localize('generateNamePlaceholder', "e.g., my-{0}", typeLabel),
			validateInput: async (value) => {
				if (!value || !value.trim()) {
					return localize('nameRequired', "Name is required");
				}
				return undefined;
			}
		});
		if (!name) {
			return;
		}
		const trimmedName = name.trim();


		const picker = this.instantiationService.createInstance(CustomizationLocationPicker);
		const targetDir = await picker.resolveTargetDirectoryWithPicker(
			currentSessionResource,
			type,
			'local',
		);
		if (targetDir === null) {
			return;
		}
		const systemInstructions = buildAgentInstructions(type, targetDir, trimmedName);
		const userMessage = buildUserMessage(type, targetDir, trimmedName);

		await this.commandService.executeCommand('workbench.action.chat.newChat');

		const widget = this.chatWidgetService.lastFocusedWidget;
		const sessionResource = widget?.viewModel?.sessionResource;
		if (!sessionResource) {
			return;
		}

		await this.chatService.sendRequest(sessionResource, userMessage, {
			modeInfo: {
				kind: ChatModeKind.Agent,
				isBuiltin: false,
				telemetryModeId: 'custom',
				applyCodeBlockSuggestionId: undefined,
				modeInstructions: {
					name: 'customization-creator',
					content: systemInstructions,
					toolReferences: [],
					allowedSubagents: undefined,
				},
			},
		});
	}

	resolveTargetDirectory(type: PromptsType): URI | undefined {
		return resolveWorkspaceTargetDirectory(this.workspaceService, type);
	}

	async resolveUserDirectory(type: PromptsType): Promise<URI | undefined> {
		return resolveUserTargetDirectory(this.promptsService, type);
	}
}


export class CustomizationLocationPicker {
	constructor(
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ICustomizationHarnessService private readonly harnessService: ICustomizationHarnessService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILabelService private readonly labelService: ILabelService
	) { }

	public async resolveTargetDirectoryWithPicker(sessionResource: URI, type: PromptsType, target: 'local' | 'user'): Promise<URI | undefined | null> {
		const sessionType = getChatSessionType(sessionResource);
		const descriptor = this.harnessService.findHarnessById(sessionType);
		const provider = descriptor?.itemProvider ?? this.instantiationService.createInstance(PromptsServiceCustomizationItemProvider);
		if (!provider.provideSourceFolders) {
			return undefined;
		}
		const allFolders = await provider.provideSourceFolders(sessionResource, type, CancellationToken.None);
		if (!allFolders) {
			return undefined;
		}

		const matchingFolders = allFolders.filter(f => f.source === target);
		if (matchingFolders.length === 0) {
			return undefined;
		}

		if (matchingFolders.length === 1) {
			return matchingFolders[0].uri;
		}

		const items: (IQuickPickItem & { uri: URI })[] = matchingFolders.map(folder => ({
			label: folder.label,
			description: this.labelService.getUriLabel(folder.uri, { relative: true }),
			uri: folder.uri,
		}));

		const picked = await this.quickInputService.pick(items, {
			placeHolder: localize('selectTargetDirectory', "Select a directory for the new customization file"),
		});

		return picked?.uri ?? null;
	}
}

export function resolveWorkspaceTargetDirectory(workspaceService: IAICustomizationWorkspaceService, type: PromptsType): URI | undefined {
	const basePath = workspaceService.getActiveProjectRoot();
	if (!basePath) {
		return undefined;
	}
	const defaultLocations = getPromptFileDefaultLocations(type);
	const localLocation = defaultLocations.find(loc => loc.storage === PromptsStorage.local);
	if (!localLocation) {
		return basePath;
	}
	return URI.joinPath(basePath, localLocation.path);
}

export async function resolveUserTargetDirectory(
	promptsService: IPromptsService,
	type: PromptsType,
): Promise<URI | undefined> {
	const folders = await promptsService.getSourceFolders(type);
	const userFolder = folders.find(f => f.storage === PromptsStorage.user);
	return userFolder?.uri;
}


function buildAgentInstructions(type: PromptsType, targetDir: URI | undefined, name: string): string {
	const targetHint = targetDir
		? `\nIMPORTANT: Save the file to this directory: ${targetDir.fsPath}. The name is "${name}".`
		: `\nThe name is "${name}".`;

	const writePolicy = `

CRITICAL WORKFLOW:
- In your VERY FIRST response, you MUST immediately create the file on disk from a starter template with placeholder content. Do not ask questions first -- write the file first so it appears in the diff view, then ask the user how they want to customize it.
- Every subsequent message from the user should result in you updating that same file on disk with the requested changes.
- Always write the complete file content, not partial diffs.${targetHint}`;

	switch (type) {
		case PromptsType.agent:
			return `You are a helpful assistant that guides users through creating a new custom AI agent.${writePolicy}

Create a file named "${name}.agent.md" with YAML frontmatter (name, description, tools) and system instructions. Ask the user what it should do.`;

		case PromptsType.skill:
			return `You are a helpful assistant that guides users through creating a new skill.${writePolicy}

Create a directory named "${name}" with a SKILL.md file inside it. The file should have YAML frontmatter (name, description) and instructions. Ask the user what it does.`;

		case PromptsType.instructions:
			return `You are a helpful assistant that guides users through creating a new instructions file.${writePolicy}

Create a file named "${name}.instructions.md" with YAML frontmatter (description, optional applyTo) and actionable content. Ask the user what it should cover.`;

		case PromptsType.prompt:
			return `You are a helpful assistant that guides users through creating a new reusable prompt.${writePolicy}

Create a file named "${name}.prompt.md" with YAML frontmatter (name, description) and prompt content. Ask the user what it should do.`;

		case PromptsType.hook:
			return `You are a helpful assistant that guides users through creating a new hook.${writePolicy}

Ask the user when the hook should trigger and what it should do, then write the configuration file.`;

		default:
			return `You are a helpful assistant that guides users through creating a new AI customization file.${writePolicy}

Ask the user what they want to create, then guide them step by step.`;
	}
}



function buildUserMessage(type: PromptsType, targetDir: URI | undefined, name: string): string {
	const pathHint = targetDir ? ` Write it to \`${targetDir.fsPath}\`.` : '';

	switch (type) {
		case PromptsType.agent:
			return `Help me create a new custom agent called "${name}".${pathHint}`;
		case PromptsType.skill:
			return `Help me create a new skill called "${name}".${pathHint}`;
		case PromptsType.instructions:
			return `Help me create new instructions called "${name}".${pathHint}`;
		case PromptsType.prompt:
			return `Help me create a new prompt called "${name}".${pathHint}`;
		case PromptsType.hook:
			return `Help me create a new hook called "${name}".${pathHint}`;
		default:
			return `Help me create a new customization called "${name}".${pathHint}`;
	}
}

function getTypeLabel(type: PromptsType): string {
	switch (type) {
		case PromptsType.agent: return 'agent';
		case PromptsType.skill: return 'skill';
		case PromptsType.instructions: return 'instructions';
		case PromptsType.prompt: return 'prompt';
		case PromptsType.hook: return 'hook';
		default: return 'customization';
	}
}

