/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../log/common/log.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import type { IAgentHostCopilotSkuClassification, IAgentHostCopilotSkuTelemetry } from './agentHostTelemetryReporter.js';
import type { IAgentSdkDownloadProgress } from './agentSdkDownloader.js';


export type AgentSdkDownloadFailureReason =
	| 'cancelled'
	| 'network'
	| 'filesystem'
	| 'extract'
	| 'notConfigured'
	| 'unsupportedTarget'
	| 'unknown';

const FAILURE_HINTS: readonly (readonly [AgentSdkDownloadFailureReason, readonly string[]])[] = [
	['notConfigured', ['no `product.agentSdks', 'unknown placeholder']],
	['unsupportedTarget', ['no SDK target for this host']],
	['filesystem', ['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EBUSY', 'EMFILE', 'ENAMETOOLONG', 'EXDEV']],
	['network', ['HTTP ', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPROTO', 'ECONNABORTED', 'socket hang up', 'certificate', 'tunneling socket', 'getaddrinfo']],
	['extract', ['TAR_', 'zlib', 'gzip', 'unexpected end of file', 'incorrect header check', 'invalid entry']],
];

export function classifyAgentSdkDownloadFailure(error: string | undefined): AgentSdkDownloadFailureReason {
	if (!error) {
		return 'unknown';
	}
	if (error === 'cancelled') {
		return 'cancelled';
	}
	const haystack = error.toLowerCase();
	for (const [reason, hints] of FAILURE_HINTS) {
		if (hints.some(hint => haystack.includes(hint.toLowerCase()))) {
			return reason;
		}
	}
	return 'unknown';
}



interface IAgentSdkDownloadEvent extends IAgentHostCopilotSkuTelemetry {
	packageId: string;
	phase: string;
	failureReason: string;
	explicitlyRequested: boolean;
	durationMs: number;
	receivedBytes: number;
	totalBytes: number;
}

type AgentSdkDownloadClassification = IAgentHostCopilotSkuClassification & {
	packageId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Which agent SDK was being fetched, e.g. claude or codex.' };
	phase: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the download started, completed, or failed.' };
	failureReason: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Coarse bucket for a failed download (cancelled, network, filesystem, extract, notConfigured, unsupportedTarget, unknown). Empty unless the phase is failed.' };
	explicitlyRequested: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the user explicitly requested this download through the setup UI, rather than it starting from an agent turn or standing consent.' };
	durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'How long the download had been running when it reached this phase.' };
	receivedBytes: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Bytes fetched by the time this phase was reached.' };
	totalBytes: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Total size the server advertised, or zero when it did not.' };
	owner: 'TylerLeonhardt';
	comment: 'The middle of the agent SDK setup funnel: whether an offered download is actually attempted, and whether it works.';
};

export function reportAgentSdkDownload(
	telemetryService: ITelemetryService,
	logService: ILogService,
	progress: IAgentSdkDownloadProgress,
	durationMs: number,
): void {
	const failureReason = progress.phase === 'failed' ? classifyAgentSdkDownloadFailure(progress.error) : '';
	telemetryService.publicLog2<IAgentSdkDownloadEvent, AgentSdkDownloadClassification>('agentHost.agentSdkDownload', {
		packageId: progress.packageId,
		phase: progress.phase,
		failureReason,
		explicitlyRequested: progress.explicitlyRequested,
		durationMs,
		receivedBytes: progress.receivedBytes,
		totalBytes: progress.totalBytes ?? 0,
	});
	logService.info(
		`[AgentSdkDownloader] ${progress.packageId}: ${progress.phase}`
		+ ` (explicit=${progress.explicitlyRequested}, bytes=${progress.receivedBytes}/${progress.totalBytes ?? 'unknown'}, ms=${durationMs}`
		+ `${failureReason ? `, reason=${failureReason}` : ''})`,
	);
}

