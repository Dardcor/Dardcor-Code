/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { IVoicePlaybackService } from '../../chat/common/voicePlaybackService.js';
import { IVoiceSessionController } from '../../chat/browser/voiceClient/voiceSessionController.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IChatService } from '../../chat/common/chatService/chatService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { AgentsVoiceWidget } from './agentsVoiceWidget.js';
import type { SessionRowData } from './components/sessionListComponent.js';

export interface IWidgetBindingServices {
	readonly voiceSessionController: IVoiceSessionController;
	readonly voicePlaybackService: IVoicePlaybackService;
	readonly environmentService: IWorkbenchEnvironmentService;
	readonly chatService?: IChatService;
	readonly configurationService?: IConfigurationService;
}

export function bindWidgetToController(widget: AgentsVoiceWidget, services: IWidgetBindingServices): IDisposable {
	const store = new DisposableStore();
	const {
		voiceSessionController: controller,
		voicePlaybackService,
		environmentService,
		configurationService,
	} = services;

	store.add(autorun(reader => {
		const state = controller.voiceState.read(reader);
		const connected = controller.isConnected.read(reader);
		const connecting = controller.isConnecting.read(reader);
		const reconnecting = controller.isReconnecting.read(reader);
		const toolConfirmations = controller.pendingToolConfirmations.read(reader);
		const speakingSession = voicePlaybackService.speakingSession.read(reader);
		const statusText = controller.statusText.read(reader);
		const turns = controller.transcriptTurns.read(reader);
		const targetSession = controller.targetSession.read(reader);

		widget.setConnected(connected);
		widget.setConnecting(connecting);
		widget.setReconnecting(reconnecting);
		widget.setVoiceState(state);
		widget.setPendingToolConfirmations(toolConfirmations);
		const showTranscript = configurationService?.getValue<boolean>('agents.voice.showTranscript') !== false;
		widget.setTranscriptTurns(showTranscript ? turns : []);
		widget.setStatusText(statusText);
		widget.setSelectedTargetSession(targetSession);

		widget.setSpeakingSession(speakingSession, undefined);

		_updateSessionData(widget, services);
	}));

	store.add(autorun(reader => {
		voicePlaybackService.speakingSession.read(reader);
		if (services.chatService) {
			for (const model of services.chatService.chatModels.read(reader)) {
				model.hasActiveRequest.read(reader);
				model.requestNeedsInput.read(reader);
				const lastReq = model.lastRequestObs.read(reader);
				if (lastReq?.response) {
					lastReq.response.isIncomplete.read(reader);
					lastReq.response.isPendingConfirmation.read(reader);
				}
			}
		}
		_updateSessionData(widget, services);
	}));

	_updateStatusCounts(widget, services);
	_updateSessionData(widget, services);

	void environmentService;
	return store;
}

function _updateStatusCounts(widget: AgentsVoiceWidget, services: IWidgetBindingServices): void {
	widget.setStatusCounts(0, 0, 0);
}

function _updateSessionData(widget: AgentsVoiceWidget, services: IWidgetBindingServices): void {
	const { voiceSessionController, voicePlaybackService, chatService } = services;

	const toolConfirmations = voiceSessionController.pendingToolConfirmations.get();
	const speakingSession = voicePlaybackService.speakingSession.get();

	const sessionRows: SessionRowData[] = [];

	if (chatService) {
		const agentResources = new Set(sessionRows.map(r => r.resource.toString()));
		const chatModels = chatService.chatModels.get();
		for (const model of chatModels) {
			if (agentResources.has(model.sessionResource.toString())) { continue; }
			const requests = model.getRequests();
			if (requests.length === 0) { continue; }

			const isActive = model.hasActiveRequest.get();
			const needsInput = !!model.requestNeedsInput.get();
			const tc = toolConfirmations.find(c => c.sessionResource.toString() === model.sessionResource.toString());

			sessionRows.push({
				resource: model.sessionResource,
				label: model.title || localize('agentsVoice.chat', "Chat"),
				isActive: isActive && !needsInput,
				needsInput,
				isIdle: !isActive && !needsInput,
				isSpeaking: speakingSession?.toString() === model.sessionResource.toString(),
				insertions: 0,
				deletions: 0,
				toolConfirmation: tc,
			});
		}
	}

	widget.setSessions(sessionRows);

	widget.setSessionGroups(undefined);
}
