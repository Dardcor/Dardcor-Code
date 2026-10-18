/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { structuralEquals } from '../../../base/common/equals.js';
import { ConfigurationTarget, type IConfigurationService, type IConfigurationValue } from '../../configuration/common/configuration.js';
import { ChatExternalSessionsMode, DEFAULT_EDIT_AUTO_APPROVE_PATTERNS, type ChatEditAutoApprovePatterns } from '../../chat/common/chatSettings.js';
import type { IMcpServerConfiguration } from '../../mcp/common/mcpPlatformTypes.js';
import { TelemetryConfiguration, TelemetryLevel } from '../../telemetry/common/telemetry.js';
import { telemetryLevelToAgentHostValue } from './agentHostTelemetry.js';
import { SessionConfigKey } from './sessionConfigKeys.js';
import type { IShellInitScript } from './shellInitScript.js';
import type { SessionConfigPropertySchema, SessionConfigSchema } from './state/protocol/commands.js';
import { JsonRpcErrorCodes, ProtocolError } from './state/sessionProtocol.js';


export interface ISchemaProperty<T> {
	readonly protocol: SessionConfigPropertySchema;
	validate(value: unknown): value is T;
	assertValid(value: unknown, path?: string): asserts value is T;
}

export function schemaProperty<T>(protocol: SessionConfigPropertySchema): ISchemaProperty<T> {
	const assertFn = buildAssert(protocol);
	const assertValid = (value: unknown, path: string = ''): asserts value is T => assertFn(value, path);
	const validate = (value: unknown): value is T => {
		try {
			assertFn(value, '');
			return true;
		} catch {
			return false;
		}
	};
	return { protocol, validate, assertValid };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchemaDefinition = Record<string, ISchemaProperty<any>>;

export type SchemaValue<P> = P extends ISchemaProperty<infer T> ? T : never;

export type SchemaValues<D extends SchemaDefinition> = {
	[K in keyof D]?: SchemaValue<D[K]>;
};

export interface ISchema<D extends SchemaDefinition> {
	readonly definition: D;
	toProtocol(): SessionConfigSchema;
	values(values: SchemaValues<D>): Record<string, unknown>;
	validate<K extends keyof D & string>(key: K, value: unknown): value is SchemaValue<D[K]>;
	assertValid<K extends keyof D & string>(key: K, value: unknown): asserts value is SchemaValue<D[K]>;
	validateOrDefault<T extends Partial<{ [K in keyof D]: SchemaValue<D[K]> }>>(values: { [K in keyof T]?: unknown } | undefined, defaults: T): T;
}

export function createSchema<D extends SchemaDefinition>(definition: D): ISchema<D> {
	return {
		definition,
		toProtocol(): SessionConfigSchema {
			const properties: Record<string, SessionConfigPropertySchema> = {};
			for (const key of Object.keys(definition)) {
				properties[key] = definition[key].protocol;
			}
			return { type: 'object', properties };
		},
		values(values) {
			const raw = values as Record<string, unknown>;
			for (const key of Object.keys(definition)) {
				const value = raw[key];
				if (value === undefined) {
					continue;
				}
				const prop: ISchemaProperty<unknown> = definition[key];
				prop.assertValid(value, key);
			}
			return { ...raw };
		},
		validate<K extends keyof D & string>(key: K, value: unknown): value is SchemaValue<D[K]> {
			const prop = definition[key];
			return prop ? prop.validate(value) : false;
		},
		assertValid<K extends keyof D & string>(key: K, value: unknown): asserts value is SchemaValue<D[K]> {
			const prop: ISchemaProperty<unknown> | undefined = definition[key];
			if (!prop) {
				throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Unknown schema key '${key}'`);
			}
			const narrowed: ISchemaProperty<unknown> = prop;
			narrowed.assertValid(value, key);
		},
		validateOrDefault<T extends Partial<{ [K in keyof D]: SchemaValue<D[K]> }>>(values: { [K in keyof T]?: unknown } | undefined, defaults: T): T {
			const result: Record<string, unknown> = {};
			const raw: { [K in keyof T]?: unknown } = values ?? {};
			for (const key of Object.keys(definition)) {
				const prop = definition[key];
				const candidate = raw[key];
				if (candidate !== undefined && prop.validate(candidate)) {
					result[key] = candidate;
				} else if (Object.prototype.hasOwnProperty.call(defaults, key)) {
					result[key] = (defaults as Record<string, unknown>)[key];
				}
			}
			return result as T;
		},
	};
}


type AssertValidator = (value: unknown, path: string) => void;

function buildAssert(schema: SessionConfigPropertySchema): AssertValidator {
	if (schema.type === 'object' && schema.properties) {
		const propAsserts: Record<string, AssertValidator> = {};
		for (const key of Object.keys(schema.properties)) {
			propAsserts[key] = buildAssert(schema.properties[key] as SessionConfigPropertySchema);
		}
		const required = new Set(schema.required ?? []);
		return (value, path) => {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				throw invalidParams(path, 'object', value);
			}
			const obj = value as Record<string, unknown>;
			for (const key of Object.keys(propAsserts)) {
				const childPath = joinPath(path, key);
				if (obj[key] === undefined) {
					if (required.has(key)) {
						throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Missing required property at '${childPath}'`);
					}
					continue;
				}
				propAsserts[key](obj[key], childPath);
			}
		};
	}
	if (schema.type === 'array' && schema.items) {
		const itemAssert = buildAssert(schema.items as SessionConfigPropertySchema);
		return (value, path) => {
			if (!Array.isArray(value)) {
				throw invalidParams(path, 'array', value);
			}
			for (let i = 0; i < value.length; i++) {
				itemAssert(value[i], `${path}[${i}]`);
			}
		};
	}
	return buildPrimitiveAssert(schema);
}

function buildPrimitiveAssert(schema: SessionConfigPropertySchema): AssertValidator {
	const enumDynamic = schema.enumDynamic === true;
	return (value, path) => {
		switch (schema.type) {
			case 'string': if (typeof value !== 'string') { throw invalidParams(path, 'string', value); } break;
			case 'number': if (typeof value !== 'number') { throw invalidParams(path, 'number', value); } break;
			case 'boolean': if (typeof value !== 'boolean') { throw invalidParams(path, 'boolean', value); } break;
			case 'array': if (!Array.isArray(value)) { throw invalidParams(path, 'array', value); } break;
			case 'object': if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw invalidParams(path, 'object', value); } break;
		}
		if (schema.enum && !enumDynamic && !schema.enum.includes(value as string)) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Invalid value at '${path || '<root>'}': ${safeStringify(value)} is not one of [${schema.enum.map(v => JSON.stringify(v)).join(', ')}]`);
		}
	};
}

function invalidParams(path: string, expected: string, value: unknown): ProtocolError {
	return new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Invalid value at '${path || '<root>'}': expected ${expected}, got ${safeStringify(value)}`);
}

function joinPath(parent: string, key: string): string {
	return parent ? `${parent}.${key}` : key;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}


export type AutoApproveLevel = 'default' | 'assisted' | 'autoApprove';

export type SessionMode = 'interactive' | 'plan' | 'autopilot';

export interface IPermissionsValue {
	readonly allow: readonly string[];
	readonly deny: readonly string[];
}

const permissionsProperty = schemaProperty<IPermissionsValue>({
	type: 'object',
	title: localize('agentHost.sessionConfig.permissions', "Permissions"),
	description: localize('agentHost.sessionConfig.permissionsDescription', "Per-tool session permissions. Updated automatically when approving a tool \"in this Session\"."),
	properties: {
		allow: {
			type: 'array',
			title: localize('agentHost.sessionConfig.permissions.allow', "Allowed tools"),
			items: {
				type: 'string',
				title: localize('agentHost.sessionConfig.permissions.toolName', "Tool name"),
			},
		},
		deny: {
			type: 'array',
			title: localize('agentHost.sessionConfig.permissions.deny', "Denied tools"),
			items: {
				type: 'string',
				title: localize('agentHost.sessionConfig.permissions.toolName', "Tool name"),
			},
		},
	},
	default: { allow: [], deny: [] },
	sessionMutable: true,
});

const shellInitScriptsProperty = schemaProperty<readonly IShellInitScript[]>({
	type: 'array',
	title: localize('agentHost.sessionConfig.shellInitScripts', "Shell Init Script"),
	description: localize('agentHost.sessionConfig.shellInitScriptsDescription', "A script sourced before each built-in shell tool command."),
	items: {
		type: 'object',
		title: localize('agentHost.sessionConfig.shellInitScripts.item', "Shell Init Script"),
		properties: {
			shell: {
				type: 'string',
				title: localize('agentHost.sessionConfig.shellInitScripts.shell', "Shell"),
				enum: ['bash', 'powershell'],
			},
			script: {
				type: 'string',
				title: localize('agentHost.sessionConfig.shellInitScripts.script', "Script"),
			},
		},
		required: ['shell', 'script'],
	},
	readOnly: true,
	sessionMutable: true,
});

export const platformSessionSchema = createSchema({
	[SessionConfigKey.AutoApprove]: schemaProperty<AutoApproveLevel>({
		type: 'string',
		title: localize('agentHost.sessionConfig.autoApprove', "Approvals"),
		description: localize('agentHost.sessionConfig.autoApproveDescription', "Tool approval behavior for this session"),
		enum: ['default', 'assisted', 'autoApprove'],
		enumLabels: [
			localize('agentHost.sessionConfig.autoApprove.default', "Manual permissions"),
			localize('agentHost.sessionConfig.autoApprove.assisted', "Assisted permissions"),
			localize('agentHost.sessionConfig.autoApprove.bypass', "Allow all"),
		],
		enumDescriptions: [
			localize('agentHost.sessionConfig.autoApprove.defaultDescription', "Asks when approval settings don't apply"),
			localize('agentHost.sessionConfig.autoApprove.assistedDescription', "Evaluates risk before running tools"),
			localize('agentHost.sessionConfig.autoApprove.bypassDescription', "Runs tool calls without asking"),
		],
		default: 'default',
		sessionMutable: true,
	}),
	[SessionConfigKey.Permissions]: permissionsProperty,
	[SessionConfigKey.Mode]: schemaProperty<SessionMode>({
		type: 'string',
		title: localize('agentHost.sessionConfig.mode', "Agent Mode"),
		description: localize('agentHost.sessionConfig.modeDescription', "How the agent should approach this turn"),
		enum: ['interactive', 'plan', 'autopilot'],
		enumLabels: [
			localize('agentHost.sessionConfig.mode.interactive', "Interactive"),
			localize('agentHost.sessionConfig.mode.plan', "Plan"),
			localize('agentHost.sessionConfig.mode.autopilot', "Autopilot"),
		],
		enumDescriptions: [
			localize('agentHost.sessionConfig.mode.interactiveDescription', "Step-by-step collaboration"),
			localize('agentHost.sessionConfig.mode.planDescription', "Plan first, execute when ready"),
			localize('agentHost.sessionConfig.mode.autopilotDescription', "Works autonomously within permissions"),
		],
		default: 'interactive',
		sessionMutable: true,
	}),
	[SessionConfigKey.ShellInitScripts]: shellInitScriptsProperty,
});

export function migrateLegacyAutopilotConfig<T extends Record<string, unknown> | undefined>(config: T): T {
	if (!config || config[SessionConfigKey.AutoApprove] !== 'autopilot') {
		return config;
	}
	const migrated: Record<string, unknown> = { ...config };
	if (migrated[SessionConfigKey.Mode] !== 'plan') {
		migrated[SessionConfigKey.Mode] = 'autopilot' satisfies SessionMode;
	}
	migrated[SessionConfigKey.AutoApprove] = 'default' satisfies AutoApproveLevel;
	return migrated as T;
}

export const AgentHostTelemetryLevelConfigKey = 'telemetryLevel';

export const AgentHostEditTelemetryEnabledConfigKey = 'editTelemetryEnabled';

export const AgentHostDisableRepoInfoTelemetryConfigKey = 'disableRepoInfoTelemetry';

export const DISABLE_REPO_INFO_TELEMETRY_SETTING_ID = 'chat.advanced.debug.disableRepoInfoTelemetry';

export const AgentHostByokModelsEnabledConfigKey = 'byokModelsEnabled';

export const AgentHostCodexEnabledConfigKey = 'codexAgentEnabled';

export const AgentHostEditAutoApprovePatternsConfigKey = 'editAutoApprovePatterns';

export const AgentHostTerminalAutoApproveEnabledConfigKey = 'terminalAutoApproveEnabled';

export const TERMINAL_AUTO_APPROVE_ENABLED_SETTING_ID = 'chat.tools.terminal.enableAutoApprove';


export const GLOBAL_AUTO_APPROVE_SETTING_ID = 'chat.tools.global.autoApprove';

export const ELIGIBLE_FOR_AUTO_APPROVAL_SETTING_ID = 'chat.tools.eligibleForAutoApproval';

export const AgentHostGlobalAutoApproveEnabledConfigKey = 'globalAutoApproveEnabled';
export const AgentHostAutoApprovePolicyRestrictedConfigKey = 'autoApprovePolicyRestricted';

export const AgentHostAutoReplyEnabledConfigKey = 'autoReplyEnabled';

export const AgentHostAutoReplyAnswer = 'The user is not available to answer your question. Choose a pragmatic option best aligned with the context of the request.';

export const AgentHostSystemProxyEnabledConfigKey = 'systemProxyEnabled';

export const AgentHostProxyConfigKey = {
	Proxy: 'http.proxy',
	ProxyKerberosServicePrincipal: 'http.proxyKerberosServicePrincipal',
	NoProxy: 'http.noProxy',
} as const;

const agentHostProxyConfigDefinition = {
	[AgentHostProxyConfigKey.Proxy]: schemaProperty<string>({
		type: 'string',
		title: localize('agentHost.config.httpProxy.title', "HTTP Proxy"),
		description: localize('agentHost.config.httpProxy.description', "The proxy URL used by network requests from the Agent Host."),
	}),
	[AgentHostProxyConfigKey.ProxyKerberosServicePrincipal]: schemaProperty<string>({
		type: 'string',
		title: localize('agentHost.config.httpProxyKerberosServicePrincipal.title', "HTTP Proxy Kerberos Service Principal"),
		description: localize('agentHost.config.httpProxyKerberosServicePrincipal.description', "The Kerberos service principal used to authenticate with the HTTP proxy."),
	}),
	[AgentHostProxyConfigKey.NoProxy]: schemaProperty<string[]>({
		type: 'array',
		title: localize('agentHost.config.httpNoProxy.title', "HTTP No Proxy"),
		description: localize('agentHost.config.httpNoProxy.description', "Domain names that bypass the configured HTTP proxy."),
		items: { type: 'string', title: localize('agentHost.config.httpNoProxy.item.title', "Domain") },
		default: [],
	}),
};
export const agentHostProxyConfigSchema = createSchema(agentHostProxyConfigDefinition);

export const AgentHostActiveAgentTitleGenerationConfigKey = 'activeAgentTitleGeneration';

export const AgentHostMarkdownPlanRichLinksEnabledConfigKey = 'markdownPlanRichLinksEnabled';

export const AgentHostArtifactToolsConfigKey = 'artifactTools';

export const AgentHostAutoAttachPullRequestsConfigKey = 'autoAttachPullRequests';

export const AgentHostMigrateLegacyCopilotCliEnabledConfigKey = 'migrateLegacyCopilotCliEnabled';

export const AgentHostShowExternalSessionsConfigKey = 'showExternalSessions';

export { ChatExternalSessionsMode as AgentHostExternalSessionsMode };

export const AgentHostCopilotMultiRootEnabledConfigKey = 'copilotMultiRootEnabled';

export const AgentHostClaudeMultiRootEnabledConfigKey = 'claudeMultiRootEnabled';

export const AgentHostCodexMultiRootEnabledConfigKey = 'codexMultiRootEnabled';

export const AgentHostTerminalAutoApproveRulesConfigKey = 'terminalAutoApproveRules';

export interface IAgentHostTerminalAutoApproveRule {
	readonly approve: boolean;
	readonly matchCommandLine?: boolean;
}

export type AgentHostTerminalAutoApproveRuleValue = boolean | null | IAgentHostTerminalAutoApproveRule;
export type AgentHostTerminalAutoApproveRules = Record<string, AgentHostTerminalAutoApproveRuleValue>;

export const TERMINAL_AUTO_APPROVE_SETTING_ID = 'chat.tools.terminal.autoApprove';
export const TERMINAL_IGNORE_DEFAULT_AUTO_APPROVE_RULES_SETTING_ID = 'chat.tools.terminal.ignoreDefaultAutoApproveRules';

export function getAgentHostTerminalAutoApproveRulesConfig(configurationService: IConfigurationService): AgentHostTerminalAutoApproveRules {
	const config = configurationService.getValue<AgentHostTerminalAutoApproveRules | undefined>(TERMINAL_AUTO_APPROVE_SETTING_ID);
	const configInspectValue = configurationService.inspect<Readonly<AgentHostTerminalAutoApproveRules>>(TERMINAL_AUTO_APPROVE_SETTING_ID);
	const ignoreDefaults = configurationService.getValue<boolean>(TERMINAL_IGNORE_DEFAULT_AUTO_APPROVE_RULES_SETTING_ID) === true;
	return normalizeAgentHostTerminalAutoApproveRulesConfig(config, configInspectValue, ignoreDefaults);
}

export function normalizeAgentHostTerminalAutoApproveRulesConfig(config: AgentHostTerminalAutoApproveRules | undefined, configInspectValue: IConfigurationValue<Readonly<AgentHostTerminalAutoApproveRules>>, ignoreDefaults: boolean): AgentHostTerminalAutoApproveRules {
	if (!config) {
		return {};
	}

	const rules: AgentHostTerminalAutoApproveRules = {};
	for (const [key, value] of Object.entries(config)) {
		if (ignoreDefaults && isDefaultOnlyAutoApproveRule(key, value, configInspectValue)) {
			continue;
		}
		rules[key] = value;
	}
	return rules;
}

function isDefaultOnlyAutoApproveRule(key: string, value: AgentHostTerminalAutoApproveRuleValue, configInspectValue: IConfigurationValue<Readonly<AgentHostTerminalAutoApproveRules>>): boolean {
	const defaultValue = configInspectValue.default?.value;
	const isDefaultRule = hasMatchingRule(defaultValue, key, value);
	if (!isDefaultRule) {
		return false;
	}

	const sourceTarget = getAutoApproveRuleSourceTarget(key, value, configInspectValue);

	return sourceTarget === ConfigurationTarget.DEFAULT;
}

function getAutoApproveRuleSourceTarget(key: string, value: AgentHostTerminalAutoApproveRuleValue, configInspectValue: IConfigurationValue<Readonly<AgentHostTerminalAutoApproveRules>>): ConfigurationTarget {
	if (hasMatchingRule(configInspectValue.workspaceFolderValue, key, value)) {
		return ConfigurationTarget.WORKSPACE_FOLDER;
	}
	if (hasMatchingRule(configInspectValue.workspaceValue, key, value)) {
		return ConfigurationTarget.WORKSPACE;
	}
	if (hasMatchingRule(configInspectValue.userRemoteValue, key, value)) {
		return ConfigurationTarget.USER_REMOTE;
	}
	if (hasMatchingRule(configInspectValue.userLocalValue, key, value)) {
		return ConfigurationTarget.USER_LOCAL;
	}
	if (hasMatchingRule(configInspectValue.userValue, key, value)) {
		return ConfigurationTarget.USER;
	}
	if (hasMatchingRule(configInspectValue.applicationValue, key, value)) {
		return ConfigurationTarget.APPLICATION;
	}
	return ConfigurationTarget.DEFAULT;
}

function hasMatchingRule(config: Readonly<AgentHostTerminalAutoApproveRules> | undefined, key: string, value: AgentHostTerminalAutoApproveRuleValue): boolean {
	return !!config && Object.prototype.hasOwnProperty.call(config, key) && structuralEquals(config[key], value);
}

export const AgentHostMcpServersConfigKey = 'mcpServers';

export type AgentHostMcpServers = Record<string, IMcpServerConfiguration>;

export function telemetryLevelToAgentHostConfigValue(telemetryLevel: TelemetryLevel): TelemetryConfiguration {
	return telemetryLevelToAgentHostValue(telemetryLevel);
}

export function agentHostConfigValueToTelemetryLevel(value: unknown): TelemetryLevel | undefined {
	switch (value) {
		case TelemetryConfiguration.OFF:
			return TelemetryLevel.NONE;
		case TelemetryConfiguration.CRASH:
			return TelemetryLevel.CRASH;
		case TelemetryConfiguration.ERROR:
			return TelemetryLevel.ERROR;
		case TelemetryConfiguration.ON:
			return TelemetryLevel.USAGE;
		default:
			return undefined;
	}
}

const mcpServerConfigProperties: Record<string, SessionConfigPropertySchema> = {
	type: {
		type: 'string',
		title: localize('agentHost.config.mcpServers.type.title', "Server Type"),
		description: localize('agentHost.config.mcpServers.type.description', "The transport used to reach the server: `stdio` for a local command, `http` for a remote endpoint."),
		enum: ['stdio', 'http'],
	},
	command: {
		type: 'string',
		title: localize('agentHost.config.mcpServers.command.title', "Command"),
		description: localize('agentHost.config.mcpServers.command.description', "For `stdio` servers, the executable to spawn."),
	},
	args: {
		type: 'array',
		title: localize('agentHost.config.mcpServers.args.title', "Arguments"),
		description: localize('agentHost.config.mcpServers.args.description', "For `stdio` servers, the arguments passed to the command."),
		items: { type: 'string', title: localize('agentHost.config.mcpServers.arg.title', "Argument") },
	},
	env: {
		type: 'object',
		title: localize('agentHost.config.mcpServers.env.title', "Environment"),
		description: localize('agentHost.config.mcpServers.env.description', "For `stdio` servers, environment variables set on the spawned process."),
	},
	cwd: {
		type: 'string',
		title: localize('agentHost.config.mcpServers.cwd.title', "Working Directory"),
		description: localize('agentHost.config.mcpServers.cwd.description', "For `stdio` servers, the working directory the command runs in."),
	},
	url: {
		type: 'string',
		title: localize('agentHost.config.mcpServers.url.title', "URL"),
		description: localize('agentHost.config.mcpServers.url.description', "For `http` servers, the endpoint URL of the MCP server."),
	},
	headers: {
		type: 'object',
		title: localize('agentHost.config.mcpServers.headers.title', "Headers"),
		description: localize('agentHost.config.mcpServers.headers.description', "For `http` servers, HTTP headers sent with every request."),
	},
};

const mcpServersValueProperties: Record<string, SessionConfigPropertySchema> = {
	'<serverName>': {
		type: 'object',
		title: localize('agentHost.config.mcpServers.entry.title', "MCP Server"),
		description: localize('agentHost.config.mcpServers.entry.description', "A single MCP server entry. The property key is the server name."),
		properties: mcpServerConfigProperties,
	},
};

export const platformRootSchema = createSchema({
	...agentHostProxyConfigDefinition,
	[SessionConfigKey.Permissions]: permissionsProperty,
	[AgentHostDisableRepoInfoTelemetryConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.disableRepoInfoTelemetry.title', "Disable Repository Information Telemetry"),
		description: localize('agentHost.config.disableRepoInfoTelemetry.description', "Whether repository information telemetry is disabled for Agent Host sessions."),
		default: false,
	}),
	[AgentHostTelemetryLevelConfigKey]: schemaProperty<TelemetryConfiguration>({
		type: 'string',
		title: localize('agentHost.config.telemetryLevel.title', "Telemetry Level"),
		description: localize('agentHost.config.telemetryLevel.description', "Most restrictive telemetry level requested by connected clients."),
		enum: [TelemetryConfiguration.ON, TelemetryConfiguration.ERROR, TelemetryConfiguration.CRASH, TelemetryConfiguration.OFF],
		default: TelemetryConfiguration.ON,
	}),
	[AgentHostEditTelemetryEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.editTelemetryEnabled.title', "Edit Telemetry"),
		description: localize('agentHost.config.editTelemetryEnabled.description', "Whether edit attribution telemetry is enabled for Agent Host sessions."),
		default: true,
	}),
	[AgentHostByokModelsEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.byokModelsEnabled.title', "BYOK Models"),
		description: localize('agentHost.config.byokModelsEnabled.description', "Whether extension-provided BYOK models are enabled."),
		default: false,
	}),
	[AgentHostCodexEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.codexAgentEnabled.title', "Codex Agent"),
		description: localize('agentHost.config.codexAgentEnabled.description', "Whether the Codex provider is enabled."),
		default: false,
	}),
	[AgentHostTerminalAutoApproveEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.terminalAutoApproveEnabled.title', "Terminal Auto Approve"),
		description: localize('agentHost.config.terminalAutoApproveEnabled.description', "Whether terminal auto-approve rules forwarded by the connected client are allowed to apply to agent-host shell permission requests."),
		default: true,
	}),
	[AgentHostGlobalAutoApproveEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.globalAutoApproveEnabled.title', "Global Auto Approve"),
		description: localize('agentHost.config.globalAutoApproveEnabled.description', "Whether VS Code's global auto-approve setting is enabled. When `true`, every tool call is auto-approved, equivalent to a session using Allow all."),
		default: false,
	}),
	[AgentHostAutoApprovePolicyRestrictedConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.autoApprovePolicyRestricted', "Auto Approve Policy Restricted"),
		default: false,
		readOnly: true,
	}),
	[AgentHostAutoReplyEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.autoReplyEnabled.title', "Auto Reply"),
		description: localize('agentHost.config.autoReplyEnabled.description', "Whether VS Code's auto-reply setting is enabled. When `true`, `ask_user` questions are auto-answered instead of blocking on the user, mirroring autopilot mode."),
		default: false,
	}),
	[AgentHostSystemProxyEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.systemProxyEnabled.title', "System Proxy Discovery"),
		description: localize('agentHost.config.systemProxyEnabled.description', "Whether Copilot sessions automatically discover and use the operating system's proxy configuration."),
		default: true,
	}),
	[AgentHostActiveAgentTitleGenerationConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.activeAgentTitleGeneration.title', "Active Agent Title Generation"),
		description: localize('agentHost.config.activeAgentTitleGeneration.description', "Whether the active agent names sessions and chats with rename tools instead of utility-model title generation."),
		default: false,
	}),
	[AgentHostMarkdownPlanRichLinksEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.markdownPlanRichLinks.title', "Markdown Plan Rich Links"),
		description: localize('agentHost.config.markdownPlanRichLinks.description', "Whether agents receive guidance for using rich links and running task markers in Markdown plan documents."),
		default: false,
	}),
	[AgentHostArtifactToolsConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.artifactTools.title', "Artifact Tools"),
		description: localize('agentHost.config.artifactTools.description', "Whether agents can record artifacts — pull requests, issues, commits, websites, files and other resources — with the artifact tools."),
		default: false,
	}),
	[AgentHostAutoAttachPullRequestsConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.autoAttachPullRequests.title', "Automatic Pull Request Association"),
		description: localize('agentHost.config.autoAttachPullRequests.description', "Whether the Agent Host automatically discovers and associates a pull request for the currently checked-out branch. When disabled, only pull requests recorded as artifacts or explicitly associated by session actions are considered."),
		default: true,
	}),
	[AgentHostMigrateLegacyCopilotCliEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.migrateLegacyCopilotCliEnabled.title', "Migrate Legacy Copilot CLI Sessions"),
		description: localize('agentHost.config.migrateLegacyCopilotCliEnabled.description', "Whether un-adopted extension-host Copilot CLI sessions are surfaced as adoptable agent-host sessions and migrated in place when opened."),
		default: false,
	}),
	[AgentHostShowExternalSessionsConfigKey]: schemaProperty<ChatExternalSessionsMode>({
		type: 'string',
		title: localize('agentHost.config.showExternalSessions.title', "Show External Agent Sessions"),
		description: localize('agentHost.config.showExternalSessions.description', "Controls whether sessions created outside the Agent Host are included in the session catalog."),
		enum: [ChatExternalSessionsMode.None, ChatExternalSessionsMode.Recent, ChatExternalSessionsMode.Last24Hours, ChatExternalSessionsMode.Last7Days, ChatExternalSessionsMode.Last30Days],
		enumDescriptions: [
			localize('agentHost.config.showExternalSessions.none', "Do not show external sessions."),
			localize('agentHost.config.showExternalSessions.recent', "Show up to the 2 most recent external sessions updated in the last 7 days. At startup, external sessions older than the second-most-recently updated local session are hidden."),
			localize('agentHost.config.showExternalSessions.last24Hours', "Show external sessions updated in the last 24 hours."),
			localize('agentHost.config.showExternalSessions.last7Days', "Show external sessions updated in the last 7 days."),
			localize('agentHost.config.showExternalSessions.last30Days', "Show external sessions updated in the last 30 days."),
		],
		default: ChatExternalSessionsMode.None,
	}),
	[AgentHostCopilotMultiRootEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.copilotMultiRootEnabled.title', "Copilot Multiple Working Directories"),
		description: localize('agentHost.config.copilotMultiRootEnabled.description', "Whether the Copilot provider advertises support for multiple working directories, letting a session span every folder of a multi-root workspace."),
		default: false,
	}),
	[AgentHostClaudeMultiRootEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.claudeMultiRootEnabled.title', "Claude Multiple Working Directories"),
		description: localize('agentHost.config.claudeMultiRootEnabled.description', "Whether the Claude provider advertises support for multiple working directories, letting a session span every folder of a multi-root workspace."),
		default: false,
	}),
	[AgentHostCodexMultiRootEnabledConfigKey]: schemaProperty<boolean>({
		type: 'boolean',
		title: localize('agentHost.config.codexMultiRootEnabled.title', "Codex Multiple Working Directories"),
		description: localize('agentHost.config.codexMultiRootEnabled.description', "Whether the Codex provider advertises support for multiple working directories, letting a session span every folder of a multi-root workspace."),
		default: false,
	}),
	[AgentHostEditAutoApprovePatternsConfigKey]: schemaProperty<ChatEditAutoApprovePatterns>({
		type: 'object',
		title: localize('agentHost.config.editAutoApprovePatterns.title', "Edit Auto Approve Patterns"),
		description: localize('agentHost.config.editAutoApprovePatterns.description', "Effective edit auto-approve patterns forwarded by the connected client for agent-host write permission checks."),
		default: DEFAULT_EDIT_AUTO_APPROVE_PATTERNS,
	}),
	[AgentHostTerminalAutoApproveRulesConfigKey]: schemaProperty<AgentHostTerminalAutoApproveRules>({
		type: 'object',
		title: localize('agentHost.config.terminalAutoApproveRules.title', "Terminal Auto Approve Rules"),
		description: localize('agentHost.config.terminalAutoApproveRules.description', "Terminal auto-approve rules forwarded by the connected client for agent-host shell permission checks."),
		default: {},
	}),
	[AgentHostMcpServersConfigKey]: schemaProperty<AgentHostMcpServers>({
		type: 'object',
		title: localize('agentHost.config.mcpServers.title', "MCP Servers"),
		description: localize('agentHost.config.mcpServers.description', "Agent-host-level MCP servers exposed to every session, keyed by server name. Each value is a server configuration (see `<serverName>`)."),
		properties: mcpServersValueProperties,
		default: {},
	}),
});

export const clientOwnedApprovalRootConfigKeys: ReadonlySet<string> = new Set([
	SessionConfigKey.Permissions,
	AgentHostGlobalAutoApproveEnabledConfigKey,
	AgentHostAutoApprovePolicyRestrictedConfigKey,
	AgentHostTerminalAutoApproveEnabledConfigKey,
	AgentHostTerminalAutoApproveRulesConfigKey,
	AgentHostEditAutoApprovePatternsConfigKey,
	AgentHostAutoReplyEnabledConfigKey,
]);
