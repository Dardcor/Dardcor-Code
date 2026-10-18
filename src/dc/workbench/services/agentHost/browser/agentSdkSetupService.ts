/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { AGENT_SDK_SETUP_DOWNLOAD_REQUEST_KEY, AGENT_SDK_SETUP_RELOAD_REQUEST_KEY, IAgentSdkSetupInfo, readAgentSdkSetupInfos } from '../../../../platform/agentHost/common/agentSdkSetup.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { ActionType } from '../../../../platform/agentHost/common/state/sessionActions.js';
import { ROOT_STATE_URI } from '../../../../platform/agentHost/common/state/sessionState.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { ICodexAccountService } from './codexAccountService.js';

const CHAT_SETUP_COMMAND_ID = 'workbench.action.chat.triggerSetup';

export const IAgentSdkSetupService = createDecorator<IAgentSdkSetupService>('agentSdkSetupService');

export type AgentSdkSetupState = 'downloadOffered' | 'noAccount' | 'resolved';

type AgentSdkSetupFunnelStep =
	| AgentSdkSetupState
	| 'downloadClicked'
	| 'docsClicked'
	| 'gitHubSignInClicked'
	| 'signInClicked'
	| 'reloadClicked';

interface IAgentSdkSetupFunnelEvent {
	agent: string;
	step: string;
}

type AgentSdkSetupFunnelClassification = {
	agent: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The agent whose setup this step belongs to, e.g. claude or codex.' };
	step: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Which step of the agent SDK setup funnel was reached (downloadOffered, downloadClicked, noAccount, docsClicked, gitHubSignInClicked, signInClicked, reloadClicked, resolved).' };
	owner: 'TylerLeonhardt';
	comment: 'Tracks how far a signed-out user gets through setting up their own Claude or Codex account.';
};

export interface IAgentSdkSetupService {
	readonly _serviceBrand: undefined;

	readonly setups: readonly IAgentSdkSetupInfo[];
	readonly onDidChangeSetups: Event<readonly IAgentSdkSetupInfo[]>;

	requestDownload(agent: string): void;

	openSetupDocs(agent: string): void;

	requestReload(agent: string): void;

	signInToGitHub(agent: string): void;

	signIn(agent: string): void;

	isDownloadPending(agent: string): boolean;

	reportSetupState(agent: string, state: AgentSdkSetupState): void;
}

class AgentSdkSetupService extends Disposable implements IAgentSdkSetupService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSetups = this._register(new Emitter<readonly IAgentSdkSetupInfo[]>());
	readonly onDidChangeSetups = this._onDidChangeSetups.event;

	private _setups: readonly IAgentSdkSetupInfo[] = [];

	private readonly _pendingRequests = new Set<string>();

	get setups(): readonly IAgentSdkSetupInfo[] {
		return this._setups;
	}

	constructor(
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@ICommandService private readonly _commandService: ICommandService,
		@ICodexAccountService private readonly _codexAccountService: ICodexAccountService,
	) {
		super();
		const rootStateListeners = this._register(new DisposableStore());
		const bindRootState = () => {
			rootStateListeners.clear();
			rootStateListeners.add(this._agentHostService.rootState.onDidChange(state => this._updateSetups(readAgentSdkSetupInfos(state))));
			this._pendingRequests.clear();
			const state = this._agentHostService.rootState.value;
			this._updateSetups(readAgentSdkSetupInfos(state instanceof Error ? undefined : state));
		};
		bindRootState();
		this._register(this._agentHostService.onAgentHostStart(bindRootState));
	}

	requestDownload(agent: string): void {
		this._reportStep(agent, 'downloadClicked');
		this._dispatchDownloadRequest(agent);
	}

	openSetupDocs(agent: string): void {
		const url = this._getSetup(agent)?.setupDocsUrl;
		if (!url) {
			return;
		}
		this._reportStep(agent, 'docsClicked');
		void this._openerService.open(url, { openExternal: true });
	}

	requestReload(agent: string): void {
		this._reportStep(agent, 'reloadClicked');
		this._dispatchRequest(AGENT_SDK_SETUP_RELOAD_REQUEST_KEY, agent);
	}

	signInToGitHub(agent: string): void {
		this._reportStep(agent, 'gitHubSignInClicked');
		void this._commandService.executeCommand(CHAT_SETUP_COMMAND_ID);
	}

	signIn(agent: string): void {
		if (agent !== this._codexAccountService.agent) {
			return;
		}
		this._reportStep(agent, 'signInClicked');
		this._codexAccountService.signIn();
	}

	reportSetupState(agent: string, state: AgentSdkSetupState): void {
		this._reportStep(agent, state);
	}

	isDownloadPending(agent: string): boolean {
		return this._pendingRequests.has(agent);
	}

	private _reportStep(agent: string, step: AgentSdkSetupFunnelStep): void {
		this._telemetryService.publicLog2<IAgentSdkSetupFunnelEvent, AgentSdkSetupFunnelClassification>('agentHost.agentSdkSetup', { agent, step });
		this._logService.trace(`[AgentSdkSetup] ${agent}: ${step}`);
	}

	private _getSetup(agent: string): IAgentSdkSetupInfo | undefined {
		return this._setups.find(setup => setup.agent === agent);
	}

	private _dispatchDownloadRequest(agent: string): void {
		this._pendingRequests.add(agent);
		this._dispatchRequest(AGENT_SDK_SETUP_DOWNLOAD_REQUEST_KEY, agent);
		this._onDidChangeSetups.fire(this._setups);
	}

	private _dispatchRequest(key: string, agent: string): void {
		this._agentHostService.dispatch(ROOT_STATE_URI, {
			type: ActionType.RootConfigChanged,
			config: { [key]: { agent, request: generateUuid() } },
		});
	}

	private _updateSetups(setups: readonly IAgentSdkSetupInfo[]): void {
		this._setups = setups;
		for (const setup of setups) {
			if (setup.download !== 'notDownloaded') {
				this._pendingRequests.delete(setup.agent);
			}
		}
		this._onDidChangeSetups.fire(setups);
	}
}

registerSingleton(IAgentSdkSetupService, AgentSdkSetupService, InstantiationType.Delayed);
