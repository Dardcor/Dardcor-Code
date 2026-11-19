/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';
import { URI } from '../../../../../../base/common/uri.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { AgentInstructionFileType, IExtensionPromptPath, IPromptPath, IPromptsService, PromptsStorage } from '../../../common/promptSyntax/service/promptsService.js';
import { basename, dirname, extUri, joinPath } from '../../../../../../base/common/resources.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { IDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { getCleanPromptName, getSkillFolderName } from '../../../common/promptSyntax/config/promptFileLocations.js';
import { PromptsType, INSTRUCTIONS_DOCUMENTATION_URL, AGENT_DOCUMENTATION_URL, PROMPT_DOCUMENTATION_URL, SKILL_DOCUMENTATION_URL, HOOK_DOCUMENTATION_URL } from '../../../common/promptSyntax/promptTypes.js';
import { NEW_PROMPT_COMMAND_ID, NEW_INSTRUCTIONS_COMMAND_ID, NEW_AGENT_COMMAND_ID, NEW_SKILL_COMMAND_ID } from '../newPromptFileActions.js';
import { GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID, GENERATE_ON_DEMAND_INSTRUCTIONS_COMMAND_ID, GENERATE_PROMPT_COMMAND_ID, GENERATE_SKILL_COMMAND_ID, GENERATE_AGENT_COMMAND_ID } from '../../actions/chatActions.js';
import { IKeyMods, IQuickInputButton, IQuickInputService, IQuickPick, IQuickPickItem, IQuickPickItemButtonEvent, IQuickPickSeparator } from '../../../../../../platform/quickinput/common/quickInput.js';
import { askForPromptFileName } from './askForPromptName.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { askForPromptSourceFolder } from './askForPromptSourceFolder.js';
import { ILabelService } from '../../../../../../platform/label/common/label.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { PromptFileRewriter } from '../promptFileRewriter.js';
import { isOrganizationPromptFile } from '../../../common/promptSyntax/utils/promptsServiceUtils.js';
import { assertNever } from '../../../../../../base/common/assert.js';

export interface ISelectOptions {

	readonly placeholder: string;

	readonly resource?: URI;

	readonly type: PromptsType;

	readonly optionNew?: boolean;
	readonly optionEdit?: boolean;
	readonly optionDelete?: boolean;
	readonly optionRename?: boolean;
	readonly optionCopy?: boolean;
	readonly optionVisibility?: boolean;
	readonly optionRun?: boolean;
}

export interface ISelectPromptResult {
	readonly promptFile: URI;

	readonly keyMods: IKeyMods;
}

function newHelpButton(type: PromptsType): IQuickInputButton & { helpURI: URI } {
	const iconClass = ThemeIcon.asClassName(Codicon.question);
	switch (type) {
		case PromptsType.prompt:
			return {
				tooltip: localize('help.prompt', "Show help on prompt files"),
				helpURI: URI.parse(PROMPT_DOCUMENTATION_URL),
				iconClass
			};
		case PromptsType.instructions:
			return {
				tooltip: localize('help.instructions', "Show help on instruction files"),
				helpURI: URI.parse(INSTRUCTIONS_DOCUMENTATION_URL),
				iconClass
			};
		case PromptsType.agent:
			return {
				tooltip: localize('help.agent', "Show help on custom agent files"),
				helpURI: URI.parse(AGENT_DOCUMENTATION_URL),
				iconClass
			};
		case PromptsType.skill:
			return {
				tooltip: localize('help.skill', "Show help on skill files"),
				helpURI: URI.parse(SKILL_DOCUMENTATION_URL),
				iconClass
			};
		case PromptsType.hook:
			return {
				tooltip: localize('help.hook', "Show help on hook files"),
				helpURI: URI.parse(HOOK_DOCUMENTATION_URL),
				iconClass
			};
	}
}

function isHelpButton(button: IQuickInputButton): button is IQuickInputButton & { helpURI: URI } {
	return (<{ helpURI: URI }>button).helpURI !== undefined;
}

interface IPromptPickerQuickPickItem extends IQuickPickItem {

	type: 'item';

	promptFileUri?: URI;

	commandId?: string;
}

function isPromptFileItem(item: IPromptPickerQuickPickItem | IQuickPickSeparator): item is IPromptPickerQuickPickItem & { promptFileUri: URI } {
	return item.type === 'item' && !!item.promptFileUri;
}

function isExtensionPromptPath(prompt: IPromptPath): prompt is IExtensionPromptPath {
	return prompt.storage === PromptsStorage.extension && !!prompt.extension;
}

type IPromptQuickPick = IQuickPick<IPromptPickerQuickPickItem, { useSeparators: true }>;

const NEW_PROMPT_FILE_OPTION: IPromptPickerQuickPickItem = {
	type: 'item',
	label: `$(plus) ${localize(
		'commands.new-promptfile.select-dialog.label',
		'New prompt file...'
	)}`,
	pickable: false,
	alwaysShow: true,
	buttons: [newHelpButton(PromptsType.prompt)],
	commandId: NEW_PROMPT_COMMAND_ID,
};

const NEW_INSTRUCTIONS_FILE_OPTION: IPromptPickerQuickPickItem = {
	type: 'item',
	label: `$(plus) ${localize(
		'commands.new-instructionsfile.select-dialog.label',
		'New instruction file...',
	)}`,
	pickable: false,
	alwaysShow: true,
	buttons: [newHelpButton(PromptsType.instructions)],
	commandId: NEW_INSTRUCTIONS_COMMAND_ID,
};

const GENERATE_AGENT_INSTRUCTIONS_OPTION: IPromptPickerQuickPickItem = {
	type: 'item',
	label: `$(sparkle) ${localize(
		'commands.generate-agent-instructions.select-dialog.label',
		'Generate agent instructions...',
	)}`,
	pickable: false,
	alwaysShow: true,
	buttons: [newHelpButton(PromptsType.instructions)],
	commandId: GENERATE_AGENT_INSTRUCTIONS_COMMAND_ID,
};

const GENERATE_ON_DEMAND_INSTRUCTIONS_OPTION: IPromptPickerQuickPickItem = {
	type: 'item',
	label: `$(sparkle) ${localize(
		'commands.generate-on-demand-instructions.select-dialog.label',
		'Generate on-demand instructions...',
	)}`,
	pickable: false,
	alwaysShow: true,
	buttons: [newHelpButton(PromptsType.instructions)],
	commandId: GENERATE_ON_DEMAND_INSTRUCTIONS_COMMAND_ID,
};

const NEW_AGENT_FILE_OPTION: IPromptPickerQuickPickItem = {
	type: 'item',
	label: `$(plus) ${localize(
		'commands.new-agentfile.select-dialog.label',
		'Create new custom agent...',
	)}`,
	pickable: false,
	alwaysShow: true,
	buttons: [newHelpButton(PromptsType.agent)],
	commandId: NEW_AGENT_COMMAND_ID,
};

const NEW_SKILL_FILE_OPTION: IPromptPickerQuickPickItem = {
	type: 'item',
	label: `$(plus) ${localize(
		'commands.new-skill.select-dialog.label',
		'New skill...',
	)}`,
	pickable: false,
	alwaysShow: true,
	buttons: [newHelpButton(PromptsType.skill)],
	commandId: NEW_SKILL_COMMAND_ID,
};

const GENERATE_PROMPT_OPTION: IPromptPickerQuickPickItem = {
	type: 'item',
	label: `$(sparkle) ${localize(
		'commands.generate-prompt.select-dialog.label',
		'Generate prompt...',
	)}`,
	pickable: false,
	alwaysShow: true,
	buttons: [newHelpButton(PromptsType.prompt)],
	commandId: GENERATE_PROMPT_COMMAND_ID,
};

const GENERATE_SKILL_OPTION: IPromptPickerQuickPickItem = {
	type: 'item',
	label: `$(sparkle) ${localize(
		'commands.generate-skill.select-dialog.label',
		'Generate skill...',
	)}`,
	pickable: false,
	alwaysShow: true,
	buttons: [newHelpButton(PromptsType.skill)],
	commandId: GENERATE_SKILL_COMMAND_ID,
};

const GENERATE_AGENT_OPTION: IPromptPickerQuickPickItem = {
	type: 'item',
	label: `$(sparkle) ${localize(
		'commands.generate-agent.select-dialog.label',
		'Generate agent...',
	)}`,
	pickable: false,
	alwaysShow: true,
	buttons: [newHelpButton(PromptsType.agent)],
	commandId: GENERATE_AGENT_COMMAND_ID,
};

const EDIT_BUTTON: IQuickInputButton = {
	tooltip: localize('open', "Open in Editor"),
	iconClass: ThemeIcon.asClassName(Codicon.fileCode),
};

const DELETE_BUTTON: IQuickInputButton = {
	tooltip: localize('delete', "Delete"),
	iconClass: ThemeIcon.asClassName(Codicon.trash),
};

const RENAME_BUTTON: IQuickInputButton = {
	tooltip: localize('rename', "Move and/or Rename"),
	iconClass: ThemeIcon.asClassName(Codicon.replace),
};

const COPY_BUTTON: IQuickInputButton = {
	tooltip: localize('makeACopy', "Make a Copy"),
	iconClass: ThemeIcon.asClassName(Codicon.copy),
};

const MAKE_VISIBLE_BUTTON: IQuickInputButton = {
	tooltip: localize('makeVisible', "Hidden from chat view agent picker. Click to show."),
	iconClass: ThemeIcon.asClassName(Codicon.eyeClosed),
	alwaysVisible: true,
};

const MAKE_INVISIBLE_BUTTON: IQuickInputButton = {
	tooltip: localize('makeInvisible', "Shown in chat view agent picker. Click to hide."),
	iconClass: ThemeIcon.asClassName(Codicon.eye),
};

const RUN_IN_CHAT_BUTTON: IQuickInputButton = {
	tooltip: localize('runInChat', "Run in Chat View"),
	iconClass: ThemeIcon.asClassName(Codicon.play),
};

export class PromptFilePickers {
	constructor(
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IFileService private readonly _fileService: IFileService,
		@IDialogService private readonly _dialogService: IDialogService,
		@ICommandService private readonly _commandService: ICommandService,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@IPromptsService private readonly _promptsService: IPromptsService,
		@ILabelService private readonly _labelService: ILabelService,
		@IProductService private readonly _productService: IProductService,
	) {
	}

	async selectPromptFile(options: ISelectOptions): Promise<ISelectPromptResult | undefined> {

		const cts = new CancellationTokenSource();
		const quickPick: IPromptQuickPick = this._quickInputService.createQuickPick<IPromptPickerQuickPickItem>({ useSeparators: true });
		quickPick.busy = true;
		quickPick.placeholder = localize('searching', 'Searching file system...');

		try {
			const fileOptions = await this._createPromptPickItems(options, cts.token);
			const activeItem = options.resource && fileOptions.find(f => f.type === 'item' && extUri.isEqual(f.promptFileUri, options.resource)) as IPromptPickerQuickPickItem | undefined;
			if (activeItem) {
				quickPick.activeItems = [activeItem];
			}
			quickPick.placeholder = options.placeholder;
			quickPick.matchOnDescription = true;
			quickPick.items = fileOptions;
		} finally {
			quickPick.busy = false;
		}

		return new Promise<ISelectPromptResult | undefined>(resolve => {
			const disposables = new DisposableStore();

			let isResolved = false;
			let isClosed = false;

			disposables.add(quickPick);
			disposables.add(cts);

			const refreshItems = async () => {
				const active = quickPick.activeItems;
				const newItems = await this._createPromptPickItems(options, CancellationToken.None);
				quickPick.items = newItems;
				quickPick.activeItems = active;
			};

			disposables.add(quickPick.onDidAccept(async () => {
				const { selectedItems } = quickPick;
				const { keyMods } = quickPick;

				const selectedItem = selectedItems[0];
				if (isPromptFileItem(selectedItem)) {
					resolve({ promptFile: selectedItem.promptFileUri, keyMods: { ...keyMods } });
					isResolved = true;
				} else {
					if (selectedItem.commandId) {
						await this._commandService.executeCommand(selectedItem.commandId);
						return;
					}
				}

				quickPick.hide();
			}));

			disposables.add(quickPick.onDidTriggerItemButton(async e => {
				const shouldRefresh = await this._handleButtonClick(quickPick, e, options);
				if (!isClosed && shouldRefresh) {
					await refreshItems();
				}
			}));

			disposables.add(quickPick.onDidHide(() => {
				if (!quickPick.ignoreFocusOut) {
					disposables.dispose();
					isClosed = true;
					if (!isResolved) {
						resolve(undefined);
						isResolved = true;
					}
				}
			}));

			quickPick.show();
		});
	}


	private async _createPromptPickItems(options: ISelectOptions, token: CancellationToken): Promise<(IPromptPickerQuickPickItem | IQuickPickSeparator)[]> {
		const buttons: IQuickInputButton[] = [];
		if (options.type === PromptsType.prompt && options.optionRun !== false) {
			buttons.push(RUN_IN_CHAT_BUTTON);
		}
		if (options.optionEdit !== false) {
			buttons.push(EDIT_BUTTON);
		}
		if (options.optionCopy !== false) {
			buttons.push(COPY_BUTTON);
		}
		if (options.optionRename !== false) {
			buttons.push(RENAME_BUTTON);
		}
		if (options.optionDelete !== false) {
			buttons.push(DELETE_BUTTON);
		}
		const result: (IPromptPickerQuickPickItem | IQuickPickSeparator)[] = [];
		if (options.optionNew !== false) {
			result.push(...this._getNewItems(options.type));
		}

		let getVisibility: (p: IPromptPath) => boolean | undefined = () => undefined;
		if (options.optionVisibility) {
			const disabled = this._promptsService.getDisabledPromptFiles(options.type);
			getVisibility = p => !disabled.has(p.uri);
		}

		const sortByLabel = (items: IPromptPickerQuickPickItem[]): IPromptPickerQuickPickItem[] => items.sort((a, b) => a.label.localeCompare(b.label));

		const locals = await this._promptsService.listPromptFilesForStorage(options.type, PromptsStorage.local, token);
		if (locals.length) {
			result.push({ type: 'separator', label: localize('separator.workspace', "Workspace") });
			result.push(...sortByLabel(await Promise.all(locals.map(l => this._createPromptPickItem(l, buttons, getVisibility(l), token)))));
		}

		let agentInstructionFiles: IPromptPath[] = [];
		if (options.type === PromptsType.instructions) {
			const agentInstructionUris = await this._promptsService.listAgentInstructions(token);
			agentInstructionFiles = agentInstructionUris.map(agentInstructionFile => {
				const folderName = this._labelService.getUriLabel(dirname(agentInstructionFile.uri), { relative: true });
				return {
					uri: agentInstructionFile.uri,
					description: agentInstructionFile.type !== AgentInstructionFileType.copilotInstructionsMd ? folderName : undefined,
					storage: PromptsStorage.local,
					type: options.type
				} satisfies IPromptPath;
			});
		}
		if (agentInstructionFiles.length) {
			const agentButtons = buttons.filter(b => b !== RENAME_BUTTON);
			result.push({ type: 'separator', label: localize('separator.workspace-agent-instructions', "Agent Instructions") });
			result.push(...sortByLabel(await Promise.all(agentInstructionFiles.map(l => this._createPromptPickItem(l, agentButtons, getVisibility(l), token)))));
		}

		const exts = (await this._promptsService.listPromptFilesForStorage(options.type, PromptsStorage.extension, token)).filter(isExtensionPromptPath);
		if (exts.length) {
			const extButtons: IQuickInputButton[] = [];
			if (options.type === PromptsType.prompt && options.optionRun !== false) {
				extButtons.push(RUN_IN_CHAT_BUTTON);
			}
			if (options.optionEdit !== false) {
				extButtons.push(EDIT_BUTTON);
			}
			if (options.optionCopy !== false) {
				extButtons.push(COPY_BUTTON);
			}

			const groupedExts = new Map<string, IPromptPath[]>();
			for (const ext of exts) {
				const groupLabel = this._getExtensionGroupLabel(ext);
				if (!groupedExts.has(groupLabel)) {
					groupedExts.set(groupLabel, []);
				}
				groupedExts.get(groupLabel)!.push(ext);
			}

			const sortedGroupedExts = Array.from(groupedExts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
			for (const [groupLabel, groupExts] of sortedGroupedExts) {
				result.push({ type: 'separator', label: groupLabel });
				result.push(...sortByLabel(await Promise.all(groupExts.map(e => this._createPromptPickItem(e, extButtons, getVisibility(e), token)))));
			}
		}
		const users = await this._promptsService.listPromptFilesForStorage(options.type, PromptsStorage.user, token);
		if (users.length) {
			result.push({ type: 'separator', label: localize('separator.user', "User Data") });
			result.push(...sortByLabel(await Promise.all(users.map(u => this._createPromptPickItem(u, buttons, getVisibility(u), token)))));
		}

		const plugins = await this._promptsService.listPromptFilesForStorage(options.type, PromptsStorage.plugin, token);
		if (plugins.length) {
			const pluginButtons: IQuickInputButton[] = [];
			if (options.optionCopy !== false) {
				pluginButtons.push(COPY_BUTTON);
			}
			result.push({ type: 'separator', label: localize('separator.plugins', "Plugins") });
			result.push(...sortByLabel(await Promise.all(plugins.map(p => this._createPromptPickItem(p, pluginButtons, getVisibility(p), token)))));
		}

		return result;
	}

	private _getExtensionGroupLabel(extPath: IExtensionPromptPath): string {
		if (isOrganizationPromptFile(extPath.uri, extPath.extension.identifier, this._productService)) {
			return localize('separator.organization', "Organization");
		}

		return localize('separator.extensions', "Extensions");

	}

	private _getNewItems(type: PromptsType): IPromptPickerQuickPickItem[] {
		switch (type) {
			case PromptsType.prompt:
				return [NEW_PROMPT_FILE_OPTION, GENERATE_PROMPT_OPTION];
			case PromptsType.instructions:
				return [NEW_INSTRUCTIONS_FILE_OPTION, GENERATE_ON_DEMAND_INSTRUCTIONS_OPTION, GENERATE_AGENT_INSTRUCTIONS_OPTION];
			case PromptsType.agent:
				return [NEW_AGENT_FILE_OPTION, GENERATE_AGENT_OPTION];
			case PromptsType.skill:
				return [NEW_SKILL_FILE_OPTION, GENERATE_SKILL_OPTION];
			default:
				throw new Error(`Unknown prompt type '${type}'.`);
		}
	}

	private async _createPromptPickItem(promptFile: IPromptPath, buttons: IQuickInputButton[] | undefined, visibility: boolean | undefined, token: CancellationToken): Promise<IPromptPickerQuickPickItem> {
		const parsedPromptFile = await this._promptsService.parseNew(promptFile.uri, token).catch(() => undefined);
		let promptName = (parsedPromptFile?.header?.name ?? promptFile.name) || (promptFile.type === PromptsType.skill ? getSkillFolderName(promptFile.uri) : getCleanPromptName(promptFile.uri));
		const promptDescription = parsedPromptFile?.header?.description ?? promptFile.description;

		let tooltip: string | undefined;

		switch (promptFile.storage) {
			case PromptsStorage.extension:
				tooltip = promptFile.extension.displayName ?? promptFile.extension.id;
				break;
			case PromptsStorage.local:
				tooltip = this._labelService.getUriLabel(dirname(promptFile.uri), { relative: true });
				break;
			case PromptsStorage.user:
				tooltip = undefined;
				break;
			case PromptsStorage.plugin:
				tooltip = promptFile.name;
				break;
			case PromptsStorage.builtIn:
				tooltip = undefined;
				break;
			default:
				assertNever(promptFile);
		}
		let iconClass: string | undefined;
		if (visibility === false) {
			buttons = (buttons ?? []).concat(MAKE_VISIBLE_BUTTON);
			promptName = localize('hiddenLabelInfo', "{0} (hidden)", promptName);
			tooltip = localize('hiddenInAgentPicker', "Hidden from chat view agent picker");
		} else if (visibility === true) {
			buttons = (buttons ?? []).concat(MAKE_INVISIBLE_BUTTON);
		}
		return {
			id: promptFile.uri.toString(),
			type: 'item',
			label: promptName,
			description: promptDescription,
			iconClass,
			tooltip,
			promptFileUri: promptFile.uri,
			buttons,
		} satisfies IPromptPickerQuickPickItem;
	}


	private async keepQuickPickOpen<T>(quickPick: IPromptQuickPick, work: () => Promise<T>): Promise<T> {
		const previousIgnoreFocusOut = quickPick.ignoreFocusOut;
		quickPick.ignoreFocusOut = true;
		try {
			return await work();
		} finally {
			quickPick.ignoreFocusOut = previousIgnoreFocusOut;
			quickPick.show();
		}
	}

	private async _handleButtonClick(quickPick: IPromptQuickPick, context: IQuickPickItemButtonEvent<IPromptPickerQuickPickItem>, options: ISelectOptions): Promise<boolean> {
		const { item, button } = context;
		if (!isPromptFileItem(item)) {
			if (isHelpButton(button)) {
				await this._openerService.open(button.helpURI);
				return false;
			}
			throw new Error(`Unknown button '${JSON.stringify(button)}'.`);
		}
		const value = item.promptFileUri;

		if (button === RUN_IN_CHAT_BUTTON) {
			const commandId = quickPick.keyMods.ctrlCmd === true
				? 'workbench.action.chat.run-in-new-chat.prompt.current'
				: 'workbench.action.chat.run.prompt.current';
			await this._commandService.executeCommand(commandId, value);
			quickPick.hide();
			return false;
		}

		if (button === EDIT_BUTTON) {
			await this._openerService.open(value);
			return false;
		}

		if (button === RENAME_BUTTON || button === COPY_BUTTON) {
			return await this.keepQuickPickOpen(quickPick, async () => {
				const currentFolder = dirname(value);
				const isMove = button === RENAME_BUTTON && quickPick.keyMods.ctrlCmd;
				const newFolder = await this._instaService.invokeFunction(askForPromptSourceFolder, options.type, currentFolder, isMove);
				if (!newFolder) {
					return false;
				}
				const newName = await this._instaService.invokeFunction(askForPromptFileName, options.type, newFolder.uri, item.label);
				if (!newName) {
					return false;
				}
				const newFile = joinPath(newFolder.uri, newName);
				if (isMove) {
					await this._fileService.move(value, newFile);
				} else {
					await this._fileService.copy(value, newFile);
				}

				await this._openerService.open(newFile);
				await this._instaService.createInstance(PromptFileRewriter).openAndRewriteName(newFile, getCleanPromptName(newFile), CancellationToken.None);

				return true;
			});
		}

		if (button === DELETE_BUTTON) {
			return await this.keepQuickPickOpen(quickPick, async () => {

				const isSkill = options.type === PromptsType.skill;
				const filename = isSkill ? basename(dirname(value)) : item.label;
				const message = isSkill
					? localize('commands.prompts.use.select-dialog.delete-skill.confirm.message', "Are you sure you want to delete skill '{0}' and its folder?", filename)
					: localize('commands.prompts.use.select-dialog.delete-prompt.confirm.message', "Are you sure you want to delete '{0}'?", filename);
				const { confirmed } = await this._dialogService.confirm({ message });
				if (!confirmed) {
					return false;
				}

				const deleteTarget = isSkill ? dirname(value) : value;
				await this._fileService.del(deleteTarget, { recursive: isSkill, useTrash: true });
				return true;
			});

		}

		if (button === MAKE_VISIBLE_BUTTON || button === MAKE_INVISIBLE_BUTTON) {
			const disabled = this._promptsService.getDisabledPromptFiles(options.type);
			if (button === MAKE_VISIBLE_BUTTON) {
				disabled.delete(value);
			} else {
				disabled.add(value);
			}
			this._promptsService.setDisabledPromptFiles(options.type, disabled);
			return true;
		}

		throw new Error(`Unknown button '${JSON.stringify(button)}'.`);
	}


	async managePromptFiles(type: PromptsType, placeholder: string): Promise<boolean> {
		const cts = new CancellationTokenSource();
		const quickPick: IPromptQuickPick = this._quickInputService.createQuickPick<IPromptPickerQuickPickItem>({ useSeparators: true });
		quickPick.placeholder = placeholder;
		quickPick.canSelectMany = true;
		quickPick.matchOnDescription = true;
		quickPick.sortByLabel = false;
		quickPick.busy = true;

		const options: ISelectOptions = {
			placeholder: '',
			type,
			optionNew: true,
			optionEdit: true,
			optionDelete: true,
			optionRename: true,
			optionCopy: true,
			optionVisibility: false,
			optionRun: false
		};

		try {
			const items = await this._createPromptPickItems(options, cts.token);
			quickPick.items = items;
		} finally {
			quickPick.busy = false;
		}

		return new Promise<boolean>(resolve => {
			const disposables = new DisposableStore();
			disposables.add(quickPick);
			disposables.add(cts);

			let isClosed = false;
			let isResolved = false;

			const refreshItems = async () => {
				const active = quickPick.activeItems;
				const newItems = await this._createPromptPickItems(options, CancellationToken.None);
				quickPick.items = newItems;
				quickPick.activeItems = active;
			};

			disposables.add(quickPick.onDidAccept(async () => {
				const clickedItem = quickPick.activeItems;
				if (clickedItem.length === 1 && clickedItem[0].commandId) {
					const commandId = clickedItem[0].commandId;
					await this.keepQuickPickOpen(quickPick, async () => {
						await this._commandService.executeCommand(commandId);
					});
					if (!isClosed) {
						await refreshItems();
					}
					return;
				}
				isResolved = true;
				resolve(true);
				quickPick.hide();
			}));

			disposables.add(quickPick.onDidTriggerItemButton(async e => {
				const shouldRefresh = await this._handleButtonClick(quickPick, e, options);
				if (!isClosed && shouldRefresh) {
					await refreshItems();
				}
			}));

			disposables.add(quickPick.onDidHide(() => {
				if (!quickPick.ignoreFocusOut) {
					disposables.dispose();
					isClosed = true;
					if (!isResolved) {
						resolve(false);
						isResolved = true;
					}
				}
			}));

			quickPick.show();
		});
	}

}
