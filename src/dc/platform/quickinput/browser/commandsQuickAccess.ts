/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from '../../../base/common/actions.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Codicon } from '../../../base/common/codicons.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { isCancellationError } from '../../../base/common/errors.js';
import { IMatch, matchesBaseContiguousSubString, matchesWords, or } from '../../../base/common/filters.js';
import { createSingleCallFunction } from '../../../base/common/functional.js';
import { Disposable, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { LRUCache } from '../../../base/common/map.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { TfIdfCalculator, normalizeTfIdfScores } from '../../../base/common/tfIdf.js';
import { localize } from '../../../nls.js';
import { ILocalizedString } from '../../action/common/action.js';
import { ICommandService } from '../../commands/common/commands.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../configuration/common/configuration.js';
import { IDialogService } from '../../dialogs/common/dialogs.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { ILogService } from '../../log/common/log.js';
import { FastAndSlowPicks, IPickerQuickAccessItem, IPickerQuickAccessProviderOptions, PickerQuickAccessProvider, Picks, TriggerAction } from './pickerQuickAccess.js';
import { IQuickAccessProviderRunOptions } from '../common/quickAccess.js';
import { IKeyMods, IQuickPickSeparator } from '../common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from '../../storage/common/storage.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { Categories } from '../../action/common/actionCommonCategories.js';

export interface ICommandQuickPick extends IPickerQuickAccessItem {
	readonly commandId: string;
	readonly commandWhen?: string;
	readonly commandAlias?: string;
	readonly commandDescription?: ILocalizedString;
	readonly commandCategory?: string;

	readonly args?: unknown[];

	tfIdfScore?: number;
}

export interface ICommandsQuickAccessOptions extends IPickerQuickAccessProviderOptions<ICommandQuickPick> {
	readonly showAlias: boolean;
	suggestedCommandIds?: Set<string>;
}

export abstract class AbstractCommandsQuickAccessProvider extends PickerQuickAccessProvider<ICommandQuickPick> implements IDisposable {

	static PREFIX = '>';

	private static readonly TFIDF_THRESHOLD = 0.5;
	private static readonly TFIDF_MAX_RESULTS = 5;

	private static WORD_FILTER = or(matchesBaseContiguousSubString, matchesWords);

	private readonly commandsHistory: CommandsHistory;

	protected override readonly options: ICommandsQuickAccessOptions;

	constructor(
		options: ICommandsQuickAccessOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService protected readonly keybindingService: IKeybindingService,
		@ICommandService private readonly commandService: ICommandService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IDialogService private readonly dialogService: IDialogService
	) {
		super(AbstractCommandsQuickAccessProvider.PREFIX, options);

		this.commandsHistory = this._register(instantiationService.createInstance(CommandsHistory));

		this.options = options;
	}

	protected async _getPicks(filter: string, _disposables: DisposableStore, token: CancellationToken, runOptions?: IQuickAccessProviderRunOptions): Promise<Picks<ICommandQuickPick> | FastAndSlowPicks<ICommandQuickPick>> {

		const allCommandPicks = await this.getCommandPicks(token);

		if (token.isCancellationRequested) {
			return [];
		}

		const runTfidf = createSingleCallFunction(() => {
			const tfidf = new TfIdfCalculator();
			tfidf.updateDocuments(allCommandPicks.map(commandPick => ({
				key: commandPick.commandId,
				textChunks: [this.getTfIdfChunk(commandPick)]
			})));
			const result = tfidf.calculateScores(filter, token);

			return normalizeTfIdfScores(result)
				.filter(score => score.score > AbstractCommandsQuickAccessProvider.TFIDF_THRESHOLD)
				.slice(0, AbstractCommandsQuickAccessProvider.TFIDF_MAX_RESULTS);
		});

		const filteredCommandPicks: ICommandQuickPick[] = [];
		for (const commandPick of allCommandPicks) {
			const labelHighlights = AbstractCommandsQuickAccessProvider.WORD_FILTER(filter, commandPick.label) ?? undefined;

			let aliasHighlights: IMatch[] | undefined;
			if (commandPick.commandAlias) {
				aliasHighlights = AbstractCommandsQuickAccessProvider.WORD_FILTER(filter, commandPick.commandAlias) ?? undefined;
			}

			if (labelHighlights || aliasHighlights) {
				commandPick.highlights = {
					label: labelHighlights,
					detail: this.options.showAlias ? aliasHighlights : undefined
				};

				filteredCommandPicks.push(commandPick);
			}

			else if (filter === commandPick.commandId) {
				filteredCommandPicks.push(commandPick);
			}

			else if (filter.length >= 3) {
				const tfidf = runTfidf();
				if (token.isCancellationRequested) {
					return [];
				}

				const tfidfScore = tfidf.find(score => score.key === commandPick.commandId);
				if (tfidfScore) {
					commandPick.tfIdfScore = tfidfScore.score;
					filteredCommandPicks.push(commandPick);
				}
			}
		}

		const mapLabelToCommand = new Map<string, ICommandQuickPick>();
		for (const commandPick of filteredCommandPicks) {
			const existingCommandForLabel = mapLabelToCommand.get(commandPick.label);
			if (existingCommandForLabel) {
				commandPick.description = commandPick.commandId;
				existingCommandForLabel.description = existingCommandForLabel.commandId;
			} else {
				mapLabelToCommand.set(commandPick.label, commandPick);
			}
		}

		filteredCommandPicks.sort((commandPickA, commandPickB) => {

			if (commandPickA.tfIdfScore && commandPickB.tfIdfScore) {
				if (commandPickA.tfIdfScore === commandPickB.tfIdfScore) {
					return commandPickA.label.localeCompare(commandPickB.label);
				}

				return commandPickB.tfIdfScore - commandPickA.tfIdfScore;
			} else if (commandPickA.tfIdfScore) {
				return 1;
			} else if (commandPickB.tfIdfScore) {
				return -1;
			}

			const commandACounter = this.commandsHistory.peek(commandPickA.commandId);
			const commandBCounter = this.commandsHistory.peek(commandPickB.commandId);

			if (commandACounter && commandBCounter) {
				return commandACounter > commandBCounter ? -1 : 1;
			}

			if (commandACounter) {
				return -1;
			}

			if (commandBCounter) {
				return 1;
			}

			if (this.options.suggestedCommandIds) {
				const commandASuggestion = this.options.suggestedCommandIds.has(commandPickA.commandId);
				const commandBSuggestion = this.options.suggestedCommandIds.has(commandPickB.commandId);
				if (commandASuggestion && commandBSuggestion) {
					return 0;
				}

				if (commandASuggestion) {
					return -1;
				}

				if (commandBSuggestion) {
					return 1;
				}
			}

			const isDeveloperA = commandPickA.commandCategory === Categories.Developer.value;
			const isDeveloperB = commandPickB.commandCategory === Categories.Developer.value;
			if (isDeveloperA && !isDeveloperB) {
				return 1;
			}
			if (!isDeveloperA && isDeveloperB) {
				return -1;
			}

			return commandPickA.label.localeCompare(commandPickB.label);
		});

		const commandPicks: Array<ICommandQuickPick | IQuickPickSeparator> = [];

		let addOtherSeparator = false;
		let addSuggestedSeparator = true;
		let addCommonlyUsedSeparator = !!this.options.suggestedCommandIds;
		for (let i = 0; i < filteredCommandPicks.length; i++) {
			const commandPick = filteredCommandPicks[i];
			const isInHistory = !!this.commandsHistory.peek(commandPick.commandId);

			if (i === 0 && isInHistory) {
				commandPicks.push({ type: 'separator', label: localize('recentlyUsed', "recently used") });
				addOtherSeparator = true;
			}

			if (addSuggestedSeparator && commandPick.tfIdfScore !== undefined) {
				commandPicks.push({ type: 'separator', label: localize('suggested', "similar commands") });
				addSuggestedSeparator = false;
			}

			if (addCommonlyUsedSeparator && commandPick.tfIdfScore === undefined && !isInHistory && this.options.suggestedCommandIds?.has(commandPick.commandId)) {
				commandPicks.push({ type: 'separator', label: localize('commonlyUsed', "commonly used") });
				addOtherSeparator = true;
				addCommonlyUsedSeparator = false;
			}

			if (addOtherSeparator && commandPick.tfIdfScore === undefined && !isInHistory && !this.options.suggestedCommandIds?.has(commandPick.commandId)) {
				commandPicks.push({ type: 'separator', label: localize('morecCommands', "other commands") });
				addOtherSeparator = false;
			}

			commandPicks.push(this.toCommandPick(commandPick, runOptions, isInHistory));
		}

		if (!this.hasAdditionalCommandPicks(filter, token)) {
			return commandPicks;
		}

		return {
			picks: commandPicks,
			additionalPicks: (async (): Promise<Picks<ICommandQuickPick>> => {
				const additionalCommandPicks = await this.getAdditionalCommandPicks(allCommandPicks, filteredCommandPicks, filter, token);
				if (token.isCancellationRequested) {
					return [];
				}

				const commandPicks: Array<ICommandQuickPick | IQuickPickSeparator> = additionalCommandPicks.map(commandPick => this.toCommandPick(commandPick, runOptions));
				if (addSuggestedSeparator && commandPicks[0]?.type !== 'separator') {
					commandPicks.unshift({ type: 'separator', label: localize('suggested', "similar commands") });
				}
				return commandPicks;
			})()
		};
	}

	private toCommandPick(commandPick: ICommandQuickPick | IQuickPickSeparator, runOptions?: IQuickAccessProviderRunOptions, isRecentlyUsed: boolean = false): ICommandQuickPick | IQuickPickSeparator {
		if (commandPick.type === 'separator') {
			return commandPick;
		}
		const tooltip = commandPick.tooltip
			?? commandPick.commandDescription?.value;

		const keybinding = this.keybindingService.lookupKeybinding(commandPick.commandId);
		const ariaLabel = keybinding ?
			localize('commandPickAriaLabelWithKeybinding', "{0}, {1}", commandPick.label, keybinding.getAriaLabel()) :
			commandPick.label;

		const existingButtons = commandPick.buttons || [];
		const buttons = isRecentlyUsed ? [
			...existingButtons,
			{
				iconClass: ThemeIcon.asClassName(Codicon.close),
				tooltip: localize('removeFromRecentlyUsed', "Remove from Recently Used")
			}
		] : commandPick.buttons;

		return {
			...commandPick,
			tooltip,
			ariaLabel,
			detail: this.options.showAlias && commandPick.commandAlias !== commandPick.label ? commandPick.commandAlias : undefined,
			keybinding,
			buttons,
			accept: async () => {

				this.commandsHistory.push(commandPick.commandId);

				this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', {
					id: commandPick.commandId,
					from: runOptions?.from ?? 'quick open'
				});

				try {
					commandPick.args?.length
						? await this.commandService.executeCommand(commandPick.commandId, ...commandPick.args)
						: await this.commandService.executeCommand(commandPick.commandId);
				} catch (error) {
					if (!isCancellationError(error)) {
						this.dialogService.error(localize('canNotRun', "Command '{0}' resulted in an error", commandPick.label), toErrorMessage(error));
					}
				}
			},
			trigger: isRecentlyUsed ? (buttonIndex: number, keyMods: IKeyMods): TriggerAction | Promise<TriggerAction> => {
				const removeButtonIndex = existingButtons.length;
				if (buttonIndex === removeButtonIndex) {
					this.commandsHistory.remove(commandPick.commandId);
					return TriggerAction.REMOVE_ITEM;
				}
				if (commandPick.trigger) {
					return commandPick.trigger(buttonIndex, keyMods);
				}
				return TriggerAction.NO_ACTION;
			} : commandPick.trigger
		};
	}

	private getTfIdfChunk({ label, commandAlias, commandDescription }: ICommandQuickPick) {
		let chunk = label;
		if (commandAlias && commandAlias !== label) {
			chunk += ` - ${commandAlias}`;
		}
		if (commandDescription && commandDescription.value !== label) {
			chunk += ` - ${commandDescription.value === commandDescription.original ? commandDescription.value : `${commandDescription.value} (${commandDescription.original})`}`;
		}
		return chunk;
	}

	protected abstract getCommandPicks(token: CancellationToken): Promise<Array<ICommandQuickPick>>;

	protected abstract hasAdditionalCommandPicks(filter: string, token: CancellationToken): boolean;
	protected abstract getAdditionalCommandPicks(allPicks: ICommandQuickPick[], picksSoFar: ICommandQuickPick[], filter: string, token: CancellationToken): Promise<Array<ICommandQuickPick | IQuickPickSeparator>>;
}

interface ISerializedCommandHistory {
	readonly usesLRU?: boolean;
	readonly entries: { key: string; value: number }[];
}

interface ICommandsQuickAccessConfiguration {
	readonly workbench: {
		readonly commandPalette: {
			readonly history: number;
			readonly preserveInput: boolean;
		};
	};
}

export class CommandsHistory extends Disposable {

	static readonly DEFAULT_COMMANDS_HISTORY_LENGTH = 50;

	private static readonly PREF_KEY_CACHE = 'commandPalette.mru.cache';
	private static readonly PREF_KEY_COUNTER = 'commandPalette.mru.counter';

	private static cache: LRUCache<string, number> | undefined;
	private static counter = 1;
	private static hasChanges = false;

	private configuredCommandsHistoryLength = 0;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.updateConfiguration();
		this.load();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => this.updateConfiguration(e)));
		this._register(this.storageService.onWillSaveState(e => {
			if (e.reason === WillSaveStateReason.SHUTDOWN) {
				this.saveState();
			}
		}));
	}

	private updateConfiguration(e?: IConfigurationChangeEvent): void {
		if (e && !e.affectsConfiguration('workbench.commandPalette.history')) {
			return;
		}

		this.configuredCommandsHistoryLength = CommandsHistory.getConfiguredCommandHistoryLength(this.configurationService);

		if (CommandsHistory.cache && CommandsHistory.cache.limit !== this.configuredCommandsHistoryLength) {
			CommandsHistory.cache.limit = this.configuredCommandsHistoryLength;
			CommandsHistory.hasChanges = true;
		}
	}

	private load(): void {
		const raw = this.storageService.get(CommandsHistory.PREF_KEY_CACHE, StorageScope.PROFILE);
		let serializedCache: ISerializedCommandHistory | undefined;
		if (raw) {
			try {
				serializedCache = JSON.parse(raw);
			} catch (error) {
				this.logService.error(`[CommandsHistory] invalid data: ${error}`);
			}
		}

		const cache = CommandsHistory.cache = new LRUCache<string, number>(this.configuredCommandsHistoryLength, 1);
		if (serializedCache) {
			let entries: { key: string; value: number }[];
			if (serializedCache.usesLRU) {
				entries = serializedCache.entries;
			} else {
				entries = serializedCache.entries.sort((a, b) => a.value - b.value);
			}
			entries.forEach(entry => cache.set(entry.key, entry.value));
		}

		CommandsHistory.counter = this.storageService.getNumber(CommandsHistory.PREF_KEY_COUNTER, StorageScope.PROFILE, CommandsHistory.counter);
	}

	push(commandId: string): void {
		if (!CommandsHistory.cache) {
			return;
		}

		CommandsHistory.cache.set(commandId, CommandsHistory.counter++);
		CommandsHistory.hasChanges = true;
	}

	peek(commandId: string): number | undefined {
		return CommandsHistory.cache?.peek(commandId);
	}

	remove(commandId: string): void {
		if (!CommandsHistory.cache) {
			return;
		}

		CommandsHistory.cache.delete(commandId);
		CommandsHistory.hasChanges = true;
	}

	private saveState(): void {
		if (!CommandsHistory.cache) {
			return;
		}

		if (!CommandsHistory.hasChanges) {
			return;
		}

		const serializedCache: ISerializedCommandHistory = { usesLRU: true, entries: [] };
		CommandsHistory.cache.forEach((value, key) => serializedCache.entries.push({ key, value }));

		this.storageService.store(CommandsHistory.PREF_KEY_CACHE, JSON.stringify(serializedCache), StorageScope.PROFILE, StorageTarget.USER);
		this.storageService.store(CommandsHistory.PREF_KEY_COUNTER, CommandsHistory.counter, StorageScope.PROFILE, StorageTarget.USER);
		CommandsHistory.hasChanges = false;
	}

	static getConfiguredCommandHistoryLength(configurationService: IConfigurationService): number {
		const config = configurationService.getValue<ICommandsQuickAccessConfiguration>();

		const configuredCommandHistoryLength = config.workbench?.commandPalette?.history;
		if (typeof configuredCommandHistoryLength === 'number') {
			return configuredCommandHistoryLength;
		}

		return CommandsHistory.DEFAULT_COMMANDS_HISTORY_LENGTH;
	}

	static clearHistory(configurationService: IConfigurationService, storageService: IStorageService): void {
		const commandHistoryLength = CommandsHistory.getConfiguredCommandHistoryLength(configurationService);
		CommandsHistory.cache = new LRUCache<string, number>(commandHistoryLength);
		CommandsHistory.counter = 1;

		CommandsHistory.hasChanges = true;
	}
}
