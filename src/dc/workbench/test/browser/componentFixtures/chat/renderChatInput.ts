/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { constObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IMenuService, MenuId } from '../../../../../platform/actions/common/actions.js';
import { ResolveSessionConfigResult } from '../../../../../platform/agentHost/common/state/protocol/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IChatWidget } from '../../../../contrib/chat/browser/chat.js';
import { SessionType } from '../../../../contrib/chat/common/chatSessionsService.js';
import { getNewChatSessionResource } from '../../../../contrib/chat/common/model/chatUri.js';
import { ChatInputPart, IChatInputPartOptions, IChatInputStyles } from '../../../../contrib/chat/browser/widget/input/chatInputPart.js';
import { IChatModel } from '../../../../contrib/chat/common/model/chatModel.js';
import { IChatViewModel } from '../../../../contrib/chat/common/model/chatViewModel.js';
import { IArtifactSourceGroup } from '../../../../contrib/chat/common/tools/chatArtifactsService.js';
import { IChatInputNotification } from '../../../../contrib/chat/browser/widget/input/chatInputNotificationService.js';
import { IChatEditingSession } from '../../../../contrib/chat/common/editing/chatEditingService.js';
import { IChatTodo } from '../../../../contrib/chat/common/tools/chatTodoListService.js';
import { ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService } from '../../../../contrib/chat/common/languageModels.js';
import { ChatAgentLocation, ChatConfiguration } from '../../../../contrib/chat/common/constants.js';
import { AgentSandboxEnabledValue, AgentSandboxSettingId } from '../../../../../platform/sandbox/common/settings.js';
import { ComponentFixtureContext, createEditorServices } from '../fixtureUtils.js';
import { FixtureMenuService, registerChatFixtureServices } from './chatFixtureUtils.js';
import { IChatPetService } from '../../../../contrib/chat/browser/chatPetService.js';
import { IChatPetWidgetService } from '../../../../contrib/chat/browser/widget/chatPetWidgetService.js';
import { configureChatPetFixtureFileRoot, FixtureChatPetService, assertChatPetInScreenshot } from './chatPetFixtureUtils.js';

const PET_HEADROOM = 64;

export type VoiceControlState =
	| 'dictationIdle'
	| 'dictationRecording'
	| 'dictationPreparing'
	| 'voiceIdle'
	| 'voiceConnecting'
	| 'voiceListening'
	| 'voiceSpeaking'
	| 'voiceDisconnect';

interface IVoiceControlRendering {
	readonly icon: ThemeIcon;
	readonly containerClasses?: readonly string[];
	readonly itemClasses?: readonly string[];
}

const voiceControlRenderings: Record<VoiceControlState, IVoiceControlRendering> = {
	dictationIdle: { icon: Codicon.mic },
	dictationRecording: { icon: Codicon.micFilled, itemClasses: ['dictation-mic-active'] },
	dictationPreparing: { icon: Codicon.micDownloadCompact },
	voiceIdle: { icon: Codicon.voiceModeCompact },
	voiceConnecting: { icon: Codicon.loadingCompact },
	voiceListening: { icon: Codicon.voiceModeCompact, containerClasses: ['voice-active', 'voice-listening'] },
	voiceSpeaking: { icon: Codicon.voiceModeCompact, containerClasses: ['voice-active', 'voice-speaking'] },
	voiceDisconnect: { icon: Codicon.debugDisconnectCompact, containerClasses: ['voice-active'] },
};

function createFixtureChatViewModel(sessionResource: URI): IChatViewModel {
	const model = new class extends mock<IChatModel>() {
		override readonly sessionResource = sessionResource;
		override readonly lastRequestObs = constObservable(undefined);
	}();
	return new class extends mock<IChatViewModel>() {
		override readonly sessionResource = sessionResource;
		override readonly model = model;
	}();
}

export interface ChatInputFixtureOptions {
	readonly artifacts?: readonly { label: string; uri: string; type: 'devServer' | 'screenshot' | 'plan' | undefined }[];
	readonly editingSession?: IChatEditingSession;
	readonly todos?: IChatTodo[];
	readonly sandboxingEnabled?: boolean;
	readonly value?: string;
	readonly selection?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
	readonly width?: number;
	readonly resizeWidths?: readonly number[];
	readonly models?: readonly ILanguageModelChatMetadataAndIdentifier[];
	readonly agentHostSessionConfig?: ResolveSessionConfigResult;
	readonly voiceControl?: VoiceControlState;
	readonly notification?: IChatInputNotification;
	readonly pet?: boolean;
	readonly secondaryPickerLabels?: readonly [target: string, permission: string];
}

export async function renderChatInput(context: ComponentFixtureContext, fixtureOptions: ChatInputFixtureOptions = {}): Promise<void> {
	const { container, disposableStore } = context;
	const { artifacts = [], editingSession, todos = [], value, selection, sandboxingEnabled = false, width = 500, resizeWidths = [], models = [], agentHostSessionConfig, voiceControl, notification, pet = false, secondaryPickerLabels = ['Local', 'Default permissions'] } = fixtureOptions;
	const artifactGroups: IArtifactSourceGroup[] = artifacts.length > 0 ? [{ source: { kind: 'agent' as const }, artifacts }] : [];
	const artifactsObs = observableValue<readonly IArtifactSourceGroup[]>('artifactGroups', artifactGroups);
	const sessionResource = agentHostSessionConfig ? getNewChatSessionResource(SessionType.AgentHostCopilot) : undefined;

	if (pet) {
		configureChatPetFixtureFileRoot(disposableStore);
	}
	const chatPetService = pet ? disposableStore.add(new FixtureChatPetService({ enabled: true })) : undefined;

	const instantiationService = createEditorServices(disposableStore, {
		colorTheme: context.theme,
		additionalServices: (reg) => {
			registerChatFixtureServices(reg, { artifactGroups: artifactsObs, todos, notification, agentHostSessionConfig });
			if (chatPetService) {
				reg.defineInstance(IChatPetService, chatPetService);
			}
			if (models.length > 0) {
				const modelsById = new Map(models.map(model => [model.identifier, model]));
				reg.defineInstance(ILanguageModelsService, new class extends mock<ILanguageModelsService>() {
					override onDidChangeLanguageModels = Event.None;
					override onDidChangeModelVisibility = Event.None;
					override onDidChangePinnedModels = Event.None;
					override getLanguageModelIds() { return [...modelsById.keys()]; }
					override getHiddenModelIds() { return []; }
					override getVendors() {
						return [...new Set(models.map(model => model.metadata.vendor))].map(vendor => ({
							vendor,
							displayName: vendor,
							isDefault: false,
							configuration: undefined,
							managementCommand: undefined,
							when: undefined,
						}));
					}
					override isModelHidden() { return false; }
					override getRecentlyUsedModelIds() { return []; }
					override getPinnedModelIds() { return []; }
					override getModelsControlManifest() { return { free: {}, paid: {} }; }
					override lookupLanguageModel(modelId: string) { return modelsById.get(modelId)?.metadata; }
					override getModelConfiguration() { return undefined; }
					override getLanguageModelGroups() { return []; }
					override hasResolvedVendor() { return true; }
				}());
			}
		},
	});

	if (artifacts.length > 0) {
		const configService = instantiationService.get(IConfigurationService) as TestConfigurationService;
		await configService.setUserConfiguration(ChatConfiguration.ArtifactsEnabled, true);
	}

	if (sandboxingEnabled) {
		const configService = instantiationService.get(IConfigurationService) as TestConfigurationService;
		await configService.setUserConfiguration(ChatConfiguration.PermissionsSandboxToggleEnabled, true);
		await configService.setUserConfiguration(AgentSandboxSettingId.AgentSandboxEnabled, AgentSandboxEnabledValue.On);
	}

	container.style.width = `${width}px`;
	container.style.backgroundColor = 'var(--vscode-sideBar-background, var(--vscode-editor-background))';
	container.classList.add('monaco-workbench');
	if (pet) {
		container.style.paddingTop = `${PET_HEADROOM}px`;
	}

	const session = document.createElement('div');
	session.classList.add('interactive-session');
	container.appendChild(session);

	const menuService = instantiationService.get(IMenuService) as FixtureMenuService;
	menuService.addItem(MenuId.ChatInput, { command: { id: 'workbench.action.chat.attachContext', title: '+', icon: Codicon.addCompact }, group: 'navigation', order: -1 });
	menuService.addItem(MenuId.ChatInput, { command: { id: 'workbench.action.chat.openModePicker', title: 'Agent' }, group: 'navigation', order: 1 });
	menuService.addItem(MenuId.ChatInput, { command: { id: 'workbench.action.chat.openModelPicker', title: 'GPT-5.3-Codex' }, group: 'navigation', order: 3 });
	menuService.addItem(MenuId.ChatInput, { command: { id: 'workbench.action.chat.configureTools', title: '', icon: Codicon.settingsCompact }, group: 'navigation', order: 100 });
	if (voiceControl) {
		menuService.addItem(MenuId.ChatExecute, { command: { id: 'fixture.voiceControl', title: 'Voice', icon: voiceControlRenderings[voiceControl].icon }, group: 'navigation', order: 2 });
	}
	menuService.addItem(MenuId.ChatExecute, { command: { id: 'workbench.action.chat.submit', title: 'Send', icon: Codicon.arrowUpCompact }, group: 'navigation', order: 4 });
	const hasCustomSecondaryPickerLabels = fixtureOptions.secondaryPickerLabels !== undefined;
	menuService.addItem(MenuId.ChatInputSecondary, { command: { id: hasCustomSecondaryPickerLabels ? 'fixture.secondaryTarget' : 'workbench.action.chat.openSessionTargetPicker', title: secondaryPickerLabels[0] }, group: 'navigation', order: 0 });
	if (hasCustomSecondaryPickerLabels) {
		menuService.addItem(MenuId.ChatInputSecondary, { command: { id: 'fixture.secondaryPermission', title: secondaryPickerLabels[1] }, group: 'navigation', order: 10 });
	} else if (agentHostSessionConfig) {
	} else {
		menuService.addItem(MenuId.ChatInputSecondary, { command: { id: 'workbench.action.chat.openPermissionPicker', title: 'Default Permissions' }, group: 'navigation', order: 10 });
	}

	const options: IChatInputPartOptions = {
		renderFollowups: false,
		renderInputToolbarBelowInput: false,
		renderWorkingSet: !!editingSession,
		menus: { executeToolbar: MenuId.ChatExecute, telemetrySource: 'fixture' },
		widgetViewKindTag: 'view',
		inputEditorMinLines: 2,
		sessionTypePickerDelegate: agentHostSessionConfig
			? { getActiveSessionProvider: () => SessionType.AgentHostCopilot }
			: sandboxingEnabled
				? { getActiveSessionProvider: () => SessionType.Local }
				: undefined,
	};
	const styles: IChatInputStyles = {
		overlayBackground: 'var(--vscode-editor-background)',
		listForeground: 'var(--vscode-foreground)',
		listBackground: 'var(--vscode-editor-background)',
	};

	const inputPart = disposableStore.add(instantiationService.createInstance(ChatInputPart, ChatAgentLocation.Chat, options, styles, false));
	const mockWidget = new class extends mock<IChatWidget>() {
		override readonly onDidChangeViewModel = new Emitter<never>().event;
		override readonly viewModel = sessionResource ? createFixtureChatViewModel(sessionResource) : undefined;
		override readonly contribs = [];
		override readonly location = ChatAgentLocation.Chat;
		override readonly viewContext = {};
	}();

	inputPart.render(session, '', mockWidget);

	if (pet) {
		disposableStore.add(instantiationService.invokeFunction(accessor => accessor.get(IChatPetWidgetService).register(mockWidget, {
			parent: inputPart.element,
			dragBounds: inputPart.inputContainerElement ?? inputPart.element,
			movementBounds: session,
			model: constObservable(undefined),
			hasInput: constObservable(false),
			inputChanged: inputPart.inputEditor.onDidChangeModelContent,
			getPlatformTop: petCenterX => inputPart.getChatPetPlatformTop(petCenterX),
			onDidChangePlatform: inputPart.onDidChangeChatPetHorizontalPlatforms,
		})));
	}

	inputPart.layout(width);
	await new Promise(r => setTimeout(r, 100));
	inputPart.layout(width);
	if (resizeWidths.length > 0) {
		await Promise.all(resizeWidths.map((resizeWidth, index) => new Promise<void>(resolve => setTimeout(() => {
			container.style.width = `${resizeWidth}px`;
			inputPart.layout(resizeWidth);
			resolve();
		}, index * 16))));
	}

	if (value !== undefined) {
		inputPart.setValue(value, true);
		inputPart.layout(width);
		if (selection) {
			inputPart.inputEditor.setSelection(selection);
		}
	}
	inputPart.renderArtifactsWidget(URI.parse('chat-session:test-session'));
	await inputPart.renderChatTodoListWidget(URI.parse('chat-session:test-session'));
	await new Promise(r => setTimeout(r, 50));

	if (editingSession) {
		inputPart.renderChatEditingSessionState(editingSession);
		await new Promise(r => setTimeout(r, 50));
		inputPart.layout(width);
	}

	if (voiceControl) {
		const { containerClasses, itemClasses } = voiceControlRenderings[voiceControl];
		if (containerClasses?.length) {
			session.querySelector('.chat-input-container')?.classList.add(...containerClasses);
		}
		if (itemClasses?.length) {
			const item = session.querySelector('.chat-execute-toolbar .monaco-action-bar .action-item');
			item?.classList.add(...itemClasses);
			(item as HTMLElement | null)?.style.setProperty('--dictation-mic-level', '0.6');
		}
	}

	if (pet) {
		assertChatPetInScreenshot(container);
	}
}
