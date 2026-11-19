/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpSdkServerConfigWithInstance, McpServerConfig, OnElicitation, Options, PreToolUseHookInput, Settings, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { tmpdir } from 'os';
import { delimiter, dirname, normalize } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { rgDiskPath } from '../../../../base/node/ripgrep.js';
import { AiAgentEnvValue, AiAgentEnvVar } from '../../../chat/common/aiAgentEnv.js';
import { ClaudePermissionMode } from '../../common/claudeSessionConfigKeys.js';
import { resolveClaudeEffort } from '../../common/claudeModelConfig.js';
import { PendingRequestRegistry } from '../../common/pendingRequestRegistry.js';
import type { ModelSelection } from '../../common/state/protocol/state.js';
import { IClaudeAgentSdkService } from './claudeAgentSdkService.js';
import { buildClientToolMcpServer } from './clientTools/claudeClientToolMcpServer.js';
import { toClaudeSdkModelId } from './claudeModelSelection.js';
import type { IAgentHostNativeOTelConfig, IAgentHostTraceContext } from '../../common/otel/agentHostOTelService.js';
import type { ClaudeTransport } from './claudeProxyService.js';
import { SessionClientToolsDiff } from './clientTools/claudeSessionClientToolsModel.js';
import { McpServerType } from '../../../mcp/common/mcpPlatformTypes.js';
import type { IMcpServerDefinition } from '../../../agentPlugins/common/pluginParsers.js';
import { isEqual } from '../../../../base/common/resources.js';
import { resolveMcpServerWorkingDirectory } from '../shared/mcpServerWorkingDirectory.js';

type ClaudeSdkDeniedMcpServerSpec = NonNullable<Settings['deniedMcpServers']>[number];

export type ClaudeDeniedMcpServerSpec =
	| { readonly serverName: string; readonly serverCommand?: never; readonly serverUrl?: never }
	| { readonly serverName?: never; readonly serverCommand: NonNullable<ClaudeSdkDeniedMcpServerSpec['serverCommand']>; readonly serverUrl?: never }
	| { readonly serverName?: never; readonly serverCommand?: never; readonly serverUrl: string };

export interface IBuildOptionsInput {
	readonly sessionId: string;
	readonly workingDirectory: URI;
	readonly additionalDirectories?: readonly URI[];
	readonly model: ModelSelection | undefined;
	readonly abortController: AbortController;
	readonly permissionMode: ClaudePermissionMode;
	readonly canUseTool: NonNullable<Options['canUseTool']>;
	readonly onElicitation: OnElicitation;
	readonly onPreToolUse?: (toolName: string, input: unknown) => SyncHookJSONOutput | undefined;
	readonly isResume: boolean;
	readonly resumeSessionAt?: string;
	readonly mcpServers: Record<string, McpServerConfig> | undefined;
	readonly deniedMcpServers?: readonly ClaudeDeniedMcpServerSpec[];
	readonly allowedTools?: readonly string[];
	readonly plugins?: readonly { readonly uri: URI; readonly skipMcpDiscovery: boolean }[];
	readonly agent?: string;
	readonly telemetry?: IAgentHostNativeOTelConfig;
	readonly traceContext?: IAgentHostTraceContext;
	readonly getUserPromptAdditionalContext?: () => string | undefined;
}

export async function buildOptions(
	input: IBuildOptionsInput,
	transport: ClaudeTransport,
	logStderr: (data: string) => void,
): Promise<Options> {
	const isProxy = transport.kind === 'proxy';
	const subprocessEnv = buildSubprocessEnv(isProxy);
	const telemetryEnv = buildClaudeTelemetryEnv(input.telemetry, input.traceContext);
	Object.assign(subprocessEnv, telemetryEnv);
	const resolvedRgDiskPath = await rgDiskPath();
	const settingsEnv: Record<string, string> = {
		...telemetryEnv,
		...(transport.kind === 'proxy'
			? {
				ANTHROPIC_BASE_URL: transport.handle.baseUrl,
				ANTHROPIC_AUTH_TOKEN: `${transport.handle.nonce}.${input.sessionId}`,
			}
			: {}),
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
		USE_BUILTIN_RIPGREP: '0',
		[AiAgentEnvVar]: AiAgentEnvValue,
		PATH: `${dirname(resolvedRgDiskPath)}${delimiter}${process.env.PATH ?? ''}`,
	};
	const hooks: NonNullable<Options['hooks']> = {};
	if (input.onPreToolUse) {
		hooks.PreToolUse = [{
			hooks: [async hookInput => {
				const preToolUse = hookInput as PreToolUseHookInput;
				return input.onPreToolUse?.(preToolUse.tool_name, preToolUse.tool_input) ?? {};
			}],
		}];
	}
	if (input.getUserPromptAdditionalContext) {
		hooks.UserPromptSubmit = [{
			hooks: [async () => ({
				hookSpecificOutput: {
					hookEventName: 'UserPromptSubmit' as const,
					additionalContext: input.getUserPromptAdditionalContext?.(),
				},
			})],
		}];
	}

	return {
		cwd: input.workingDirectory.fsPath,
		...(input.additionalDirectories && input.additionalDirectories.length > 0
			? { additionalDirectories: input.additionalDirectories.map(d => d.fsPath) }
			: {}),
		executable: process.execPath as 'node',
		env: subprocessEnv,
		abortController: input.abortController,
		allowDangerouslySkipPermissions: true,
		canUseTool: input.canUseTool,
		onElicitation: input.onElicitation,
		disallowedTools: ['WebSearch'],
		includePartialMessages: true,
		forwardSubagentText: true,
		enableFileCheckpointing: true,
		model: toClaudeSdkModelId(input.model),
		effort: resolveClaudeEffort(input.model),
		permissionMode: input.permissionMode,
		...(input.isResume
			? { resume: input.sessionId, ...(input.resumeSessionAt ? { resumeSessionAt: input.resumeSessionAt } : {}) }
			: { sessionId: input.sessionId }),
		...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
		...(input.allowedTools && input.allowedTools.length > 0 ? { allowedTools: [...input.allowedTools] } : {}),
		...(input.plugins && input.plugins.length > 0
			? { plugins: input.plugins.map(plugin => ({ type: 'local' as const, path: plugin.uri.fsPath, skipMcpDiscovery: plugin.skipMcpDiscovery })) }
			: {}),
		...(input.agent ? { agent: input.agent } : {}),
		settingSources: ['user', 'project', 'local'],
		settings: {
			env: settingsEnv,
			...(input.deniedMcpServers?.length
				? { deniedMcpServers: [...input.deniedMcpServers] }
				: {}),
		},
		systemPrompt: { type: 'preset', preset: 'claude_code' },
		...(Object.keys(hooks).length > 0 ? { hooks } : {}),
		stderr: logStderr,
	};
}

export async function buildClientMcpServers(
	toolDiff: SessionClientToolsDiff,
	registry: PendingRequestRegistry<CallToolResult>,
	sdkService: IClaudeAgentSdkService,
): Promise<Record<string, McpSdkServerConfigWithInstance> | undefined> {
	const tools = toolDiff.consume();
	if (tools.length === 0) {
		return undefined;
	}
	const server = await buildClientToolMcpServer(tools, id => registry.register(id), sdkService);
	return { client: server };
}

export function toClaudeMcpServers(
	definitions: readonly IMcpServerDefinition[],
	primaryCwd: URI,
): { readonly servers: Record<string, McpServerConfig>; readonly skipped: readonly string[] } {
	const servers: Record<string, McpServerConfig> = {};
	const skipped: string[] = [];
	for (const definition of definitions) {
		const config = definition.configuration;
		if (config.type === McpServerType.REMOTE) {
			servers[definition.name] = {
				type: config.transport === 'sse' ? 'sse' : 'http',
				url: config.url,
				...(config.headers ? { headers: { ...config.headers } } : {}),
			};
			continue;
		}

		const effectiveCwd = resolveMcpServerWorkingDirectory(config.cwd, definition.defaultCwd ?? primaryCwd);
		const hasRepresentableCwd = effectiveCwd !== undefined && isEqual(URI.file(normalize(effectiveCwd)), URI.file(normalize(primaryCwd.fsPath)));
		if (!hasRepresentableCwd) {
			skipped.push(definition.name);
			continue;
		}
		servers[definition.name] = {
			type: 'stdio',
			command: config.command,
			...(config.args ? { args: [...config.args] } : {}),
			...(config.env ? {
				env: Object.fromEntries(Object.entries(config.env)
					.filter((entry): entry is [string, string | number] => entry[1] !== null)
					.map(([key, value]) => [key, String(value)]))
			} : {}),
		};
	}
	return { servers, skipped };
}

export function buildModelEnumerationOptions(): Options {
	return {
		cwd: tmpdir(),
		executable: process.execPath as 'node',
		env: buildSubprocessEnv(false),
		abortController: new AbortController(),
		systemPrompt: { type: 'preset', preset: 'claude_code' },
		settings: {
			env: {
				CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
			},
		},
	};
}

export function buildClaudeTelemetryEnv(config: IAgentHostNativeOTelConfig | undefined, traceContext?: IAgentHostTraceContext): Record<string, string> {
	if (!config) {
		return {};
	}
	const env: Record<string, string> = {
		CLAUDE_CODE_ENABLE_TELEMETRY: '1',
		OTEL_SERVICE_NAME: 'claude-code',
		OTEL_RESOURCE_ATTRIBUTES: serializeResourceAttributes(config.resourceAttributes),
		CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: config.traces ? '1' : '0',
		OTEL_TRACES_EXPORTER: config.traces ? 'otlp' : 'none',
		OTEL_LOGS_EXPORTER: config.external ? 'otlp' : 'none',
		OTEL_METRICS_EXPORTER: config.external ? 'otlp' : 'none',
		OTEL_LOG_USER_PROMPTS: config.captureContent ? '1' : '0',
		OTEL_LOG_ASSISTANT_RESPONSES: config.captureContent ? '1' : '0',
		OTEL_LOG_TOOL_DETAILS: config.captureContent ? '1' : '0',
		OTEL_LOG_TOOL_CONTENT: config.captureContent ? '1' : '0',
	};
	if (config.traces) {
		env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = config.traces.endpoint;
		env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = config.traces.protocol;
	}
	if (config.external) {
		env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = resolveSignalEndpoint(config.external.endpoint, 'logs', config.external.protocol);
		env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = config.external.protocol;
		env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = resolveSignalEndpoint(config.external.endpoint, 'metrics', config.external.protocol);
		env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL = config.external.protocol;
		if (config.external.headers && Object.keys(config.external.headers).length > 0) {
			env.OTEL_EXPORTER_OTLP_HEADERS = Object.entries(config.external.headers).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join(',');
		}
	}
	if (traceContext) {
		env.TRACEPARENT = traceContext.traceparent;
		if (traceContext.tracestate) {
			env.TRACESTATE = traceContext.tracestate;
		}
	}
	return env;
}

function serializeResourceAttributes(attributes: Readonly<Record<string, string>>): string {
	return Object.entries(attributes).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join(',');
}

function resolveSignalEndpoint(endpoint: string, signal: 'logs' | 'metrics', protocol: 'http/json' | 'http/protobuf' | 'grpc'): string {
	if (protocol === 'grpc') {
		return endpoint;
	}
	try {
		const url = new URL(endpoint);
		if (url.pathname === '' || url.pathname === '/') {
			url.pathname = `/v1/${signal}`;
		} else if (url.pathname.endsWith('/v1/traces')) {
			url.pathname = `${url.pathname.slice(0, -'/v1/traces'.length)}/v1/${signal}`;
		}
		return url.toString().replace(/\/$/, '');
	} catch {
		return endpoint;
	}
}

export function buildSubprocessEnv(proxied: boolean = true): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = proxied
		? {
			ELECTRON_RUN_AS_NODE: '1',
			NODE_OPTIONS: undefined,
			ANTHROPIC_API_KEY: undefined,
			HOME: process.env['HOME'],
			USERPROFILE: process.env['USERPROFILE'],
			CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1'
		}
		: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: undefined };
	env[AiAgentEnvVar] = AiAgentEnvValue;
	for (const key of Object.keys(process.env)) {
		if (key === 'ELECTRON_RUN_AS_NODE') { continue; }
		if (key.startsWith('VSCODE_') || key.startsWith('ELECTRON_')) {
			env[key] = undefined;
		}
	}
	return env;
}
