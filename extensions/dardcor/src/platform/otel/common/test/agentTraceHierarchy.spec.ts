/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DardcorChatAttr, GenAiAttr, GenAiOperationName, GenAiProviderName } from '../genAiAttributes';
import { emitAgentTurnEvent, emitSessionStartEvent } from '../genAiEvents';
import { GenAiMetrics } from '../genAiMetrics';
import { SpanKind, SpanStatusCode } from '../otelService';
import { CapturingOTelService } from './capturingOTelService';

describe('Agent Trace Hierarchy', () => {
	it('produces invoke_agent, chat, and execute_tool spans with correct attributes', async () => {
		const otel = new CapturingOTelService();

		await otel.startActiveSpan('invoke_agent dardcor', {
			kind: SpanKind.INTERNAL,
			attributes: {
				[GenAiAttr.OPERATION_NAME]: GenAiOperationName.INVOKE_AGENT,
				[GenAiAttr.PROVIDER_NAME]: GenAiProviderName.GITHUB,
				[GenAiAttr.AGENT_NAME]: 'dardcor',
				[GenAiAttr.CONVERSATION_ID]: 'conv-123',
			},
		}, async (agentSpan) => {
			const chatSpan = otel.startSpan('chat gpt-4o', {
				kind: SpanKind.CLIENT,
				attributes: {
					[GenAiAttr.OPERATION_NAME]: GenAiOperationName.CHAT,
					[GenAiAttr.REQUEST_MODEL]: 'gpt-4o',
				},
			});
			chatSpan.setAttributes({
				[GenAiAttr.USAGE_INPUT_TOKENS]: 1500,
				[GenAiAttr.USAGE_OUTPUT_TOKENS]: 250,
				[GenAiAttr.RESPONSE_MODEL]: 'gpt-4o-2024-08-06',
			});
			chatSpan.setStatus(SpanStatusCode.OK);
			chatSpan.end();

			const toolSpan = otel.startSpan('execute_tool readFile', {
				kind: SpanKind.INTERNAL,
				attributes: {
					[GenAiAttr.OPERATION_NAME]: GenAiOperationName.EXECUTE_TOOL,
					[GenAiAttr.TOOL_NAME]: 'readFile',
				},
			});
			toolSpan.setStatus(SpanStatusCode.OK);
			toolSpan.end();

			const chat2 = otel.startSpan('chat gpt-4o', {
				kind: SpanKind.CLIENT,
				attributes: {
					[GenAiAttr.OPERATION_NAME]: GenAiOperationName.CHAT,
					[GenAiAttr.REQUEST_MODEL]: 'gpt-4o',
				},
			});
			chat2.setStatus(SpanStatusCode.OK);
			chat2.end();

			agentSpan.setStatus(SpanStatusCode.OK);
		});

		expect(otel.spans).toHaveLength(4);

		const agentSpan = otel.spans[0];
		expect(agentSpan.name).toBe('invoke_agent dardcor');
		expect(agentSpan.kind).toBe(SpanKind.INTERNAL);
		expect(agentSpan.attributes[GenAiAttr.OPERATION_NAME]).toBe('invoke_agent');
		expect(agentSpan.attributes[GenAiAttr.AGENT_NAME]).toBe('dardcor');
		expect(agentSpan.statusCode).toBe(SpanStatusCode.OK);
		expect(agentSpan.ended).toBe(true);

		const chatSpan = otel.spans[1];
		expect(chatSpan.name).toBe('chat gpt-4o');
		expect(chatSpan.kind).toBe(SpanKind.CLIENT);
		expect(chatSpan.attributes[GenAiAttr.USAGE_INPUT_TOKENS]).toBe(1500);
		expect(chatSpan.attributes[GenAiAttr.RESPONSE_MODEL]).toBe('gpt-4o-2024-08-06');

		const toolSpan = otel.spans[2];
		expect(toolSpan.name).toBe('execute_tool readFile');
		expect(toolSpan.kind).toBe(SpanKind.INTERNAL);
		expect(toolSpan.attributes[GenAiAttr.TOOL_NAME]).toBe('readFile');

		expect(otel.spans[3].name).toBe('chat gpt-4o');
	});

	it('emits session start event and agent metrics', async () => {
		const otel = new CapturingOTelService();

		emitSessionStartEvent(otel, 'sess-abc', 'gpt-4o', 'dardcor');
		GenAiMetrics.incrementSessionCount(otel);
		GenAiMetrics.recordAgentDuration(otel, 'dardcor', 15.2);
		GenAiMetrics.recordAgentTurnCount(otel, 'dardcor', 4);
		emitAgentTurnEvent(otel, 0, 1500, 250, 2);

		expect(otel.logRecords).toHaveLength(2);
		expect(otel.logRecords[0].attributes?.['event.name']).toBe('dardcor_chat.session.start');

		expect(otel.logRecords[1].attributes?.['event.name']).toBe('dardcor_chat.agent.turn');
		expect(otel.logRecords[1].attributes?.['turn.index']).toBe(0);

		expect(otel.counters).toHaveLength(1);
		expect(otel.counters[0].name).toBe('dardcor_chat.session.count');
		expect(otel.metrics).toHaveLength(2);
		expect(otel.metrics[0].name).toBe('dardcor_chat.agent.invocation.duration');
		expect(otel.metrics[1].name).toBe('dardcor_chat.agent.turn.count');
	});

	it('propagates trace context for subagent via store/retrieve', () => {
		const otel = new CapturingOTelService();
		const parentCtx = { traceId: 'aaaa0000bbbb1111cccc2222dddd3333', spanId: 'eeee4444ffff5555' };

		otel.storeTraceContext('subagent:req-123', parentCtx);

		const restored = otel.getStoredTraceContext('subagent:req-123');
		expect(restored).toEqual(parentCtx);

		otel.startSpan('invoke_agent Explore', {
			kind: SpanKind.INTERNAL,
			attributes: { [GenAiAttr.OPERATION_NAME]: GenAiOperationName.INVOKE_AGENT },
			parentTraceContext: restored,
		});

		const subagentSpan = otel.spans[0];
		expect(subagentSpan.name).toBe('invoke_agent Explore');
		expect(subagentSpan.parentTraceContext).toEqual(parentCtx);

		expect(otel.getStoredTraceContext('subagent:req-123')).toBeUndefined();
	});

	it('records error status on failed spans', async () => {
		const otel = new CapturingOTelService();

		await otel.startActiveSpan('chat gpt-4o', { kind: SpanKind.CLIENT, attributes: {} }, async (span) => {
			span.setStatus(SpanStatusCode.ERROR, 'timeout');
			span.setAttribute('error.type', 'TimeoutError');
			span.recordException(new Error('Request timed out'));
		});

		const span = otel.spans[0];
		expect(span.statusCode).toBe(SpanStatusCode.ERROR);
		expect(span.statusMessage).toBe('timeout');
		expect(span.attributes['error.type']).toBe('TimeoutError');
		expect(span.exceptions).toHaveLength(1);
		expect(span.ended).toBe(true);
	});

	it('records tool call metrics and events correctly', () => {
		const otel = new CapturingOTelService();

		GenAiMetrics.recordToolCallCount(otel, 'readFile', true);
		GenAiMetrics.recordToolCallDuration(otel, 'readFile', 50);
		GenAiMetrics.recordToolCallCount(otel, 'runCommand', false);
		GenAiMetrics.recordToolCallDuration(otel, 'runCommand', 5000);

		expect(otel.counters).toHaveLength(2);
		expect(otel.counters[0].attributes?.[GenAiAttr.TOOL_NAME]).toBe('readFile');
		expect(otel.counters[0].attributes?.success).toBe(true);
		expect(otel.counters[1].attributes?.success).toBe(false);

		expect(otel.metrics).toHaveLength(2);
		expect(otel.metrics[0].value).toBe(50);
		expect(otel.metrics[1].value).toBe(5000);
	});

	it('records chat operation duration and token usage metrics', () => {
		const otel = new CapturingOTelService();

		GenAiMetrics.recordOperationDuration(otel, 3.5, {
			operationName: GenAiOperationName.CHAT,
			providerName: GenAiProviderName.GITHUB,
			requestModel: 'gpt-4o',
		});
		GenAiMetrics.recordTokenUsage(otel, 1500, 'input', {
			operationName: GenAiOperationName.CHAT,
			providerName: GenAiProviderName.GITHUB,
			requestModel: 'gpt-4o',
		});
		GenAiMetrics.recordTokenUsage(otel, 250, 'output', {
			operationName: GenAiOperationName.CHAT,
			providerName: GenAiProviderName.GITHUB,
			requestModel: 'gpt-4o',
		});

		expect(otel.metrics).toHaveLength(3);
		expect(otel.metrics[0].name).toBe('gen_ai.client.operation.duration');
		expect(otel.metrics[0].value).toBe(3.5);
		expect(otel.metrics[1].name).toBe('gen_ai.client.token.usage');
		expect(otel.metrics[1].value).toBe(1500);
		expect(otel.metrics[2].name).toBe('gen_ai.client.token.usage');
		expect(otel.metrics[2].value).toBe(250);
	});

	it('records edit acceptance and survival metrics', () => {
		const otel = new CapturingOTelService();

		GenAiMetrics.recordEditAcceptance(otel, 'inline_chat', 'accepted', 'typescript');
		GenAiMetrics.recordEditAcceptance(otel, 'chat_editing_hunk', 'rejected', 'python');
		GenAiMetrics.recordEditSurvivalFourGram(otel, 'inline_chat', 0.85, 30000);
		GenAiMetrics.recordEditSurvivalNoRevert(otel, 'inline_chat', 0.92, 30000);
		GenAiMetrics.recordChatEditOutcome(otel, 'chat_editing', 'accepted', 'typescript', false);

		expect(otel.counters).toHaveLength(3);
		expect(otel.counters[0].name).toBe('dardcor_chat.edit.acceptance.count');
		expect(otel.counters[0].attributes?.[DardcorChatAttr.EDIT_SOURCE]).toBe('inline_chat');
		expect(otel.counters[0].attributes?.[DardcorChatAttr.EDIT_OUTCOME]).toBe('accepted');
		expect(otel.counters[0].attributes?.[DardcorChatAttr.LANGUAGE_ID]).toBe('typescript');

		expect(otel.counters[1].name).toBe('dardcor_chat.edit.acceptance.count');
		expect(otel.counters[1].attributes?.[DardcorChatAttr.EDIT_OUTCOME]).toBe('rejected');

		expect(otel.counters[2].name).toBe('dardcor_chat.chat_edit.outcome.count');
		expect(otel.counters[2].attributes?.[DardcorChatAttr.EDIT_SOURCE]).toBe('chat_editing');
		expect(otel.counters[2].attributes?.[DardcorChatAttr.EDIT_OUTCOME]).toBe('accepted');
		expect(otel.counters[2].attributes?.[DardcorChatAttr.HAS_REMAINING_EDITS]).toBe(false);

		expect(otel.metrics).toHaveLength(2);
		expect(otel.metrics[0].name).toBe('dardcor_chat.edit.survival.four_gram');
		expect(otel.metrics[0].value).toBe(0.85);
		expect(otel.metrics[0].attributes?.[DardcorChatAttr.EDIT_SOURCE]).toBe('inline_chat');
		expect(otel.metrics[0].attributes?.[DardcorChatAttr.TIME_DELAY_MS]).toBe(30000);

		expect(otel.metrics[1].name).toBe('dardcor_chat.edit.survival.no_revert');
		expect(otel.metrics[1].value).toBe(0.92);
	});

	it('omits optional attributes when undefined', () => {
		const otel = new CapturingOTelService();

		GenAiMetrics.recordEditAcceptance(otel, 'inline_chat', 'accepted', undefined);
		GenAiMetrics.recordChatEditOutcome(otel, 'chat_editing', 'rejected', undefined, undefined);

		expect(otel.counters[0].attributes?.[DardcorChatAttr.LANGUAGE_ID]).toBeUndefined();
		expect(otel.counters[1].attributes?.[DardcorChatAttr.LANGUAGE_ID]).toBeUndefined();
		expect(otel.counters[1].attributes?.[DardcorChatAttr.HAS_REMAINING_EDITS]).toBeUndefined();
	});
});
