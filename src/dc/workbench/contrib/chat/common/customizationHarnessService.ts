/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { derived, IObservable, ISettableObservable, observableValue } from '../../../../base/common/observable.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { AICustomizationManagementSection, AICustomizationSource, BUILTIN_STORAGE } from './aiCustomizationWorkspaceService.js';
import { PromptsType } from './promptSyntax/promptTypes.js';
import { AGENT_MD_FILENAME } from './promptSyntax/config/promptFileLocations.js';
import { IAgentSource, IChatPromptSlashCommand, ICustomAgent, IPromptsService, IResolvedChatPromptSlashCommand, matchesSessionType, PromptsStorage } from './promptSyntax/service/promptsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { SessionType } from './chatSessionsService.js';
import { CustomAgent } from './promptSyntax/service/promptsServiceImpl.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { getCanonicalPluginCommandId } from './plugins/agentPluginService.js';
import { getChatSessionType, LocalChatSessionUri } from './model/chatUri.js';
import { type CustomizationDisabledReason } from '../../../../platform/agentHost/common/customizationEnablement.js';
import { isAgentBuiltinCustomizationUri } from '../../../../platform/agentHost/common/agentHostCustomizationUri.js';
import { CustomizationEnablementKind } from '../../../../platform/agentHost/common/state/protocol/state.js';


export const ICustomizationHarnessService = createDecorator<ICustomizationHarnessService>('customizationHarnessService');

export interface ISectionOverride {
	readonly label?: string;
	readonly commandId?: string;
	readonly rootFile?: string;
	readonly typeLabel?: string;
	readonly rootFileShortcuts?: readonly string[];
	readonly fileExtension?: string;
}

export interface ICustomizationItemAction {
	readonly id: string;
	readonly label: string;
	readonly tooltip?: string;
	readonly icon?: ThemeIcon;
	readonly enabled?: boolean;
	run(): void | Promise<void>;
}

export interface IHarnessDescriptor {
	readonly id: string;
	readonly label: string;
	readonly icon: ThemeIcon;
	readonly hiddenSections?: readonly string[];
	readonly hideGenerateButton?: boolean;
	readonly sectionOverrides?: ReadonlyMap<string, ISectionOverride>;
	readonly requiredAgentId?: string;
	readonly itemProvider?: ICustomizationItemProvider;
	readonly supportsTroubleshoot?: boolean;
	readonly syncProvider?: ICustomizationSyncProvider;
	readonly pluginActions?: readonly ICustomizationItemAction[];
	readonly hiddenMcpServerCollectionIds?: readonly string[];
}

export interface ICustomizationItem {
	readonly itemKey?: string;
	readonly uri: URI;
	readonly type: string;
	readonly name: string;
	readonly description?: string;
	readonly source: AICustomizationSource;
	readonly extensionId: string | undefined;
	readonly pluginUri: URI | undefined;
	readonly pluginLabel?: string;
	readonly status?: 'loading' | 'loaded' | 'degraded' | 'error';
	readonly statusMessage?: string;
	readonly enabled?: boolean;
	readonly disabledReason?: CustomizationDisabledReason;
	readonly groupKey?: string;
	readonly badge?: string;
	readonly badgeTooltip?: string;
	readonly userInvocable?: boolean;
	readonly actions?: readonly ICustomizationItemAction[];
}

export interface ICustomizationAgentRef {
	readonly id: string;

	readonly uri: URI;
	readonly name: string;
	readonly description?: string;
}

export function isPluginCustomizationItem(item: { readonly type: string }): boolean {
	return item.type === 'plugin' || item.type === AICustomizationManagementSection.Plugins;
}

export function getCustomizationDisabledLabel(reason: CustomizationDisabledReason | undefined): string {
	if (reason?.source === 'plugin') {
		return localize('customizationDisabledPlugin', "Disabled (Plugin)");
	}
	switch (reason?.scope) {
		case CustomizationEnablementKind.Workspace:
			return localize('customizationDisabledWorkspace', "Disabled (Workspace)");
		case CustomizationEnablementKind.Session:
			return localize('customizationDisabledSession', "Disabled (Session)");
		case CustomizationEnablementKind.Global:
		case undefined:
			return localize('customizationDisabled', "Disabled");
	}
}

export interface ICustomizationItemProvider {
	readonly onDidChange: Event<void>;
	provideChatSessionCustomizations(sessionResource: URI, token: CancellationToken): Promise<ICustomizationItem[] | undefined>;

	provideCustomAgents?(sessionResource: URI, token: CancellationToken): Promise<readonly ICustomAgent[]>;

	provideSourceFolders?(sessionResource: URI, type: PromptsType, token: CancellationToken): Promise<readonly ICustomizationSourceFolder[] | undefined>;
}

export interface ICustomizationSourceFolder {
	readonly uri: URI;
	readonly label: string;
	readonly source: AICustomizationSource;
	readonly destinationGroupId?: string;
}

export interface ICustomizationSyncProvider {
	readonly onDidChange: Event<void>;
	isDisabled(uri: URI): boolean;
	setDisabled(uri: URI, disabled: boolean): void;
}

export interface ICustomizationHarnessService {
	readonly _serviceBrand: undefined;

	readonly activeSessionResource: IObservable<URI>;

	readonly activeHarness: IObservable<string>;

	readonly availableHarnesses: IObservable<readonly IHarnessDescriptor[]>;

	findHarnessById(sessionType: string): IHarnessDescriptor | undefined;

	setActiveSession(sessionResource: URI): void;

	getActiveDescriptor(): IHarnessDescriptor;

	registerExternalHarness(descriptor: IHarnessDescriptor): IDisposable;


	readonly onDidChangeSlashCommands: Event<{ readonly sessionType: string }>;

	readonly onDidChangeCustomAgents: Event<{ readonly sessionType: string }>;

	getSlashCommands(sessionResource: URI, token: CancellationToken): Promise<readonly IChatPromptSlashCommand[]>;

	getCustomAgents(sessionResource: URI, token: CancellationToken): Promise<readonly ICustomAgent[]>;

	resolvePromptSlashCommand(name: string, sessionResource: URI, token: CancellationToken): Promise<IResolvedChatPromptSlashCommand | undefined>;

	getSessionResourceForHarness(sessionType: string): URI;
}

export interface ICustomizationSlashCommand {
	readonly uri: URI;
	readonly type: PromptsType.prompt | PromptsType.skill;
	readonly name: string;
	readonly description?: string;
	readonly userInvocable: boolean;
	readonly sessionTypes?: readonly string[];
}


const EMPTY_DESCRIPTOR: IHarnessDescriptor = {
	id: '',
	label: '',
	icon: Codicon.sparkle,
};





export function createVSCodeHarnessDescriptor(): IHarnessDescriptor {
	return {
		id: SessionType.Local,
		label: localize('harness.local', "Local"),
		icon: ThemeIcon.fromId(Codicon.vm.id),
		supportsTroubleshoot: true,
		hiddenSections: [AICustomizationManagementSection.Tools],
		sectionOverrides: new Map([
			[AICustomizationManagementSection.Instructions, {
				rootFileShortcuts: [AGENT_MD_FILENAME],
			}],
		]),
	};
}



export class CustomizationHarnessServiceBase implements ICustomizationHarnessService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidChangeSlashCommands = new Emitter<{ readonly sessionType: string }>();
	readonly onDidChangeSlashCommands = this._onDidChangeSlashCommands.event;
	private readonly _onDidChangeCustomAgents = new Emitter<{ readonly sessionType: string }>();
	readonly onDidChangeCustomAgents = this._onDidChangeCustomAgents.event;
	private readonly _providerListeners: IDisposable[] = [];
	private _isDisposed = false;

	private readonly _activeSessionResource: ISettableObservable<URI>;
	readonly activeSessionResource: IObservable<URI>;

	private readonly _activeHarness: IObservable<string>;
	readonly activeHarness: IObservable<string>;

	private readonly _staticHarnesses: readonly IHarnessDescriptor[];
	private readonly _externalHarnesses: IHarnessDescriptor[] = [];
	private readonly _availableHarnesses: ISettableObservable<readonly IHarnessDescriptor[]>;
	readonly availableHarnesses: IObservable<readonly IHarnessDescriptor[]>;

	constructor(
		staticHarnesses: readonly IHarnessDescriptor[],
		defaultHarness: string,
		private readonly promptsService: IPromptsService,
	) {
		this._staticHarnesses = staticHarnesses;
		this.promptsService = promptsService;
		this._activeSessionResource = observableValue<URI>(this, this.getSessionResourceForHarness(defaultHarness));
		this.activeSessionResource = this._activeSessionResource;
		this._activeHarness = derived(this, reader => getChatSessionType(this._activeSessionResource.read(reader)));
		this.activeHarness = this._activeHarness;
		this._availableHarnesses = observableValue<readonly IHarnessDescriptor[]>(this, [...this._staticHarnesses]);
		this.availableHarnesses = this._availableHarnesses;
		this._rebindProviderListeners();
	}

	private _getAllHarnesses(): readonly IHarnessDescriptor[] {
		const externalIds = new Set(this._externalHarnesses.map(h => h.id));
		return [
			...this._staticHarnesses.filter(h => !externalIds.has(h.id)),
			...this._externalHarnesses,
		];
	}

	private _refreshAvailableHarnesses(): void {
		if (this._isDisposed) {
			return;
		}
		this._availableHarnesses.set(this._getAllHarnesses(), undefined);
		this._rebindProviderListeners();
	}

	private _rebindProviderListeners(): void {
		for (const listener of this._providerListeners) {
			listener.dispose();
		}
		this._providerListeners.length = 0;
		for (const harness of this._getAllHarnesses()) {
			const provider = harness.itemProvider;
			if (!provider) {
				this._providerListeners.push(this.promptsService.onDidChangeSlashCommands(() => this._onDidChangeSlashCommands.fire({ sessionType: harness.id })));
				this._providerListeners.push(this.promptsService.onDidChangeCustomAgents(() => this._onDidChangeCustomAgents.fire({ sessionType: harness.id })));
			} else {
				this._providerListeners.push(provider.onDidChange(() => this._onDidChangeSlashCommands.fire({ sessionType: harness.id })));
				this._providerListeners.push(provider.onDidChange(() => this._onDidChangeCustomAgents.fire({ sessionType: harness.id })));
			}
		}
	}

	dispose(): void {
		this._isDisposed = true;
		for (const listener of this._providerListeners) {
			listener.dispose();
		}
		this._providerListeners.length = 0;
		this._onDidChangeSlashCommands.dispose();
		this._onDidChangeCustomAgents.dispose();
	}

	registerExternalHarness(descriptor: IHarnessDescriptor): IDisposable {
		this._externalHarnesses.push(descriptor);
		this._refreshAvailableHarnesses();
		return {
			dispose: () => {
				if (this._isDisposed) {
					return;
				}
				const idx = this._externalHarnesses.indexOf(descriptor);
				if (idx >= 0) {
					this._externalHarnesses.splice(idx, 1);
					this._refreshAvailableHarnesses();
				}
			}
		};
	}

	findHarnessById(id: string): IHarnessDescriptor | undefined {
		return this._getAllHarnesses().find(h => h.id === id);
	}

	setActiveSession(sessionResource: URI): void {
		this._activeSessionResource.set(sessionResource, undefined);
	}

	getActiveDescriptor(): IHarnessDescriptor {
		const activeId = this._activeHarness.get();
		const descriptor = this.findHarnessById(activeId);
		return descriptor ?? EMPTY_DESCRIPTOR;
	}

	async getSlashCommands(sessionResource: URI, token: CancellationToken): Promise<readonly IChatPromptSlashCommand[]> {
		const sessionType = getChatSessionType(sessionResource);
		const harness = this.findHarnessById(sessionType);
		if (!harness || !harness.itemProvider) {
			const commands = await this.promptsService.getPromptSlashCommands(token);
			return commands.filter(command => matchesSessionType(command.sessionTypes, sessionType));
		}

		const items = await harness.itemProvider.provideChatSessionCustomizations(sessionResource, token);
		const result: IChatPromptSlashCommand[] = [];
		if (items) {
			for (const item of items) {
				if ((item.enabled !== false) && (item.type === PromptsType.prompt || item.type === PromptsType.skill)) {
					const storage = item.source;
					const narrowStorage: PromptsStorage = storage !== undefined && storage !== BUILTIN_STORAGE
						? storage as PromptsStorage
						: PromptsStorage.local;
					result.push({
						uri: item.uri,
						type: item.type as PromptsType.prompt | PromptsType.skill,
						name: item.pluginUri ? getCanonicalPluginCommandId({ uri: item.pluginUri, label: item.pluginLabel }, item.name) : item.name,
						description: item.description,
						userInvocable: item.userInvocable ?? true,
						storage: narrowStorage,
						sessionTypes: [sessionType],
					});
				}
			}
		}

		const localCommands = await this.promptsService.getPromptSlashCommands(token);
		const seenNames = new Set(result.map(c => c.name));
		for (const command of localCommands) {
			if (!seenNames.has(command.name) && matchesSessionType(command.sessionTypes, sessionType)) {
				result.push(command);
				seenNames.add(command.name);
			}
		}

		return result;
	}

	async getCustomAgents(sessionResource: URI, token: CancellationToken): Promise<readonly ICustomAgent[]> {
		const sessionType = getChatSessionType(sessionResource);
		const harness = this.findHarnessById(sessionType);
		if (!harness || !harness.itemProvider) {
			const allAgents = await this.promptsService.getCustomAgents(token);
			return allAgents.filter(agent => matchesSessionType(agent.sessionTypes, sessionType));
		}

		if (harness.itemProvider.provideCustomAgents) {
			return harness.itemProvider.provideCustomAgents(sessionResource, token);
		}


		const items = await harness.itemProvider.provideChatSessionCustomizations(sessionResource, token);
		if (!items || token.isCancellationRequested) {
			return [];
		}

		const getSource = (item: ICustomizationItem): IAgentSource => {
			if (item.source === PromptsStorage.extension && item.extensionId) {
				return { storage: PromptsStorage.extension, extensionId: new ExtensionIdentifier(item.extensionId) };
			} else if (item.source === PromptsStorage.plugin && item.pluginUri) {
				return { storage: PromptsStorage.plugin, pluginUri: item.pluginUri };
			} else if (item.source === PromptsStorage.user) {
				return { storage: PromptsStorage.user };
			}
			return { storage: PromptsStorage.local };
		};

		const result: ICustomAgent[] = [];
		for (const item of items) {
			if (item.type === PromptsType.agent) {
				const promptFile = await this.promptsService.parseNew(item.uri, token);
				const extra = {
					name: item.name,
					description: item.description,
					sessionTypes: [sessionType],
					hooks: undefined,
					source: getSource(item),
					type: PromptsType.agent,
					enabled: item.enabled !== false,
				};
				result.push(CustomAgent.fromParsedPromptFile(promptFile, extra));
			}
		}
		return result;
	}

	public async resolvePromptSlashCommand(name: string, sessionResource: URI, token: CancellationToken): Promise<IResolvedChatPromptSlashCommand | undefined> {
		const commands = await this.getSlashCommands(sessionResource, token);
		let command = commands.find(cmd => cmd.name === name);
		if (!command) {
			const localCommands = await this.promptsService.getPromptSlashCommands(token);
			command = localCommands.find(cmd => cmd.name === name);
		}
		if (command) {
			if (isAgentBuiltinCustomizationUri(command.uri)) {
				return command;
			}
			const parsedPromptFile = await this.promptsService.parseNew(command.uri, token);
			return {
				...command,
				userInvocable: parsedPromptFile.header?.userInvocable ?? command.userInvocable,
				parsedPromptFile,
			};
		}
		return undefined;
	}

	getSessionResourceForHarness(sessionType: string): URI {
		if (sessionType === SessionType.Local) {
			return LocalChatSessionUri.getNewSessionUri();
		}

		return URI.from({ scheme: sessionType, path: '/untitled-2' });
	}
}

