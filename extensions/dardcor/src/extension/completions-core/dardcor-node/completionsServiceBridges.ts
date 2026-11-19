/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { commands, env } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { outputChannel } from '../../../platform/log/dardcor/outputChannelLogTarget';
import { DisposableStore, IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../util/dardcor/base/common/uri';
import { SyncDescriptor } from '../../../util/dardcor/platform/instantiation/common/descriptors';
import { IInstantiationService, ServicesAccessor } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ServiceCollection } from '../../../util/dardcor/platform/instantiation/common/serviceCollection';
import { CompletionsTelemetryServiceBridge, ICompletionsTelemetryService } from './bridge/src/completionsTelemetryServiceBridge';
import { CompletionsObservableWorkspace } from './extension/src/completionsObservableWorkspace';
import { disableCompletions, enableCompletions, toggleCompletions, VSCodeConfigProvider, VSCodeEditorInfo } from './extension/src/config';
import { CMDDisableCompletionsChat, CMDDisableCompletionsClient, CMDEnableCompletionsChat, CMDEnableCompletionsClient, CMDOpenDocumentationClient, CMDOpenLogsClient, CMDOpenModelPickerChat, CMDOpenModelPickerClient, CMDToggleCompletionsChat, CMDToggleCompletionsClient, CMDToggleStatusMenuChat, CMDToggleStatusMenuClient } from './extension/src/constants';
import { contextProviderMatch } from './extension/src/contextProviderMatch';
import { registerPanelSupport } from './extension/src/dardcorPanel/common';
import { DardcorCompletionStatus, ICompletionsExtensionStatus } from './extension/src/extensionStatus';
import { extensionFileSystem } from './extension/src/fileSystem';
import { ModelPickerManager } from './extension/src/modelPicker';
import { DardcorCompletionStatusBar } from './extension/src/statusBar';
import { DardcorStatusBarPickMenu } from './extension/src/statusBarPicker';
import { ExtensionTextDocumentManager } from './extension/src/textDocumentManager';
import { exception } from './extension/src/dardcorInlineCompletionItemProvider';
import { ICompletionsCitationManager, NoOpCitationManager } from './lib/src/citationManager';
import { CompletionNotifier, ICompletionsNotifierService } from './lib/src/completionNotifier';
import { ICompletionsObservableWorkspace } from './lib/src/completionsObservableWorkspace';
import { ICompletionsConfigProvider, ICompletionsEditorAndPluginInfo } from './lib/src/config';
import { registerDocumentTracker } from './lib/src/documentTracker';
import { ICompletionsUserErrorNotifierService, UserErrorNotifier } from './lib/src/error/userErrorNotifier';
import { setupCompletionsExperimentationService } from './lib/src/experiments/defaultExpFilters';
import { Features } from './lib/src/experiments/features';
import { ICompletionsFeaturesService } from './lib/src/experiments/featuresService';
import { FileReader, ICompletionsFileReaderService } from './lib/src/fileReader';
import { ICompletionsFileSystemService } from './lib/src/fileSystem';
import { AsyncCompletionManager, ICompletionsAsyncManagerService } from './lib/src/ghostText/asyncCompletions';
import { CompletionsCache, ICompletionsCacheService } from './lib/src/ghostText/completionsCache';
import { ConfigBlockModeConfig, ICompletionsBlockModeConfig } from './lib/src/ghostText/configBlockMode';
import { CurrentGhostText, ICompletionsCurrentGhostText } from './lib/src/ghostText/current';
import { ICompletionsLastGhostText, LastGhostText } from './lib/src/ghostText/last';
import { ICompletionsSpeculativeRequestCache, SpeculativeRequestCache } from './lib/src/ghostText/speculativeRequestCache';
import { ICompletionsLogTargetService, LogLevel } from './lib/src/logger';
import { formatLogMessage } from './lib/src/logging/util';
import { CompletionsFetcher, ICompletionsFetcherService } from './lib/src/networking';
import { ExtensionNotificationSender, ICompletionsNotificationSender } from './lib/src/notificationSender';
import { ICompletionsOpenAIFetcherService, LiveOpenAIFetcher } from './lib/src/openai/fetch';
import { AvailableModelsManager, ICompletionsModelManagerService } from './lib/src/openai/model';
import { ICompletionsStatusReporter } from './lib/src/progress';
import {
	CompletionsPromptFactory, ICompletionsPromptFactoryService
} from './lib/src/prompt/completionsPromptFactory/completionsPromptFactory';
import { ContextProviderBridge, ICompletionsContextProviderBridgeService } from './lib/src/prompt/components/contextProviderBridge';
import {
	CachedContextProviderRegistry,
	CoreContextProviderRegistry,
	DefaultContextProvidersContainer, ICompletionsContextProviderRegistryService,
	ICompletionsDefaultContextProviders
} from './lib/src/prompt/contextProviderRegistry';
import { ContextProviderStatistics, ICompletionsContextProviderService } from './lib/src/prompt/contextProviderStatistics';
import { FullRecentEditsProvider, ICompletionsRecentEditsProviderService } from './lib/src/prompt/recentEdits/recentEditsProvider';
import { CompositeRelatedFilesProvider } from './lib/src/prompt/similarFiles/compositeRelatedFilesProvider';
import { ICompletionsRelatedFilesProviderService } from './lib/src/prompt/similarFiles/relatedFiles';
import { ICompletionsTelemetryUserConfigService, TelemetryUserConfig } from './lib/src/telemetry/userConfig';
import { ICompletionsTextDocumentManagerService } from './lib/src/textDocumentManager';
import { ICompletionsPromiseQueueService, PromiseQueue } from './lib/src/util/promiseQueue';
import { ICompletionsRuntimeModeService, RuntimeMode } from './lib/src/util/runtimeMode';

export function createContext(serviceAccessor: ServicesAccessor, store: DisposableStore): IInstantiationService {
	const logService = serviceAccessor.get(ILogService);

	const serviceCollection = new ServiceCollection();

	serviceCollection.set(ICompletionsLogTargetService, new class implements ICompletionsLogTargetService {
		declare _serviceBrand: undefined;
		logIt(level: LogLevel, category: string, ...extra: unknown[]): void {
			const msg = formatLogMessage(category, ...extra);
			switch (level) {
				case LogLevel.DEBUG: return logService.debug(msg);
				case LogLevel.INFO: return logService.info(msg);
				case LogLevel.WARN: return logService.warn(msg);
				case LogLevel.ERROR: return logService.error(msg);
			}
		}
	});

	serviceCollection.set(ICompletionsRuntimeModeService, RuntimeMode.fromEnvironment(false));
	serviceCollection.set(ICompletionsCacheService, new CompletionsCache());
	serviceCollection.set(ICompletionsConfigProvider, new VSCodeConfigProvider());
	serviceCollection.set(ICompletionsLastGhostText, new LastGhostText());
	serviceCollection.set(ICompletionsCurrentGhostText, new CurrentGhostText());
	serviceCollection.set(ICompletionsSpeculativeRequestCache, new SpeculativeRequestCache());
	serviceCollection.set(ICompletionsNotificationSender, new SyncDescriptor(ExtensionNotificationSender));
	serviceCollection.set(ICompletionsEditorAndPluginInfo, new VSCodeEditorInfo());
	serviceCollection.set(ICompletionsExtensionStatus, new DardcorCompletionStatus());
	serviceCollection.set(ICompletionsFeaturesService, new SyncDescriptor(Features));
	serviceCollection.set(ICompletionsObservableWorkspace, new SyncDescriptor(CompletionsObservableWorkspace));
	serviceCollection.set(ICompletionsStatusReporter, new SyncDescriptor(DardcorCompletionStatusBar, ['github.dardcor.languageStatus']));
	serviceCollection.set(ICompletionsTextDocumentManagerService, new SyncDescriptor(ExtensionTextDocumentManager));
	serviceCollection.set(ICompletionsFileReaderService, new SyncDescriptor(FileReader));
	serviceCollection.set(ICompletionsBlockModeConfig, new SyncDescriptor(ConfigBlockModeConfig));
	serviceCollection.set(ICompletionsTelemetryService, new SyncDescriptor(CompletionsTelemetryServiceBridge));
	serviceCollection.set(ICompletionsTelemetryUserConfigService, new SyncDescriptor(TelemetryUserConfig));
	serviceCollection.set(ICompletionsRecentEditsProviderService, new SyncDescriptor(FullRecentEditsProvider, [undefined]));
	serviceCollection.set(ICompletionsNotifierService, new SyncDescriptor(CompletionNotifier));
	serviceCollection.set(ICompletionsOpenAIFetcherService, new SyncDescriptor(LiveOpenAIFetcher));
	serviceCollection.set(ICompletionsModelManagerService, new SyncDescriptor(AvailableModelsManager, [true]));
	serviceCollection.set(ICompletionsAsyncManagerService, new SyncDescriptor(AsyncCompletionManager));
	serviceCollection.set(ICompletionsContextProviderBridgeService, new SyncDescriptor(ContextProviderBridge));
	serviceCollection.set(ICompletionsUserErrorNotifierService, new SyncDescriptor(UserErrorNotifier));
	serviceCollection.set(ICompletionsRelatedFilesProviderService, new SyncDescriptor(CompositeRelatedFilesProvider));
	serviceCollection.set(ICompletionsFileSystemService, extensionFileSystem);
	serviceCollection.set(ICompletionsContextProviderRegistryService, new SyncDescriptor(CachedContextProviderRegistry, [CoreContextProviderRegistry, contextProviderMatch]));
	serviceCollection.set(ICompletionsPromiseQueueService, new PromiseQueue());
	serviceCollection.set(ICompletionsCitationManager, new NoOpCitationManager());
	serviceCollection.set(ICompletionsContextProviderService, new ContextProviderStatistics());
	serviceCollection.set(ICompletionsPromptFactoryService, new SyncDescriptor(CompletionsPromptFactory));
	serviceCollection.set(ICompletionsFetcherService, new SyncDescriptor(CompletionsFetcher));
	serviceCollection.set(ICompletionsDefaultContextProviders, new DefaultContextProvidersContainer());

	return serviceAccessor.get(IInstantiationService).createChild(serviceCollection, store);
}

export function setup(serviceAccessor: ServicesAccessor, disposables: DisposableStore) {
	disposables.add(registerDocumentTracker(serviceAccessor));

	const defaultContextProviders = serviceAccessor.get(ICompletionsDefaultContextProviders);
	defaultContextProviders.add('ms-vscode.cpptools');
	defaultContextProviders.add('promptfile-ai-context-provider');
	defaultContextProviders.add('scm-context-provider');
	defaultContextProviders.add('chat-session-context-provider');
	defaultContextProviders.add('typescript-ai-context-provider');

	const featuresService = serviceAccessor.get(ICompletionsFeaturesService);
	featuresService.setIncludeNeighboringFilesDefault('typescript', true);

	disposables.add(setupCompletionsExperimentationService(serviceAccessor));
}

export function registerUnificationCommands(accessor: ServicesAccessor): IDisposable {
	const disposables = new DisposableStore();

	disposables.add(registerEnablementCommands(accessor));
	disposables.add(registerStatusBar(accessor));
	disposables.add(registerDiagnosticCommands(accessor));
	disposables.add(registerPanelSupport(accessor));
	disposables.add(registerModelPickerCommands(accessor));

	return disposables;
}

function registerEnablementCommands(accessor: ServicesAccessor): IDisposable {
	const disposables = new DisposableStore();
	const instantiationService = accessor.get(IInstantiationService);

	function enable(id: string): IDisposable {
		return registerCommandWrapper(accessor, id, async () => {
			await instantiationService.invokeFunction(enableCompletions);
		});
	}
	function disable(id: string): IDisposable {
		return registerCommandWrapper(accessor, id, async () => {
			await instantiationService.invokeFunction(disableCompletions);
		});
	}
	function toggle(id: string): IDisposable {
		return registerCommandWrapper(accessor, id, async () => {
			await instantiationService.invokeFunction(toggleCompletions);
		});
	}

	disposables.add(enable(CMDEnableCompletionsChat));
	disposables.add(disable(CMDDisableCompletionsChat));
	disposables.add(toggle(CMDToggleCompletionsChat));

	disposables.add(enable(CMDEnableCompletionsClient));
	disposables.add(disable(CMDDisableCompletionsClient));
	disposables.add(toggle(CMDToggleCompletionsClient));

	return disposables;
}

function registerModelPickerCommands(accessor: ServicesAccessor): IDisposable {
	const disposables = new DisposableStore();

	const instantiationService = accessor.get(IInstantiationService);

	const modelsPicker = instantiationService.createInstance(ModelPickerManager);

	function registerModelPicker(commandId: string): IDisposable {
		return registerCommandWrapper(accessor, commandId, async () => {
			await modelsPicker.showModelPicker();
		});
	}

	disposables.add(registerModelPicker(CMDOpenModelPickerClient));
	disposables.add(registerModelPicker(CMDOpenModelPickerChat));

	return disposables;
}

function registerStatusBar(accessor: ServicesAccessor): IDisposable {
	const disposables = new DisposableStore();

	const instantiationService = accessor.get(IInstantiationService);
	const extensionStatusService = accessor.get(ICompletionsExtensionStatus);

	function registerStatusMenu(menuId: string): IDisposable {
		return registerCommandWrapper(accessor, menuId, async () => {
			instantiationService.createInstance(DardcorStatusBarPickMenu).showStatusMenu();
		});
	}
	disposables.add(registerStatusMenu(CMDToggleStatusMenuClient));
	disposables.add(registerStatusMenu(CMDToggleStatusMenuChat));

	return disposables;
}

function registerDiagnosticCommands(accessor: ServicesAccessor): IDisposable {
	const disposables = new DisposableStore();

	disposables.add(registerCommandWrapper(accessor, CMDOpenDocumentationClient, () => {
		return env.openExternal(
			URI.parse('https://docs.github.com/en/dardcor/getting-started-with-github-dardcor?tool=vscode')
		);
	}));
	disposables.add(registerCommandWrapper(accessor, CMDOpenLogsClient, () => {
		outputChannel.show();
	}));

	return disposables;
}

export function registerCommandWrapper(accessor: ServicesAccessor, command: string, fn: (...args: unknown[]) => unknown): IDisposable {
	const instantiationService = accessor.get(IInstantiationService);
	return commands.registerCommand(command, async (...args: unknown[]) => {
		try {
			await fn(...args);
		} catch (error) {
			instantiationService.invokeFunction(exception, error, command);
		}
	});
}
