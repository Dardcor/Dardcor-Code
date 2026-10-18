/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ChatContextKeys } from '../common/actions/chatContextKeys.js';
import { AgentInstructionFileType, IPromptsService } from '../common/promptSyntax/service/promptsService.js';
import { PromptsType } from '../common/promptSyntax/promptTypes.js';
import { ILanguageModelToolsService } from '../common/tools/languageModelToolsService.js';
import { TipEligibilityStorageKeys } from './chatTipStorageKeys.js';

export interface ITipExclusionConfig {
	readonly id: string;
	readonly excludeWhenCommandsExecuted?: readonly string[];
	readonly excludeWhenModesUsed?: readonly string[];
	readonly excludeWhenToolsInvoked?: readonly string[];
	readonly excludeWhenPromptFilesExist?: {
		readonly promptType: PromptsType;
		readonly agentFileType?: AgentInstructionFileType;
		readonly excludeUntilChecked?: boolean;
	};
}

export class TipEligibilityTracker extends Disposable {

	private readonly _executedCommands: Set<string>;
	private readonly _usedModes: Set<string>;
	private readonly _invokedTools: Set<string>;

	private readonly _pendingCommands: Set<string>;
	private readonly _pendingModes: Set<string>;
	private readonly _pendingTools: Set<string>;

	private readonly _commandListener = this._register(new MutableDisposable());
	private readonly _toolListener = this._register(new MutableDisposable());

	private readonly _excludedByFiles = new Set<string>();

	private readonly _tipsWithFileExclusions: readonly ITipExclusionConfig[];

	private readonly _fileCheckGeneration = new Map<string, number>();
	private readonly _fileChecksInFlight = new Map<string, Promise<void>>();

	constructor(
		tips: readonly ITipExclusionConfig[],
		@ICommandService commandService: ICommandService,
		@IStorageService private readonly _storageService: IStorageService,
		@IPromptsService private readonly _promptsService: IPromptsService,
		@ILanguageModelToolsService private readonly _languageModelToolsService: ILanguageModelToolsService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();


		const storedCmds = this._readApplicationWithProfileFallback(TipEligibilityStorageKeys.ExecutedCommands);
		this._executedCommands = new Set<string>(storedCmds ? JSON.parse(storedCmds) : []);

		const storedModes = this._readApplicationWithProfileFallback(TipEligibilityStorageKeys.UsedModes);
		this._usedModes = new Set<string>(storedModes ? JSON.parse(storedModes) : []);

		const storedTools = this._readApplicationWithProfileFallback(TipEligibilityStorageKeys.InvokedTools);
		this._invokedTools = new Set<string>(storedTools ? JSON.parse(storedTools) : []);


		this._pendingCommands = new Set<string>();
		for (const tip of tips) {
			for (const cmd of tip.excludeWhenCommandsExecuted ?? []) {
				if (!this._executedCommands.has(cmd)) {
					this._pendingCommands.add(cmd);
				}
			}
		}

		this._pendingModes = new Set<string>();
		for (const tip of tips) {
			for (const mode of tip.excludeWhenModesUsed ?? []) {
				if (!this._usedModes.has(mode)) {
					this._pendingModes.add(mode);
				}
			}
		}

		this._pendingTools = new Set<string>();
		for (const tip of tips) {
			for (const toolId of tip.excludeWhenToolsInvoked ?? []) {
				if (!this._invokedTools.has(toolId)) {
					this._pendingTools.add(toolId);
				}
			}
		}


		if (this._pendingCommands.size > 0) {
			this._commandListener.value = commandService.onDidExecuteCommand(e => {
				this.recordCommandExecuted(e.commandId);
			});
		}


		if (this._pendingTools.size > 0) {
			this._toolListener.value = this._languageModelToolsService.onDidInvokeTool(e => {
				if (this._pendingTools.has(e.toolId)) {
					this._invokedTools.add(e.toolId);
					this._pendingTools.delete(e.toolId);

					this._persistSet(TipEligibilityStorageKeys.InvokedTools, this._invokedTools);
				}

				if (this._pendingTools.size === 0) {
					this._toolListener.clear();
				}
			});
		}


		this._tipsWithFileExclusions = tips.filter(t => t.excludeWhenPromptFilesExist);
		for (const tip of this._tipsWithFileExclusions) {
			if (tip.excludeWhenPromptFilesExist!.excludeUntilChecked) {
				this._excludedByFiles.add(tip.id);
			}
			this._checkForPromptFiles(tip);
		}

		this._register(this._promptsService.onDidChangeCustomAgents(() => {
			for (const tip of this._tipsWithFileExclusions) {
				if (tip.excludeWhenPromptFilesExist!.promptType === PromptsType.agent) {
					this._checkForPromptFiles(tip);
				}
			}
		}));
	}

	recordCommandExecuted(commandId: string): void {
		if (!this._pendingCommands.has(commandId)) {
			return;
		}

		this._executedCommands.add(commandId);
		this._persistSet(TipEligibilityStorageKeys.ExecutedCommands, this._executedCommands);
		this._pendingCommands.delete(commandId);

		if (this._pendingCommands.size === 0) {
			this._commandListener.clear();
		}
	}

	recordCurrentMode(contextKeyService: IContextKeyService): void {
		if (this._pendingModes.size === 0) {
			return;
		}

		let changed = false;
		const kind = contextKeyService.getContextKeyValue<string>(ChatContextKeys.chatModeKind.key);
		if (kind && !this._usedModes.has(kind)) {
			this._usedModes.add(kind);
			this._pendingModes.delete(kind);
			changed = true;
		}
		const name = contextKeyService.getContextKeyValue<string>(ChatContextKeys.chatModeName.key);
		if (name && !this._usedModes.has(name)) {
			this._usedModes.add(name);
			this._pendingModes.delete(name);
			changed = true;
		}
		if (changed) {
			this._persistSet(TipEligibilityStorageKeys.UsedModes, this._usedModes);
		}
	}

	isExcluded(tip: ITipExclusionConfig): boolean {
		if (tip.excludeWhenCommandsExecuted) {
			for (const cmd of tip.excludeWhenCommandsExecuted) {
				if (this._executedCommands.has(cmd)) {
					this._logService.debug('#ChatTips: tip excluded because command was executed', tip.id, cmd);
					return true;
				}
			}
		}
		if (tip.excludeWhenModesUsed) {
			for (const mode of tip.excludeWhenModesUsed) {
				if (this._usedModes.has(mode)) {
					this._logService.debug('#ChatTips: tip excluded because mode was used', tip.id, mode);
					return true;
				}
			}
		}
		if (tip.excludeWhenToolsInvoked) {
			for (const toolId of tip.excludeWhenToolsInvoked) {
				if (this._invokedTools.has(toolId)) {
					this._logService.debug('#ChatTips: tip excluded because tool was invoked', tip.id, toolId);
					return true;
				}
			}
		}
		if (tip.excludeWhenPromptFilesExist && this._excludedByFiles.has(tip.id)) {
			this._logService.debug('#ChatTips: tip excluded because prompt files exist', tip.id);
			return true;
		}
		return false;
	}

	refreshPromptFileExclusions(): void {
		for (const tip of this._tipsWithFileExclusions) {
			if (tip.excludeWhenPromptFilesExist!.excludeUntilChecked) {
				this._excludedByFiles.add(tip.id);
			}
			this._checkForPromptFiles(tip);
		}
	}

	private async _checkForPromptFiles(tip: ITipExclusionConfig): Promise<void> {
		const inFlight = this._fileChecksInFlight.get(tip.id);
		if (inFlight) {
			await inFlight;
			return;
		}

		const checkPromise = this._doCheckForPromptFiles(tip);
		this._fileChecksInFlight.set(tip.id, checkPromise);
		try {
			await checkPromise;
		} finally {
			if (this._fileChecksInFlight.get(tip.id) === checkPromise) {
				this._fileChecksInFlight.delete(tip.id);
			}
		}
	}

	private async _doCheckForPromptFiles(tip: ITipExclusionConfig): Promise<void> {
		const config = tip.excludeWhenPromptFilesExist!;
		const generation = (this._fileCheckGeneration.get(tip.id) ?? 0) + 1;
		this._fileCheckGeneration.set(tip.id, generation);

		try {
			const [promptFiles, agentInstructions] = await Promise.all([
				this._promptsService.listPromptFiles(config.promptType, CancellationToken.None),
				config.agentFileType ? this._promptsService.listAgentInstructions(CancellationToken.None) : Promise.resolve([]),
			]);

			if (this._fileCheckGeneration.get(tip.id) !== generation) {
				return;
			}

			const hasPromptFiles = promptFiles.length > 0;
			const hasAgentFile = config.agentFileType
				? agentInstructions.some(f => f.type === config.agentFileType)
				: false;
			const hasPromptFilesOrAgentFile = hasPromptFiles || hasAgentFile;

			if (hasPromptFilesOrAgentFile) {
				this._excludedByFiles.add(tip.id);
			} else {
				this._excludedByFiles.delete(tip.id);
			}
		} catch {
			if (this._fileCheckGeneration.get(tip.id) !== generation) {
				return;
			}
			if (config.excludeUntilChecked) {
				this._excludedByFiles.add(tip.id);
			}
		}
	}

	private _persistSet(key: string, set: Set<string>): void {
		this._storageService.store(key, JSON.stringify([...set]), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private _readApplicationWithProfileFallback(key: string): string | undefined {
		const applicationValue = this._storageService.get(key, StorageScope.APPLICATION);
		if (applicationValue) {
			return applicationValue;
		}

		const profileValue = this._storageService.get(key, StorageScope.PROFILE);
		if (profileValue) {
			this._storageService.store(key, profileValue, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}

		return profileValue;
	}
}
