/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryService } from '../../telemetry/common/telemetry';

interface IChatWebSocketConnectionTelemetryProperties {
	conversationId: string;
	initiatingRequestId: string;
	gitHubRequestId: string;
}

interface IChatWebSocketRequestTelemetryProperties extends IChatWebSocketConnectionTelemetryProperties {
	modelId: string | undefined;
	requestId: string | undefined;
	turnId: string | undefined;
	previousTurnId: string | undefined;
	hadActiveRequest: boolean;
}

export interface IChatWebSocketConnectedTelemetryProperties extends IChatWebSocketConnectionTelemetryProperties {
	connectDurationMs: number;
}

export interface IChatWebSocketConnectErrorTelemetryProperties extends IChatWebSocketConnectionTelemetryProperties {
	error: string;
	connectDurationMs: number;
	responseStatusCode: number | undefined;
	responseStatusText: string | undefined;
	networkError: string | undefined;
}

export interface IChatWebSocketCloseTelemetryProperties extends IChatWebSocketRequestTelemetryProperties {
	closeCode: number;
	closeReason: string;
	closeEventReason: string;
	closeEventWasClean: string;
	connectionDurationMs: number;
	totalSentMessageCount: number;
	totalReceivedMessageCount: number;
	totalSentCharacters: number;
	totalReceivedCharacters: number;
}

export interface IChatWebSocketErrorTelemetryProperties extends IChatWebSocketRequestTelemetryProperties {
	error: string;
	connectionDurationMs: number;
	totalSentMessageCount: number;
	totalReceivedMessageCount: number;
	totalSentCharacters: number;
	totalReceivedCharacters: number;
}

export interface IChatWebSocketCloseDuringSetupTelemetryProperties extends IChatWebSocketConnectionTelemetryProperties {
	closeCode: number;
	closeReason: string;
	closeEventReason: string;
	closeEventWasClean: string;
	connectDurationMs: number;
}

export interface IChatWebSocketRequestSentTelemetryProperties extends IChatWebSocketRequestTelemetryProperties {
	statefulMarkerMatched: boolean;
	previousResponseIdUnset: boolean;
	hasCompactionData: boolean;
	summarizedAtRoundIdSet: boolean;
	summarizedAtRoundIdMatched: boolean;
	modeChanged: boolean | undefined;
	compactionThreshold: number | undefined;
	tokenCountMax: number;
	modelMaxPromptTokens: number;
	connectionDurationMs: number;
	totalSentMessageCount: number;
	totalReceivedMessageCount: number;
	sentMessageCharacters: number;
	totalSentCharacters: number;
	totalReceivedCharacters: number;
}

export interface IChatWebSocketMessageParseErrorTelemetryProperties extends IChatWebSocketRequestTelemetryProperties {
	error: string;
	connectionDurationMs: number;
	totalSentMessageCount: number;
	totalReceivedMessageCount: number;
	receivedMessageCharacters: number;
	totalSentCharacters: number;
	totalReceivedCharacters: number;
}

export type ChatWebSocketRequestOutcome = 'completed' | 'response_failed' | 'response_incomplete' | 'response_cancelled' | 'upstream_error' | 'canceled' | 'superseded' | 'connection_closed' | 'connection_disposed' | 'error_response';

export interface IChatWebSocketRequestOutcomeTelemetryProperties extends IChatWebSocketRequestTelemetryProperties {
	requestOutcome: ChatWebSocketRequestOutcome;
	statefulMarkerMatched: boolean;
	previousResponseIdUnset: boolean;
	hasCompactionData: boolean;
	summarizedAtRoundIdSet: boolean;
	summarizedAtRoundIdMatched: boolean;
	modeChanged: boolean | undefined;
	compactionThreshold: number | undefined;
	promptTokenCount: number;
	tokenCountMax: number;
	modelMaxPromptTokens: number;
	connectionDurationMs: number;
	requestDurationMs: number;
	totalSentMessageCount: number;
	totalReceivedMessageCount: number;
	totalSentCharacters: number;
	totalReceivedCharacters: number;
	requestSentMessageCount: number;
	requestReceivedMessageCount: number;
	requestSentCharacters: number;
	requestReceivedCharacters: number;
	closeCode?: number;
	closeReason?: string;
	serverErrorMessage?: string;
	serverErrorCode?: string;
}

export class ChatWebSocketTelemetrySender {

	public static sendConnectedTelemetry(
		telemetryService: ITelemetryService,
		properties: IChatWebSocketConnectedTelemetryProperties,
	) {
		telemetryService.sendTelemetryEvent('websocket.connected', { github: true, microsoft: true }, {
			conversationId: properties.conversationId,
			initiatingRequestId: properties.initiatingRequestId,
			gitHubRequestId: properties.gitHubRequestId,
		}, {
			connectDurationMs: properties.connectDurationMs,
		});
	}

	public static sendConnectErrorTelemetry(
		telemetryService: ITelemetryService,
		properties: IChatWebSocketConnectErrorTelemetryProperties,
	) {
		telemetryService.sendTelemetryErrorEvent('websocket.connectError', { github: true, microsoft: true }, {
			conversationId: properties.conversationId,
			initiatingRequestId: properties.initiatingRequestId,
			gitHubRequestId: properties.gitHubRequestId,
			error: properties.error,
			responseStatusText: properties.responseStatusText,
			networkError: properties.networkError,
		}, {
			connectDurationMs: properties.connectDurationMs,
			responseStatusCode: properties.responseStatusCode,
		});
	}

	public static sendCloseTelemetry(
		telemetryService: ITelemetryService,
		properties: IChatWebSocketCloseTelemetryProperties,
	) {
		telemetryService.sendTelemetryEvent('websocket.close', { github: true, microsoft: true }, {
			conversationId: properties.conversationId,
			initiatingRequestId: properties.initiatingRequestId,
			turnId: properties.turnId,
			previousTurnId: properties.previousTurnId,
			requestId: properties.requestId,
			gitHubRequestId: properties.gitHubRequestId,
			modelId: properties.modelId,
			closeReason: properties.closeReason,
			closeEventReason: properties.closeEventReason,
			closeEventWasClean: properties.closeEventWasClean,
		}, {
			hadActiveRequest: properties.hadActiveRequest ? 1 : 0,
			closeCode: properties.closeCode,
			totalSentMessageCount: properties.totalSentMessageCount,
			totalReceivedMessageCount: properties.totalReceivedMessageCount,
			totalSentCharacters: properties.totalSentCharacters,
			totalReceivedCharacters: properties.totalReceivedCharacters,
			connectionDurationMs: properties.connectionDurationMs,
		});
	}

	public static sendErrorTelemetry(
		telemetryService: ITelemetryService,
		properties: IChatWebSocketErrorTelemetryProperties,
	) {
		telemetryService.sendTelemetryErrorEvent('websocket.error', { github: true, microsoft: true }, {
			conversationId: properties.conversationId,
			initiatingRequestId: properties.initiatingRequestId,
			turnId: properties.turnId,
			previousTurnId: properties.previousTurnId,
			requestId: properties.requestId,
			gitHubRequestId: properties.gitHubRequestId,
			modelId: properties.modelId,
			error: properties.error,
		}, {
			hadActiveRequest: properties.hadActiveRequest ? 1 : 0,
			totalSentMessageCount: properties.totalSentMessageCount,
			totalReceivedMessageCount: properties.totalReceivedMessageCount,
			totalSentCharacters: properties.totalSentCharacters,
			totalReceivedCharacters: properties.totalReceivedCharacters,
			connectionDurationMs: properties.connectionDurationMs,
		});
	}

	public static sendCloseDuringSetupTelemetry(
		telemetryService: ITelemetryService,
		properties: IChatWebSocketCloseDuringSetupTelemetryProperties,
	) {
		telemetryService.sendTelemetryErrorEvent('websocket.closeDuringSetup', { github: true, microsoft: true }, {
			conversationId: properties.conversationId,
			initiatingRequestId: properties.initiatingRequestId,
			gitHubRequestId: properties.gitHubRequestId,
			closeReason: properties.closeReason,
			closeEventReason: properties.closeEventReason,
			closeEventWasClean: properties.closeEventWasClean,
		}, {
			closeCode: properties.closeCode,
			connectDurationMs: properties.connectDurationMs,
		});
	}

	public static sendRequestSentTelemetry(
		telemetryService: ITelemetryService,
		properties: IChatWebSocketRequestSentTelemetryProperties,
	) {
		telemetryService.sendTelemetryEvent('websocket.requestSent', { github: true, microsoft: true }, {
			conversationId: properties.conversationId,
			initiatingRequestId: properties.initiatingRequestId,
			turnId: properties.turnId,
			previousTurnId: properties.previousTurnId,
			requestId: properties.requestId,
			gitHubRequestId: properties.gitHubRequestId,
			modelId: properties.modelId,
		}, {
			hadActiveRequest: properties.hadActiveRequest ? 1 : 0,
			statefulMarkerMatched: properties.statefulMarkerMatched ? 1 : 0,
			previousResponseIdUnset: properties.previousResponseIdUnset ? 1 : 0,
			hasCompactionData: properties.hasCompactionData ? 1 : 0,
			summarizedAtRoundIdSet: properties.summarizedAtRoundIdSet ? 1 : 0,
			summarizedAtRoundIdMatched: properties.summarizedAtRoundIdMatched ? 1 : 0,
			modeChanged: properties.modeChanged === undefined ? -1 : properties.modeChanged ? 1 : 0,
			compactionThreshold: properties.compactionThreshold,
			tokenCountMax: properties.tokenCountMax,
			modelMaxPromptTokens: properties.modelMaxPromptTokens,
			totalSentMessageCount: properties.totalSentMessageCount,
			totalReceivedMessageCount: properties.totalReceivedMessageCount,
			sentMessageCharacters: properties.sentMessageCharacters,
			totalSentCharacters: properties.totalSentCharacters,
			totalReceivedCharacters: properties.totalReceivedCharacters,
			connectionDurationMs: properties.connectionDurationMs,
		});
	}

	public static sendMessageParseErrorTelemetry(
		telemetryService: ITelemetryService,
		properties: IChatWebSocketMessageParseErrorTelemetryProperties,
	) {
		telemetryService.sendTelemetryErrorEvent('websocket.messageParseError', { github: true, microsoft: true }, {
			conversationId: properties.conversationId,
			initiatingRequestId: properties.initiatingRequestId,
			turnId: properties.turnId,
			previousTurnId: properties.previousTurnId,
			requestId: properties.requestId,
			gitHubRequestId: properties.gitHubRequestId,
			modelId: properties.modelId,
			error: properties.error,
		}, {
			hadActiveRequest: properties.hadActiveRequest ? 1 : 0,
			totalSentMessageCount: properties.totalSentMessageCount,
			totalReceivedMessageCount: properties.totalReceivedMessageCount,
			receivedMessageCharacters: properties.receivedMessageCharacters,
			totalSentCharacters: properties.totalSentCharacters,
			totalReceivedCharacters: properties.totalReceivedCharacters,
			connectionDurationMs: properties.connectionDurationMs,
		});
	}

	public static sendRequestOutcomeTelemetry(
		telemetryService: ITelemetryService,
		properties: IChatWebSocketRequestOutcomeTelemetryProperties,
	) {
		telemetryService.sendTelemetryEvent('websocket.requestOutcome', { github: true, microsoft: true }, {
			conversationId: properties.conversationId,
			initiatingRequestId: properties.initiatingRequestId,
			turnId: properties.turnId,
			previousTurnId: properties.previousTurnId,
			requestId: properties.requestId,
			gitHubRequestId: properties.gitHubRequestId,
			modelId: properties.modelId,
			requestOutcome: properties.requestOutcome,
			closeReason: properties.closeReason,
			serverErrorMessage: properties.serverErrorMessage,
			serverErrorCode: properties.serverErrorCode,
		}, {
			hadActiveRequest: properties.hadActiveRequest ? 1 : 0,
			statefulMarkerMatched: properties.statefulMarkerMatched ? 1 : 0,
			previousResponseIdUnset: properties.previousResponseIdUnset ? 1 : 0,
			hasCompactionData: properties.hasCompactionData ? 1 : 0,
			summarizedAtRoundIdSet: properties.summarizedAtRoundIdSet ? 1 : 0,
			summarizedAtRoundIdMatched: properties.summarizedAtRoundIdMatched ? 1 : 0,
			modeChanged: properties.modeChanged === undefined ? -1 : properties.modeChanged ? 1 : 0,
			compactionThreshold: properties.compactionThreshold,
			promptTokenCount: properties.promptTokenCount,
			tokenCountMax: properties.tokenCountMax,
			modelMaxPromptTokens: properties.modelMaxPromptTokens,
			totalSentMessageCount: properties.totalSentMessageCount,
			totalReceivedMessageCount: properties.totalReceivedMessageCount,
			totalSentCharacters: properties.totalSentCharacters,
			totalReceivedCharacters: properties.totalReceivedCharacters,
			requestSentMessageCount: properties.requestSentMessageCount,
			requestReceivedMessageCount: properties.requestReceivedMessageCount,
			requestSentCharacters: properties.requestSentCharacters,
			requestReceivedCharacters: properties.requestReceivedCharacters,
			connectionDurationMs: properties.connectionDurationMs,
			requestDurationMs: properties.requestDurationMs,
			closeCode: properties.closeCode,
		});
	}
}
