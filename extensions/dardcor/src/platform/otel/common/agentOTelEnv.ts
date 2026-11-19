/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { OTelConfig } from './otelConfig';

export function deriveCopilotCliOTelEnv(config: OTelConfig, env: Record<string, string | undefined> = process.env): Record<string, string> {
	if (!config.enabled || !config.enabledExplicitly) {
		return {};
	}

	const result: Record<string, string> = {};

	if (!env['DARDCOR_OTEL_ENABLED']) {
		result['DARDCOR_OTEL_ENABLED'] = 'true';
	}
	if (!env['OTEL_EXPORTER_OTLP_ENDPOINT'] && config.otlpEndpoint) {
		result['OTEL_EXPORTER_OTLP_ENDPOINT'] = config.otlpEndpoint;
	}
	if (!env['OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'] && config.captureContent) {
		result['OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'] = 'true';
	}
	if (!env['DARDCOR_OTEL_FILE_EXPORTER_PATH'] && config.fileExporterPath) {
		result['DARDCOR_OTEL_FILE_EXPORTER_PATH'] = config.fileExporterPath;
	}
	if (!env['DARDCOR_OTEL_EXPORTER_TYPE'] && config.exporterType === 'file') {
		result['DARDCOR_OTEL_EXPORTER_TYPE'] = 'file';
	}

	return result;
}

export function deriveClaudeOTelEnv(config: OTelConfig, env: Record<string, string | undefined> = process.env): Record<string, string> {
	if (!config.enabled || !config.enabledExplicitly) {
		return {};
	}

	const result: Record<string, string> = {};

	if (!env['CLAUDE_CODE_ENABLE_TELEMETRY']) {
		result['CLAUDE_CODE_ENABLE_TELEMETRY'] = '1';
	}
	if (!env['OTEL_METRICS_EXPORTER']) {
		result['OTEL_METRICS_EXPORTER'] = 'otlp';
	}
	if (!env['OTEL_LOGS_EXPORTER']) {
		result['OTEL_LOGS_EXPORTER'] = 'otlp';
	}
	if (!env['OTEL_EXPORTER_OTLP_ENDPOINT'] && config.otlpEndpoint) {
		result['OTEL_EXPORTER_OTLP_ENDPOINT'] = config.otlpEndpoint;
	}
	if (!env['OTEL_EXPORTER_OTLP_PROTOCOL']) {
		result['OTEL_EXPORTER_OTLP_PROTOCOL'] = config.otlpProtocol;
	}
	if (config.captureContent) {
		if (!env['OTEL_LOG_USER_PROMPTS']) {
			result['OTEL_LOG_USER_PROMPTS'] = '1';
		}
		if (!env['OTEL_LOG_TOOL_DETAILS']) {
			result['OTEL_LOG_TOOL_DETAILS'] = '1';
		}
	}

	return result;
}
