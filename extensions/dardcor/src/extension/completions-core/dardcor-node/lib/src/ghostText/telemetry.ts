/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ServicesAccessor } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { ICompletionsLogTargetService, Logger } from '../logger';
import { PromptResponse } from '../prompt/prompt';
import { now, telemetry, TelemetryData, telemetryRaw, TelemetryWithExp } from '../telemetry';
import { DardcorCompletion } from './dardcorCompletion';
import { ResultType } from './resultType';
import { ICompletionsSpeculativeRequestCache } from './speculativeRequestCache';

export type PostInsertionCategory = 'ghostText' | 'solution';

export const GHOST_TEXT_CATEGORY: PostInsertionCategory = 'ghostText';

export const logger = new Logger('getCompletions');

export function telemetryShown(accessor: ServicesAccessor, completion: DardcorCompletion) {
	const speculativeRequestCache = accessor.get(ICompletionsSpeculativeRequestCache);
	void speculativeRequestCache.request(completion.clientCompletionId);
	completion.telemetry.markAsDisplayed();
	completion.telemetry.properties.reason = resultTypeToString(completion.resultType);
	telemetry(accessor, `ghostText.shown`, completion.telemetry);
}

export function telemetryAccepted(
	accessor: ServicesAccessor,
	insertionCategory: PostInsertionCategory,
	telemetryData: TelemetryData
) {
	const telemetryName = insertionCategory + '.accepted';

	telemetry(accessor, telemetryName, telemetryData);
}

export function telemetryRejected(
	accessor: ServicesAccessor,
	insertionCategory: PostInsertionCategory,
	telemetryData: TelemetryData
) {
	const telemetryName = insertionCategory + '.rejected';

	telemetry(accessor, telemetryName, telemetryData);
}

type BasicResultTelemetry = {
	headerRequestId: string;
	dardcor_trackingId: string;
	opportunityId?: string;
	sku?: string;
	organizations_list?: string;
	enterprise_list?: string;
	clientCompletionId?: string;
};

type CanceledResultTelemetry = {
	telemetryBlob: TelemetryData;
	cancelledNetworkRequest?: boolean;
};

export type GhostTextResultWithTelemetry<T> =
	| {
		type: 'success';
		value: T;
		telemetryData: BasicResultTelemetry;
		telemetryBlob: TelemetryWithExp;
		resultType: ResultType;
		performanceMetrics?: [string, number][];
	}
	| { type: 'abortedBeforeIssued'; reason: string; telemetryData: BasicResultTelemetry }
	| { type: 'canceled'; reason: string; telemetryData: CanceledResultTelemetry }
	| { type: 'empty'; reason: string; telemetryData: BasicResultTelemetry }
	| { type: 'failed'; reason: string; telemetryData: BasicResultTelemetry }
	| { type: 'promptOnly'; reason: string; prompt: PromptResponse };

export function mkCanceledResultTelemetry(
	telemetryBlob: TelemetryData,
	extraFlags: { cancelledNetworkRequest?: boolean } = {}
): CanceledResultTelemetry {
	return {
		...extraFlags,
		telemetryBlob,
	};
}

export function mkBasicResultTelemetry(
	telemetryBlob: TelemetryWithExp,
): BasicResultTelemetry {
	const result: BasicResultTelemetry = {
		headerRequestId: telemetryBlob.properties['headerRequestId'],
		dardcor_trackingId: telemetryBlob.properties['dardcor_trackingId'],
	};
	if (telemetryBlob.properties['sku'] !== undefined) {
		result.sku = telemetryBlob.properties['sku'];
	}
	if (telemetryBlob.properties['opportunityId'] !== undefined) {
		result.opportunityId = telemetryBlob.properties['opportunityId'];
	}
	if (telemetryBlob.properties['organizations_list'] !== undefined) {
		result.organizations_list = telemetryBlob.properties['organizations_list'];
	}
	if (telemetryBlob.properties['enterprise_list'] !== undefined) {
		result.enterprise_list = telemetryBlob.properties['enterprise_list'];
	}
	if (telemetryBlob.properties['clientCompletionId'] !== undefined) {
		result.clientCompletionId = telemetryBlob.properties['clientCompletionId'];
	}

	return result;
}

export function handleGhostTextResultTelemetry<T>(
	accessor: ServicesAccessor,
	result: GhostTextResultWithTelemetry<T>
): T | undefined {
	const logTarget = accessor.get(ICompletionsLogTargetService);
	if (result.type === 'promptOnly') { return; }

	if (result.type === 'success') {
		const timeToProduceMs = now() - result.telemetryBlob.issuedTime;
		const reason = resultTypeToString(result.resultType);
		const performanceMetrics = JSON.stringify(result.performanceMetrics);
		const properties = { ...result.telemetryData, reason, performanceMetrics };
		const { foundOffset } = result.telemetryBlob.measurements;
		const perf = result.performanceMetrics?.map(([key, dur]) => `\n${dur.toFixed(2)}\t${key}`).join('') ?? '';
		logger.debug(
			logTarget,
			`ghostText produced from ${reason} in ${Math.round(timeToProduceMs)}ms with foundOffset ${foundOffset}${perf}`
		);
		telemetryRaw(accessor, 'ghostText.produced', properties, { timeToProduceMs, foundOffset });
		return result.value;
	}

	logger.debug(logTarget, 'No ghostText produced -- ' + result.type + ': ' + result.reason);
	if (result.type === 'canceled') {
		telemetry(
			accessor,
			`ghostText.canceled`,
			result.telemetryData.telemetryBlob.extendedBy({
				reason: result.reason,
				cancelledNetworkRequest: result.telemetryData.cancelledNetworkRequest ? 'true' : 'false',
			})
		);
		return;
	}
	telemetryRaw(accessor, `ghostText.${result.type}`, { ...result.telemetryData, reason: result.reason }, {});
}

export function resultTypeToString(resultType: ResultType): string {
	switch (resultType) {
		case ResultType.Network:
			return 'network';
		case ResultType.Cache:
			return 'cache';
		case ResultType.Cycling:
			return 'cycling';
		case ResultType.TypingAsSuggested:
			return 'typingAsSuggested';
		case ResultType.Async:
			return 'async';
	}
}
