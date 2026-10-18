/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DardcorChatAttr, type EditOutcome, type EditSource, GenAiAttr, DardcorAttr, StdAttr } from './genAiAttributes';
import type { IOTelService } from './otelService';

export class GenAiMetrics {


	static recordOperationDuration(
		otel: IOTelService,
		durationSec: number,
		attrs: {
			operationName: string;
			providerName: string;
			requestModel: string;
			responseModel?: string;
			serverAddress?: string;
			serverPort?: number;
			errorType?: string;
		},
	): void {
		otel.recordMetric('gen_ai.client.operation.duration', durationSec, {
			[GenAiAttr.OPERATION_NAME]: attrs.operationName,
			[GenAiAttr.PROVIDER_NAME]: attrs.providerName,
			[GenAiAttr.REQUEST_MODEL]: attrs.requestModel,
			...(attrs.responseModel ? { [GenAiAttr.RESPONSE_MODEL]: attrs.responseModel } : {}),
			...(attrs.serverAddress ? { [StdAttr.SERVER_ADDRESS]: attrs.serverAddress } : {}),
			...(attrs.serverPort ? { [StdAttr.SERVER_PORT]: attrs.serverPort } : {}),
			...(attrs.errorType ? { [StdAttr.ERROR_TYPE]: attrs.errorType } : {}),
		});
	}

	static recordTokenUsage(
		otel: IOTelService,
		tokenCount: number,
		tokenType: 'input' | 'output',
		attrs: {
			operationName: string;
			providerName: string;
			requestModel: string;
			responseModel?: string;
			serverAddress?: string;
		},
	): void {
		otel.recordMetric('gen_ai.client.token.usage', tokenCount, {
			[GenAiAttr.OPERATION_NAME]: attrs.operationName,
			[GenAiAttr.PROVIDER_NAME]: attrs.providerName,
			[GenAiAttr.TOKEN_TYPE]: tokenType,
			[GenAiAttr.REQUEST_MODEL]: attrs.requestModel,
			...(attrs.responseModel ? { [GenAiAttr.RESPONSE_MODEL]: attrs.responseModel } : {}),
			...(attrs.serverAddress ? { [StdAttr.SERVER_ADDRESS]: attrs.serverAddress } : {}),
		});
	}


	static recordToolCallCount(otel: IOTelService, toolName: string, success: boolean): void {
		otel.incrementCounter('dardcor_chat.tool.call.count', 1, {
			[GenAiAttr.TOOL_NAME]: toolName,
			success,
		});
	}

	static recordToolCallDuration(otel: IOTelService, toolName: string, durationMs: number): void {
		otel.recordMetric('dardcor_chat.tool.call.duration', durationMs, {
			[GenAiAttr.TOOL_NAME]: toolName,
		});
	}

	static recordAgentDuration(otel: IOTelService, agentName: string, durationSec: number): void {
		otel.recordMetric('dardcor_chat.agent.invocation.duration', durationSec, {
			[GenAiAttr.AGENT_NAME]: agentName,
		});
	}

	static recordAgentTurnCount(otel: IOTelService, agentName: string, turnCount: number): void {
		otel.recordMetric('dardcor_chat.agent.turn.count', turnCount, {
			[GenAiAttr.AGENT_NAME]: agentName,
		});
	}

	static recordTimeToFirstToken(otel: IOTelService, model: string, ttftSec: number): void {
		otel.recordMetric('dardcor_chat.time_to_first_token', ttftSec, {
			[GenAiAttr.REQUEST_MODEL]: model,
		});
	}

	static recordTimeToFirstChunk(
		otel: IOTelService,
		ttfcSec: number,
		attrs: {
			operationName: string;
			providerName: string;
			requestModel: string;
			responseModel?: string;
		},
	): void {
		otel.recordMetric('gen_ai.client.operation.time_to_first_chunk', ttfcSec, {
			[GenAiAttr.OPERATION_NAME]: attrs.operationName,
			[GenAiAttr.PROVIDER_NAME]: attrs.providerName,
			[GenAiAttr.REQUEST_MODEL]: attrs.requestModel,
			...(attrs.responseModel ? { [GenAiAttr.RESPONSE_MODEL]: attrs.responseModel } : {}),
		});
	}

	static recordTimePerOutputChunk(
		otel: IOTelService,
		interChunkSec: number,
		attrs: {
			operationName: string;
			providerName: string;
			requestModel: string;
			responseModel?: string;
		},
	): void {
		otel.recordMetric('gen_ai.client.operation.time_per_output_chunk', interChunkSec, {
			[GenAiAttr.OPERATION_NAME]: attrs.operationName,
			[GenAiAttr.PROVIDER_NAME]: attrs.providerName,
			[GenAiAttr.REQUEST_MODEL]: attrs.requestModel,
			...(attrs.responseModel ? { [GenAiAttr.RESPONSE_MODEL]: attrs.responseModel } : {}),
		});
	}

	static incrementSessionCount(otel: IOTelService): void {
		otel.incrementCounter('dardcor_chat.session.count');
	}


	static recordEditAcceptance(otel: IOTelService, source: EditSource, outcome: EditOutcome, languageId?: string): void {
		otel.incrementCounter('dardcor_chat.edit.acceptance.count', 1, {
			[DardcorChatAttr.EDIT_SOURCE]: source,
			[DardcorChatAttr.EDIT_OUTCOME]: outcome,
			...(languageId ? { [DardcorChatAttr.LANGUAGE_ID]: languageId } : {}),
		});
	}

	static recordChatEditOutcome(otel: IOTelService, source: EditSource, outcome: EditOutcome, languageId?: string, hasRemainingEdits?: boolean): void {
		otel.incrementCounter('dardcor_chat.chat_edit.outcome.count', 1, {
			[DardcorChatAttr.EDIT_SOURCE]: source,
			[DardcorChatAttr.EDIT_OUTCOME]: outcome,
			...(languageId ? { [DardcorChatAttr.LANGUAGE_ID]: languageId } : {}),
			...(hasRemainingEdits !== undefined ? { [DardcorChatAttr.HAS_REMAINING_EDITS]: hasRemainingEdits } : {}),
		});
	}

	static recordEditSurvivalFourGram(otel: IOTelService, source: EditSource, score: number, timeDelayMs: number): void {
		otel.recordMetric('dardcor_chat.edit.survival.four_gram', score, {
			[DardcorChatAttr.EDIT_SOURCE]: source,
			[DardcorChatAttr.TIME_DELAY_MS]: timeDelayMs,
		});
	}

	static recordEditSurvivalNoRevert(otel: IOTelService, source: EditSource, score: number, timeDelayMs: number): void {
		otel.recordMetric('dardcor_chat.edit.survival.no_revert', score, {
			[DardcorChatAttr.EDIT_SOURCE]: source,
			[DardcorChatAttr.TIME_DELAY_MS]: timeDelayMs,
		});
	}

	static incrementLinesOfCode(otel: IOTelService, type: 'added' | 'removed', languageId: string | undefined, count: number): void {
		otel.incrementCounter('dardcor_chat.lines_of_code.count', count, {
			'type': type,
			...(languageId ? { [DardcorChatAttr.LANGUAGE_ID]: languageId } : {}),
		});
	}


	static incrementUserActionCount(otel: IOTelService, action: string): void {
		otel.incrementCounter('dardcor_chat.user.action.count', 1, {
			'action': action,
		});
	}

	static incrementUserFeedbackCount(otel: IOTelService, rating: string): void {
		otel.incrementCounter('dardcor_chat.user.feedback.count', 1, {
			'rating': rating,
		});
	}


	static incrementAgentEditResponseCount(otel: IOTelService, outcome: string): void {
		otel.incrementCounter('dardcor_chat.agent.edit_response.count', 1, {
			'outcome': outcome,
		});
	}

	static incrementAgentSummarizationCount(otel: IOTelService, outcome: string): void {
		otel.incrementCounter('dardcor_chat.agent.summarization.count', 1, {
			'outcome': outcome,
		});
	}


	static incrementPullRequestCount(otel: IOTelService): void {
		otel.incrementCounter('dardcor_chat.pull_request.count');
	}

	static incrementCloudSessionCount(otel: IOTelService, partnerAgent: string, backendVersion?: string): void {
		otel.incrementCounter('dardcor_chat.cloud.session.count', 1, {
			'partner_agent': partnerAgent,
			...(backendVersion ? { [DardcorAttr.CLOUD_BACKEND_VERSION]: backendVersion } : {}),
		});
	}

	static incrementCloudPrReadyCount(otel: IOTelService, backendVersion?: string): void {
		otel.incrementCounter('dardcor_chat.cloud.pr_ready.count', 1, backendVersion ? { [DardcorAttr.CLOUD_BACKEND_VERSION]: backendVersion } : undefined);
	}

	static recordCloudOperation(otel: IOTelService, operation: string, backendVersion: string, success: boolean, durationMs?: number): void {
		otel.incrementCounter('dardcor_chat.cloud.operation.count', 1, {
			'operation': operation,
			[DardcorAttr.CLOUD_BACKEND_VERSION]: backendVersion,
			'success': success,
		});
		if (durationMs !== undefined) {
			otel.recordMetric('dardcor_chat.cloud.operation.duration', durationMs, {
				'operation': operation,
				[DardcorAttr.CLOUD_BACKEND_VERSION]: backendVersion,
			});
		}
	}

	static incrementCloudError(otel: IOTelService, operation: string, backendVersion: string, errorType: string): void {
		otel.incrementCounter('dardcor_chat.cloud.error.count', 1, {
			'operation': operation,
			[DardcorAttr.CLOUD_BACKEND_VERSION]: backendVersion,
			[StdAttr.ERROR_TYPE]: errorType,
		});
	}
}
