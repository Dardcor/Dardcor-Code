/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse as parseJSONC } from '../../../base/common/json.js';
import { cloneAndChange, equals as objectEquals } from '../../../base/common/objects.js';
import { isAbsolute } from '../../../base/common/path.js';
import { basename, extname, isEqualOrParent, joinPath, normalizePath, isEqual as isURLEquals, dirname } from '../../../base/common/resources.js';
import { escapeRegExpCharacters } from '../../../base/common/strings.js';
import { hasKey, Mutable } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../files/common/files.js';
import { parseFrontMatter } from '../../../base/common/yaml.js';
import { IMcpRemoteServerConfiguration, IMcpServerConfiguration, IMcpStdioServerConfiguration, McpServerType } from '../../mcp/common/mcpPlatformTypes.js';
import { CustomizationType, McpServerStatus, type AgentCustomization, type HookCustomization, type McpServerCustomization, type RuleCustomization, type SkillCustomization } from '../../agentHost/common/state/protocol/state.js';
import { DEFAULT_MCP_APP } from '../../agentHost/common/state/protocol/mcpAppDefaults.js';
import { customizationId } from '../../agentHost/common/state/sessionState.js';
import { readAgentPluginManifest } from './agentPluginParser.js';


export interface IParsedHookCommand {
	readonly command?: string;
	readonly windows?: string;
	readonly linux?: string;
	readonly osx?: string;
	readonly cwd?: URI;
	readonly env?: Record<string, string>;
	readonly timeout?: number;
	readonly sourceUri?: URI;
}

export namespace IParsedHookCommand {
	export function isEquals(a: IParsedHookCommand | undefined, b: IParsedHookCommand | undefined): boolean {
		if (a === b) {
			return true;
		}
		if (!a || !b) {
			return false;
		}
		return a.command === b.command
			&& a.windows === b.windows
			&& a.linux === b.linux
			&& a.osx === b.osx
			&& isURLEquals(a.cwd, b.cwd)
			&& objectEquals(a.env, b.env)
			&& a.timeout === b.timeout
			&& isURLEquals(a.sourceUri, b.sourceUri);
	}
}

export interface IParsedHookGroup {
	readonly type: string;
	readonly commands: readonly IParsedHookCommand[];
	readonly uri: URI;
	readonly originalId: string;
	readonly customization: HookCustomization;
}

export interface IMcpServerDefinition {
	readonly name: string;
	readonly configuration: IMcpServerConfiguration;
	readonly defaultCwd?: URI;
	readonly uri: URI;
	readonly customization: McpServerCustomization;
}

export interface INamedPluginResource {
	readonly uri: URI;
	readonly name: string;
	readonly description?: string;
}

export interface IAgentPluginResource extends INamedPluginResource {
	readonly model?: string;
	readonly tools?: readonly string[];
	readonly disableModelInvocation?: boolean;
	readonly disableUserInvocation?: boolean;
}

interface ISkillPluginResource extends INamedPluginResource {
	readonly disableModelInvocation?: boolean;
	readonly disableUserInvocation?: boolean;
}

export interface IParsedAgent extends IAgentPluginResource {
	readonly customization: AgentCustomization;
}

export interface IParsedSkill extends ISkillPluginResource {
	readonly customization: SkillCustomization;
}

export interface IParsedRule extends INamedPluginResource {
	readonly customization: RuleCustomization;
}

export interface IParsedPlugin {
	readonly format: PluginFormat;
	readonly hooks: readonly IParsedHookGroup[];
	readonly mcpServers: readonly IMcpServerDefinition[];
	readonly skills: readonly IParsedSkill[];
	readonly agents: readonly IParsedAgent[];
	readonly instructions: readonly IParsedRule[];
}


export const enum PluginFormat {
	Copilot,
	Claude,
	OpenPlugin,
	AgentPlugin,
}

export interface IPluginFormatConfig {
	readonly format: PluginFormat;
	readonly manifestPath: string;
	readonly hookConfigPath: string;
	readonly componentPaths?: Readonly<Partial<Record<PluginComponent, string | false>>>;
	readonly manifestExtensionNamespace?: string;
	readonly requiresManifest?: boolean;
	readonly pluginRootTokens: readonly string[];
	readonly pluginRootEnvVars: readonly string[];
	parseHooks(hookUri: URI, json: unknown, pluginUri: URI, workspaceRoot: URI | undefined, userHome: URI): IParsedHookGroup[];
}

export type PluginComponent = 'commands' | 'skills' | 'agents' | 'rules' | 'hooks' | 'mcpServers';

const COPILOT_FORMAT: IPluginFormatConfig = {
	format: PluginFormat.Copilot,
	manifestPath: 'plugin.json',
	hookConfigPath: 'hooks.json',
	pluginRootTokens: ['${PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}'],
	pluginRootEnvVars: ['PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT'],
	parseHooks(hookUri, json, _pluginUri, workspaceRoot, userHome) {
		return parseHooksJson(hookUri, json, workspaceRoot, userHome);
	},
};

const CLAUDE_FORMAT: IPluginFormatConfig = {
	format: PluginFormat.Claude,
	manifestPath: '.claude-plugin/plugin.json',
	hookConfigPath: 'hooks/hooks.json',
	pluginRootTokens: ['${PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}'],
	pluginRootEnvVars: ['PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT'],
	parseHooks(hookUri, json, pluginUri, workspaceRoot, userHome) {
		return interpolateHookPluginRoot(hookUri, json, pluginUri, workspaceRoot, userHome, '${CLAUDE_PLUGIN_ROOT}', 'CLAUDE_PLUGIN_ROOT');
	},
};

const OPEN_PLUGIN_FORMAT: IPluginFormatConfig = {
	format: PluginFormat.OpenPlugin,
	manifestPath: '.plugin/plugin.json',
	hookConfigPath: 'hooks/hooks.json',
	pluginRootTokens: ['${PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}'],
	pluginRootEnvVars: ['PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT'],
	parseHooks(hookUri, json, pluginUri, workspaceRoot, userHome) {
		return interpolateHookPluginRoot(hookUri, json, pluginUri, workspaceRoot, userHome, '${PLUGIN_ROOT}', 'PLUGIN_ROOT');
	},
};

const AGENT_PLUGIN_COPILOT_EXTENSION_NAMESPACE = 'com.github.copilot';

const AGENT_PLUGIN_FORMAT: IPluginFormatConfig = {
	format: PluginFormat.AgentPlugin,
	manifestPath: 'plugin.json',
	hookConfigPath: `${AGENT_PLUGIN_COPILOT_EXTENSION_NAMESPACE}/hooks/hooks.json`,
	componentPaths: {
		commands: `${AGENT_PLUGIN_COPILOT_EXTENSION_NAMESPACE}/commands`,
		skills: 'skills',
		agents: `${AGENT_PLUGIN_COPILOT_EXTENSION_NAMESPACE}/agents`,
		rules: `${AGENT_PLUGIN_COPILOT_EXTENSION_NAMESPACE}/rules`,
		hooks: `${AGENT_PLUGIN_COPILOT_EXTENSION_NAMESPACE}/hooks/hooks.json`,
		mcpServers: 'mcp.json',
	},
	manifestExtensionNamespace: AGENT_PLUGIN_COPILOT_EXTENSION_NAMESPACE,
	requiresManifest: true,
	pluginRootTokens: [],
	pluginRootEnvVars: [],
	parseHooks(hookUri, json, _pluginUri, workspaceRoot, userHome) {
		return parseHooksJson(hookUri, json, workspaceRoot, userHome);
	},
};

export async function detectPluginFormat(pluginUri: URI, fileService: IFileService): Promise<IPluginFormatConfig> {
	if (await readAgentPluginManifest(pluginUri, fileService)) {
		return AGENT_PLUGIN_FORMAT;
	}
	if (await pathExists(joinPath(pluginUri, '.plugin', 'plugin.json'), fileService)) {
		return OPEN_PLUGIN_FORMAT;
	}

	const isInClaudeDirectory = pluginUri.path.split('/').includes('.claude');
	if (isInClaudeDirectory || await pathExists(joinPath(pluginUri, '.claude-plugin', 'plugin.json'), fileService)) {
		return CLAUDE_FORMAT;
	}

	return COPILOT_FORMAT;
}

export async function readPluginManifest(pluginUri: URI, format: IPluginFormatConfig, fileService: IFileService): Promise<Record<string, unknown> | undefined> {
	if (format.format === PluginFormat.AgentPlugin) {
		const manifest = await readAgentPluginManifest(pluginUri, fileService);
		return manifest ? { ...manifest } : undefined;
	}
	const json = await readJsonFile(joinPath(pluginUri, format.manifestPath), fileService);
	return json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : undefined;
}

export function getPluginManifestComponent(format: IPluginFormatConfig, component: PluginComponent, manifest: Record<string, unknown> | undefined): unknown {
	if (format.manifestExtensionNamespace) {
		const extensions = manifest?.['extensions'];
		if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) {
			return undefined;
		}
		const extension = (extensions as Record<string, unknown>)[format.manifestExtensionNamespace];
		return extension && typeof extension === 'object' && !Array.isArray(extension)
			? (extension as Record<string, unknown>)[component]
			: undefined;
	}
	return format.componentPaths && Object.hasOwn(format.componentPaths, component) ? undefined : manifest?.[component];
}

export function resolvePluginComponentDirs(
	pluginUri: URI,
	format: IPluginFormatConfig,
	component: PluginComponent,
	fallbackPath: string,
	manifestSection: unknown,
	boundaryUri?: URI,
): readonly URI[] {
	const componentPath = format.componentPaths?.[component];
	if (format.componentPaths && Object.hasOwn(format.componentPaths, component)) {
		if (typeof componentPath !== 'string') {
			return [];
		}
		if (!format.manifestExtensionNamespace) {
			return resolveComponentDirs(pluginUri, componentPath, emptyComponentPathConfig, boundaryUri);
		}

		const config = parseComponentPathConfig(manifestSection);
		const defaultDirs = config.exclusive
			? []
			: resolveComponentDirs(pluginUri, componentPath, emptyComponentPathConfig, boundaryUri);
		const extensionRoot = joinPath(pluginUri, format.manifestExtensionNamespace);
		const configuredDirs = resolveComponentDirs(extensionRoot, '', { paths: config.paths, exclusive: true }, extensionRoot);
		return [...defaultDirs, ...configuredDirs];
	}
	return resolveComponentDirs(
		pluginUri,
		fallbackPath,
		parseComponentPathConfig(manifestSection),
		boundaryUri,
	);
}


function buildChildId(uri: URI, disambiguator?: string): string {
	const base = customizationId(uri.toString());
	if (!disambiguator) {
		return base;
	}
	return `${base.replace(/#/g, '%23')}#${disambiguator}`;
}

function makeAgentCustomization(resource: IAgentPluginResource): AgentCustomization {
	const uri = resource.uri.toString();
	return {
		type: CustomizationType.Agent,
		id: buildChildId(resource.uri),
		uri,
		name: resource.name,
		...(resource.description ? { description: resource.description } : {}),
		...(resource.model ? { model: resource.model } : {}),
		...(resource.tools?.length ? { tools: [...resource.tools] } : {}),
		...(resource.disableModelInvocation ? { disableModelInvocation: true } : {}),
		...(resource.disableUserInvocation ? { disableUserInvocation: true } : {}),
	};
}

function makeSkillCustomization(resource: ISkillPluginResource): SkillCustomization {
	const uri = resource.uri.toString();
	return {
		type: CustomizationType.Skill,
		id: buildChildId(resource.uri),
		uri,
		name: resource.name,
		...(resource.description ? { description: resource.description } : {}),
		...(resource.disableModelInvocation ? { disableModelInvocation: true } : {}),
		...(resource.disableUserInvocation ? { disableUserInvocation: true } : {}),
	};
}

function makeRuleCustomization(resource: INamedPluginResource): RuleCustomization {
	const uri = resource.uri.toString();
	return {
		type: CustomizationType.Rule,
		id: buildChildId(resource.uri),
		uri,
		name: resource.name,
		...(resource.description ? { description: resource.description } : {}),
	};
}

function makeHookCustomization(hookUri: URI): HookCustomization {
	return {
		type: CustomizationType.Hook,
		id: buildChildId(hookUri),
		uri: hookUri.toString(),
		name: basename(hookUri),
	};
}

export function makeMcpServerCustomization(definitionUri: URI, name: string): McpServerCustomization {
	return {
		type: CustomizationType.McpServer,
		id: buildChildId(definitionUri, `mcp=${encodeURIComponent(name)}`),
		uri: definitionUri.toString(),
		name,
		state: { kind: McpServerStatus.Stopped },
		mcpApp: DEFAULT_MCP_APP,
	};
}


export interface IComponentPathConfig {
	readonly paths: readonly string[];
	readonly exclusive: boolean;
}

const emptyComponentPathConfig: IComponentPathConfig = { paths: [], exclusive: false };

export function parseComponentPathConfig(raw: unknown): IComponentPathConfig {
	if (raw === undefined || raw === null) {
		return emptyComponentPathConfig;
	}

	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		return trimmed ? { paths: [trimmed], exclusive: false } : emptyComponentPathConfig;
	}

	if (Array.isArray(raw)) {
		const paths = raw
			.filter(v => typeof v === 'string')
			.map(v => v.trim())
			.filter(v => v.length > 0);
		return { paths, exclusive: false };
	}

	if (typeof raw === 'object') {
		const obj = raw as Record<string, unknown>;
		if (Array.isArray(obj['paths'])) {
			const paths = (obj['paths'] as unknown[])
				.filter(v => typeof v === 'string')
				.map(v => v.trim())
				.filter(v => v.length > 0);
			const exclusive = obj['exclusive'] === true;
			return { paths, exclusive };
		}
	}

	return emptyComponentPathConfig;
}

export function resolveComponentDirs(pluginUri: URI, defaultDir: string, config: IComponentPathConfig, boundaryUri?: URI): readonly URI[] {
	const boundary = (boundaryUri && isEqualOrParent(pluginUri, boundaryUri)) ? boundaryUri : pluginUri;
	const dirs: URI[] = [];
	if (!config.exclusive) {
		dirs.push(joinPath(pluginUri, defaultDir));
	}
	for (const p of config.paths) {
		const resolved = normalizePath(joinPath(pluginUri, p));
		if (isEqualOrParent(resolved, boundary)) {
			dirs.push(resolved);
		}
	}
	return dirs;
}


export function resolveMcpServersMap(raw: unknown): Record<string, unknown> | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	return Object.hasOwn(obj, 'mcpServers')
		? (obj.mcpServers as Record<string, unknown>)
		: obj;
}

export function normalizeMcpServerConfiguration(rawConfig: unknown): IMcpServerConfiguration | undefined {
	if (!rawConfig || typeof rawConfig !== 'object') {
		return undefined;
	}

	const candidate = rawConfig as Record<string, unknown>;
	const type = typeof candidate['type'] === 'string' ? candidate['type'] : undefined;
	const transport = candidate['transport'] === 'sse' || candidate['transport'] === 'http' ? candidate['transport'] : undefined;

	const command = typeof candidate['command'] === 'string' ? candidate['command'] : undefined;
	const url = typeof candidate['url'] === 'string' ? candidate['url'] : undefined;
	const args = Array.isArray(candidate['args']) ? candidate['args'].filter((value): value is string => typeof value === 'string') : undefined;
	const env = candidate['env'] && typeof candidate['env'] === 'object'
		? Object.fromEntries(Object.entries(candidate['env'] as Record<string, unknown>)
			.filter(([, value]) => typeof value === 'string' || typeof value === 'number' || value === null)
			.map(([key, value]) => [key, value as string | number | null]))
		: undefined;
	const envFile = typeof candidate['envFile'] === 'string' ? candidate['envFile'] : undefined;
	const cwd = typeof candidate['cwd'] === 'string' ? candidate['cwd'] : undefined;
	const headers = candidate['headers'] && typeof candidate['headers'] === 'object'
		? Object.fromEntries(Object.entries(candidate['headers'] as Record<string, unknown>)
			.filter(([, value]) => typeof value === 'string')
			.map(([key, value]) => [key, value as string]))
		: undefined;
	const rawOAuth = candidate['oauth'] && typeof candidate['oauth'] === 'object' ? candidate['oauth'] as Record<string, unknown> : undefined;
	const oauthClientId = (typeof rawOAuth?.['clientId'] === 'string' ? rawOAuth['clientId'] : undefined)
		?? (typeof candidate['oauthClientId'] === 'string' ? candidate['oauthClientId'] : undefined);
	const oauth = oauthClientId ? { clientId: oauthClientId } : undefined;
	const dev = candidate['dev'] && typeof candidate['dev'] === 'object' ? candidate['dev'] as IMcpStdioServerConfiguration['dev'] : undefined;

	if (type === 'ws') {
		return undefined;
	}

	if (type === McpServerType.LOCAL || (!type && command)) {
		if (!command) {
			return undefined;
		}
		return { type: McpServerType.LOCAL, command, args, env, envFile, cwd, dev };
	}

	if (type === McpServerType.REMOTE || type === 'streamable-http' || type === 'sse' || (!type && url)) {
		if (!url) {
			return undefined;
		}
		return { type: McpServerType.REMOTE, ...(type === 'sse' || transport === 'sse' ? { transport: 'sse' as const } : {}), url, headers, ...(oauth ? { oauth } : {}), dev };
	}

	return undefined;
}

const shellUnsafeChars = /[\s&|<>()^;!`"']/;

export function shellQuotePluginRootInCommand(command: string, fsPath: string, token: string) {
	if (!command.includes(token)) {
		return command;
	}

	if (!shellUnsafeChars.test(fsPath)) {
		return command.replaceAll(token, fsPath);
	}

	const escapedToken = escapeRegExpCharacters(token);
	const pattern = new RegExp(
		`(["']?)` + escapedToken + `([\\w./\\\\~:-]*)`,
		'g',
	);

	return command.replace(pattern, (_match, leadingQuote: string, suffix: string) => {
		const fullPath = fsPath + suffix;
		if (leadingQuote) {
			return leadingQuote + fullPath;
		}
		return '"' + fullPath.replace(/"/g, '\\"') + '"';
	});
}

export function interpolateMcpPluginRoot(
	def: IMcpServerDefinition,
	fsPath: string,
	tokens: readonly string[],
	envVars: readonly string[],
): IMcpServerDefinition {
	const replace = (s: string) => tokens.reduce((result, token) => result.replaceAll(token, fsPath), s);

	const config = def.configuration;
	let interpolated: IMcpServerConfiguration;

	if (config.type === McpServerType.LOCAL) {
		const local: Mutable<IMcpStdioServerConfiguration> = { ...config };
		local.command = replace(local.command);
		if (local.args) {
			local.args = local.args.map(replace);
		}
		if (local.cwd) {
			local.cwd = replace(local.cwd);
		}
		local.env = { ...local.env };
		for (const [k, v] of Object.entries(local.env)) {
			if (typeof v === 'string') {
				local.env[k] = replace(v);
			}
		}
		for (const envVar of envVars) {
			local.env[envVar] = fsPath;
		}
		if (local.envFile) {
			local.envFile = replace(local.envFile);
		}
		interpolated = local;
	} else {
		const remote: Mutable<IMcpRemoteServerConfiguration> = { ...config };
		remote.url = replace(remote.url);
		if (remote.headers) {
			remote.headers = Object.fromEntries(
				Object.entries(remote.headers).map(([k, v]) => [k, replace(v)])
			);
		}
		interpolated = remote;
	}

	return { ...def, configuration: interpolated };
}

const BARE_ENV_VAR_RE = /\$\{(?![A-Za-z]+:)([A-Z_][A-Z0-9_]*)\}/g;

export function convertBareEnvVarsToVsCodeSyntax(
	def: IMcpServerDefinition,
): IMcpServerDefinition {
	return cloneAndChange(def, (value) => {
		if (URI.isUri(value)) {
			return value;
		}
		if (typeof value === 'string') {
			const replaced = value.replace(BARE_ENV_VAR_RE, '${env:$1}');
			return replaced !== value ? replaced : undefined;
		}
		return undefined;
	});
}


const HOOK_TYPE_MAP: Record<string, string> = {
	'SessionStart': 'SessionStart',
	'SessionEnd': 'SessionEnd',
	'UserPromptSubmit': 'UserPromptSubmit',
	'PreToolUse': 'PreToolUse',
	'PostToolUse': 'PostToolUse',
	'PreCompact': 'PreCompact',
	'SubagentStart': 'SubagentStart',
	'SubagentStop': 'SubagentStop',
	'Stop': 'Stop',
	'ErrorOccurred': 'ErrorOccurred',
	'sessionStart': 'SessionStart',
	'sessionEnd': 'SessionEnd',
	'userPromptSubmitted': 'UserPromptSubmit',
	'preToolUse': 'PreToolUse',
	'postToolUse': 'PostToolUse',
	'agentStop': 'Stop',
	'subagentStop': 'SubagentStop',
	'errorOccurred': 'ErrorOccurred',
};

function normalizeHookCommand(raw: Record<string, unknown>): IParsedHookCommand | undefined {
	if (raw.type !== undefined && raw.type !== 'command') {
		return undefined;
	}

	const hasCommand = typeof raw.command === 'string' && raw.command.length > 0;
	const hasBash = typeof raw.bash === 'string' && (raw.bash as string).length > 0;
	const hasPowerShell = typeof raw.powershell === 'string' && (raw.powershell as string).length > 0;
	const hasWindows = typeof raw.windows === 'string' && (raw.windows as string).length > 0;
	const hasLinux = typeof raw.linux === 'string' && (raw.linux as string).length > 0;
	const hasOsx = typeof raw.osx === 'string' && (raw.osx as string).length > 0;

	if (!hasCommand && !hasBash && !hasPowerShell && !hasWindows && !hasLinux && !hasOsx) {
		return undefined;
	}

	const windows = hasWindows ? raw.windows as string : (hasPowerShell ? raw.powershell as string : undefined);
	const linux = hasLinux ? raw.linux as string : (hasBash ? raw.bash as string : undefined);
	const osx = hasOsx ? raw.osx as string : (hasBash ? raw.bash as string : undefined);

	const timeout = typeof raw.timeout === 'number'
		? raw.timeout
		: (typeof raw.timeoutSec === 'number' ? raw.timeoutSec : undefined);

	return {
		...(hasCommand && { command: raw.command as string }),
		...(windows && { windows }),
		...(linux && { linux }),
		...(osx && { osx }),
		...(typeof raw.env === 'object' && raw.env !== null && { env: raw.env as Record<string, string> }),
		...(timeout !== undefined && { timeout }),
	};
}

function resolveHookCommand(raw: Record<string, unknown>, workspaceRoot: URI | undefined, userHome: URI): IParsedHookCommand | undefined {
	const normalized = normalizeHookCommand(raw);
	if (!normalized) {
		return undefined;
	}

	let cwdUri: URI | undefined;
	const rawCwd = typeof raw.cwd === 'string' ? raw.cwd : undefined;
	if (rawCwd) {
		if (rawCwd.startsWith('~/')) {
			cwdUri = URI.joinPath(userHome, rawCwd.substring(2));
		} else if (isAbsolute(rawCwd)) {
			cwdUri = URI.file(rawCwd);
		} else if (workspaceRoot) {
			cwdUri = joinPath(workspaceRoot, rawCwd);
		}
	} else {
		cwdUri = workspaceRoot;
	}

	return { ...normalized, cwd: cwdUri };
}

function extractHookCommands(item: unknown, workspaceRoot: URI | undefined, userHome: URI): IParsedHookCommand[] {
	if (!item || typeof item !== 'object') {
		return [];
	}

	const itemObj = item as Record<string, unknown>;
	const commands: IParsedHookCommand[] = [];

	const nestedHooks = itemObj.hooks;
	if (nestedHooks !== undefined && Array.isArray(nestedHooks)) {
		for (const nested of nestedHooks) {
			if (!nested || typeof nested !== 'object') {
				continue;
			}
			const resolved = resolveHookCommand(nested as Record<string, unknown>, workspaceRoot, userHome);
			if (resolved) {
				commands.push(resolved);
			}
		}
	} else {
		const resolved = resolveHookCommand(itemObj, workspaceRoot, userHome);
		if (resolved) {
			commands.push(resolved);
		}
	}

	return commands;
}

export function parseHooksJson(
	hookUri: URI,
	json: unknown,
	workspaceRoot: URI | undefined,
	userHome: URI,
): IParsedHookGroup[] {
	if (!json || typeof json !== 'object') {
		return [];
	}

	const root = json as Record<string, unknown>;

	if (root.disableAllHooks === true) {
		return [];
	}

	const hooks = root.hooks;
	const hooksObj = hooks && typeof hooks === 'object' && !Array.isArray(hooks)
		? hooks as Record<string, unknown>
		: root;
	const result: IParsedHookGroup[] = [];
	const customization = makeHookCustomization(hookUri);

	for (const originalId of Object.keys(hooksObj)) {
		const canonicalType = HOOK_TYPE_MAP[originalId];
		if (!canonicalType) {
			continue;
		}

		const hookArray = hooksObj[originalId];
		if (!Array.isArray(hookArray)) {
			continue;
		}

		const commands: IParsedHookCommand[] = [];
		for (const item of hookArray) {
			commands.push(...extractHookCommands(item, workspaceRoot, userHome));
		}

		if (commands.length > 0) {
			result.push({ type: canonicalType, commands, uri: hookUri, originalId, customization });
		}
	}

	return result;
}

export function interpolateHookPluginRoot(
	hookUri: URI,
	json: unknown,
	pluginUri: URI,
	workspaceRoot: URI | undefined,
	userHome: URI,
	token: string,
	envVar: string,
): IParsedHookGroup[] {
	const fsPath = pluginUri.fsPath;
	const typedJson = json as { hooks?: Record<string, unknown[]> };

	const mutateHookCommand = (hook: Record<string, unknown>): void => {
		for (const field of ['command', 'windows', 'linux', 'osx'] as const) {
			if (typeof hook[field] === 'string') {
				hook[field] = shellQuotePluginRootInCommand(hook[field] as string, fsPath, token);
			}
		}

		if (!hook.env || typeof hook.env !== 'object') {
			hook.env = {};
		}
		(hook.env as Record<string, string>)[envVar] = fsPath;
	};

	for (const lifecycle of Object.values(typedJson.hooks ?? {})) {
		if (!Array.isArray(lifecycle)) {
			continue;
		}
		for (const lifecycleEntry of lifecycle) {
			if (!lifecycleEntry || typeof lifecycleEntry !== 'object') {
				continue;
			}
			const entry = lifecycleEntry as { hooks?: Record<string, unknown>[] } & Record<string, unknown>;
			if (Array.isArray(entry.hooks)) {
				for (const hook of entry.hooks) {
					mutateHookCommand(hook);
				}
			} else {
				mutateHookCommand(entry);
			}
		}
	}

	const replacer = (v: unknown): unknown => {
		return typeof v === 'string'
			? v.replaceAll(token, pluginUri.fsPath)
			: undefined;
	};

	return parseHooksJson(hookUri, cloneAndChange(json, replacer), workspaceRoot, userHome);
}


export async function readJsonFile(uri: URI, fileService: IFileService): Promise<unknown | undefined> {
	try {
		const fileContents = await fileService.readFile(uri);
		return parseJSONC(fileContents.value.toString());
	} catch {
		return undefined;
	}
}

export async function pathExists(resource: URI, fileService: IFileService): Promise<boolean> {
	try {
		await fileService.resolve(resource);
		return true;
	} catch {
		return false;
	}
}


const COMMAND_FILE_SUFFIX = '.md';
const RULE_FILE_SUFFIX = '.mdc';
const INSTRUCTION_FILE_SUFFIX = '.instructions.md';

export async function readSkills(
	pluginRoot: URI,
	dirs: readonly URI[],
	fileService: IFileService,
	options?: { readonly childDirectoriesOnly?: boolean; readonly containmentRoot?: URI; readonly deduplicateByName?: boolean },
): Promise<readonly ISkillPluginResource[]> {
	const seen = new Set<string>();
	const skills: ISkillPluginResource[] = [];

	const addSkill = async (name: string, skillMd: URI) => {
		if (options?.containmentRoot && !await isResolvedWithin(options.containmentRoot, skillMd, fileService)) {
			return;
		}
		let description: string | undefined;
		let invocationFlags: ReturnType<typeof toSkillInvocationFlags> = {};
		try {
			const parsedInfo = await parseSkillFile(skillMd, fileService);
			description = parsedInfo.description;
			name = parsedInfo.name || name;
			invocationFlags = toSkillInvocationFlags(parsedInfo.userInvocable, parsedInfo.disableModelInvocation);
		} catch {
		}
		if (options?.deduplicateByName !== false && seen.has(name)) {
			return;
		}
		seen.add(name);
		skills.push({ uri: skillMd, name, ...(description ? { description } : {}), ...invocationFlags });
	};

	await Promise.all(dirs.map(async dir => {
		if (!options?.childDirectoriesOnly) {
			const skillMd = URI.joinPath(dir, 'SKILL.md');
			if (await pathExists(skillMd, fileService)) {
				await addSkill(basename(dir), skillMd);
				return;
			}
		}

		let stat;
		try {
			stat = await fileService.resolve(dir);
		} catch {
			return;
		}

		if (!stat.isDirectory || !stat.children) {
			return;
		}

		await Promise.all(stat.children.map(async child => {
			const childSkillMd = URI.joinPath(child.resource, 'SKILL.md');
			if (await pathExists(childSkillMd, fileService)) {
				await addSkill(basename(child.resource), childSkillMd);
			}
		}));
	}));

	if (!options?.childDirectoriesOnly && skills.length === 0) {
		const rootSkillMd = URI.joinPath(pluginRoot, 'SKILL.md');
		if (await pathExists(rootSkillMd, fileService)) {
			await addSkill(basename(pluginRoot), rootSkillMd);
		}
	}

	skills.sort((a, b) => a.name.localeCompare(b.name));
	return skills;
}

export async function readPluginSkills(pluginRoot: URI, dirs: readonly URI[], format: IPluginFormatConfig, fileService: IFileService): Promise<readonly ISkillPluginResource[]> {
	return readSkills(pluginRoot, dirs, fileService, format.format === PluginFormat.AgentPlugin
		? { childDirectoriesOnly: true, containmentRoot: pluginRoot }
		: undefined);
}

async function isResolvedWithin(root: URI, resource: URI, fileService: IFileService): Promise<boolean> {
	try {
		const [resolvedRoot, resolvedResource] = await Promise.all([
			fileService.realpath(root),
			fileService.realpath(resource),
		]);
		return isEqualOrParent(resolvedResource ?? normalizePath(resource), resolvedRoot ?? normalizePath(root));
	} catch {
		return false;
	}
}

export async function readMarkdownComponents(
	dirs: readonly URI[],
	fileService: IFileService,
	options?: { readonly containmentRoot?: URI },
): Promise<readonly INamedPluginResource[]> {
	const seen = new Set<string>();
	const items: INamedPluginResource[] = [];

	const addItem = async (name: string, uri: URI) => {
		if (options?.containmentRoot && !await isResolvedWithin(options.containmentRoot, uri, fileService)) {
			return;
		}
		if (!seen.has(name)) {
			seen.add(name);
			items.push({ uri, name });
		}
	};

	for (const dir of dirs) {
		let stat;
		try {
			stat = await fileService.resolve(dir);
		} catch {
			continue;
		}

		if (stat.isFile && extname(dir).toLowerCase() === COMMAND_FILE_SUFFIX) {
			await addItem(basename(dir).slice(0, -COMMAND_FILE_SUFFIX.length), dir);
			continue;
		}

		if (!stat.isDirectory || !stat.children) {
			continue;
		}

		for (const child of stat.children) {
			if (!child.isFile || extname(child.resource).toLowerCase() !== COMMAND_FILE_SUFFIX) {
				continue;
			}
			await addItem(basename(child.resource).slice(0, -COMMAND_FILE_SUFFIX.length), child.resource);
		}
	}

	items.sort((a, b) => a.name.localeCompare(b.name));
	return items;
}

function getInstructionFileName(resource: URI): string | undefined {
	const fileName = basename(resource);
	const lowerName = fileName.toLowerCase();
	if (lowerName.endsWith(RULE_FILE_SUFFIX)) {
		return fileName.slice(0, -RULE_FILE_SUFFIX.length);
	}
	if (lowerName.endsWith(INSTRUCTION_FILE_SUFFIX)) {
		return fileName.slice(0, -INSTRUCTION_FILE_SUFFIX.length);
	}
	return undefined;
}

export async function readInstructionComponents(
	dirs: readonly URI[],
	fileService: IFileService,
	options?: { readonly containmentRoot?: URI },
): Promise<readonly INamedPluginResource[]> {
	const seen = new Set<string>();
	const items: INamedPluginResource[] = [];

	const addItem = async (name: string, uri: URI) => {
		if (options?.containmentRoot && !await isResolvedWithin(options.containmentRoot, uri, fileService)) {
			return;
		}
		if (!seen.has(name)) {
			seen.add(name);
			items.push({ uri, name });
		}
	};

	for (const dir of dirs) {
		let stat;
		try {
			stat = await fileService.resolve(dir);
		} catch {
			continue;
		}

		if (stat.isFile) {
			const instructionName = getInstructionFileName(dir);
			if (instructionName) {
				await addItem(instructionName, dir);
			}
			continue;
		}

		if (!stat.isDirectory || !stat.children) {
			continue;
		}

		for (const child of stat.children) {
			if (!child.isFile) {
				continue;
			}
			const instructionName = getInstructionFileName(child.resource);
			if (instructionName) {
				await addItem(instructionName, child.resource);
			}
		}
	}

	items.sort((a, b) => a.name.localeCompare(b.name));
	return items;
}

export async function readAgentComponents(
	dirs: readonly URI[],
	fileService: IFileService,
	options?: { readonly containmentRoot?: URI },
): Promise<readonly IAgentPluginResource[]> {
	const files = await readMarkdownComponents(dirs, fileService, options);
	if (files.length === 0) {
		return files;
	}
	const enriched = await Promise.all(files.map(async file => {
		try {
			const parsed = await parseAgentFile(file.uri, fileService);
			return {
				uri: file.uri,
				name: parsed.name || file.name,
				...(parsed.description ? { description: parsed.description } : {}),
				...(parsed.model ? { model: parsed.model } : {}),
				...(parsed.tools?.length ? { tools: parsed.tools } : {}),
				...(parsed.disableModelInvocation ? { disableModelInvocation: true } : {}),
				...(parsed.userInvocable === false ? { disableUserInvocation: true } : {}),
			} satisfies IAgentPluginResource;
		} catch {
			return file;
		}
	}));
	const seen = new Set<string>();
	const result: IAgentPluginResource[] = [];
	for (const item of enriched) {
		if (seen.has(item.name)) {
			continue;
		}
		seen.add(item.name);
		result.push(item);
	}
	result.sort((a, b) => a.name.localeCompare(b.name));
	return result;
}

export async function parseAgentFile(uri: URI, fileService: IFileService): Promise<{ name: string; description?: string; userInvocable?: boolean; model?: string; tools?: readonly string[]; disableModelInvocation?: boolean }> {
	const nameFromFile = basename(uri).replace(/(\.agent)?\.md$/i, '');
	try {
		const content = await fileService.readFile(uri);
		const frontmatter = parseFrontMatter(content.value.toString());
		const name = frontmatter?.getStringValue('name')?.trim() || nameFromFile;
		const description = frontmatter?.getStringValue('description')?.trim();
		const userInvocable = frontmatter?.getBooleanValue('user-invocable');
		const model = frontmatter?.getStringArrayValue('model')?.map(value => value.trim()).find(Boolean);
		const tools = frontmatter?.getStringArrayValue('tools')?.map(value => value.trim()).filter(Boolean);
		const infer = frontmatter?.getBooleanValue('infer');
		const disableModelInvocation = resolveAgentDisableModelInvocation(infer, frontmatter?.getBooleanValue('disable-model-invocation'));
		return { name, description, userInvocable, model, tools, disableModelInvocation };
	} catch {
		return { name: nameFromFile };
	}
}

export function resolveAgentDisableModelInvocation(infer: boolean | undefined, disableModelInvocation: boolean | undefined, fallback?: boolean): boolean | undefined {
	return infer !== undefined ? !infer : (disableModelInvocation ?? fallback);
}

export async function parseSkillFile(uri: URI, fileService: IFileService): Promise<{ name: string; description?: string; userInvocable?: boolean; disableModelInvocation?: boolean }> {
	try {
		const content = await fileService.readFile(uri);
		const frontmatter = parseFrontMatter(content.value.toString());
		const name = frontmatter?.getStringValue('name')?.trim() || basename(dirname(uri));
		const description = frontmatter?.getStringValue('description')?.trim();
		const userInvocable = frontmatter?.getBooleanValue('user-invocable');
		const disableModelInvocation = frontmatter?.getBooleanValue('disable-model-invocation');
		return { name, description, userInvocable, disableModelInvocation };
	} catch {
		return { name: basename(dirname(uri)) };
	}
}

export function toSkillInvocationFlags(userInvocable: boolean | undefined, disableModelInvocation: boolean | undefined): { readonly disableUserInvocation?: boolean; readonly disableModelInvocation?: boolean } {
	return {
		...(userInvocable === false ? { disableUserInvocation: true } : {}),
		...(disableModelInvocation === true ? { disableModelInvocation: true } : {}),
	};
}

export async function parseRuleFile(uri: URI, fileService: IFileService): Promise<{ name: string; description?: string; globs?: string[]; alwaysApply?: boolean }> {
	const nameFromFile = basename(uri).replace(/(\.instructions)?\.md$/i, '');
	try {
		const content = await fileService.readFile(uri);
		const frontmatter = parseFrontMatter(content.value.toString());
		const name = frontmatter?.getStringValue('name')?.trim() || nameFromFile;
		const description = frontmatter?.getStringValue('description')?.trim();
		const globs = frontmatter?.getStringArrayValue('globs') ?? frontmatter?.getStringArrayValue('applyTo') ?? frontmatter?.getStringArrayValue('paths') ?? undefined;
		const alwaysApply = frontmatter?.getBooleanValue('alwaysApply');
		return { name, description, globs, alwaysApply };
	} catch {
		return { name: nameFromFile };
	}
}

async function readHooks(
	pluginUri: URI,
	paths: readonly URI[],
	formatConfig: IPluginFormatConfig,
	fileService: IFileService,
	workspaceRoot: URI | undefined,
	userHome: URI,
): Promise<readonly IParsedHookGroup[]> {
	for (const hookPath of paths) {
		if (formatConfig.format === PluginFormat.AgentPlugin && !await isResolvedWithin(pluginUri, hookPath, fileService)) {
			continue;
		}
		const json = await readJsonFile(hookPath, fileService);
		if (!json) {
			continue;
		}

		return formatConfig.parseHooks(hookPath, json, pluginUri, workspaceRoot, userHome);
	}
	return [];
}

async function readMcpServers(
	pluginUri: URI,
	paths: readonly URI[],
	formatConfig: IPluginFormatConfig,
	fileService: IFileService,
): Promise<readonly IMcpServerDefinition[]> {
	const merged = new Map<string, IMcpServerDefinition>();
	for (const mcpPath of paths) {
		if (formatConfig.format === PluginFormat.AgentPlugin && !await isResolvedWithin(pluginUri, mcpPath, fileService)) {
			continue;
		}
		const json = await readJsonFile(mcpPath, fileService);
		for (const def of parseMcpServerDefinitionMap(mcpPath, json, pluginUri, formatConfig)) {
			if (!merged.has(def.name)) {
				merged.set(def.name, def);
			}
		}
	}
	return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function readPluginMcpServers(
	pluginUri: URI,
	paths: readonly URI[],
	format: IPluginFormatConfig,
	fileService: IFileService,
): Promise<readonly IMcpServerDefinition[]> {
	return readMcpServers(pluginUri, paths, format, fileService);
}

export function parseMcpServerDefinitionMap(
	definitionURI: URI,
	raw: unknown,
	pluginRoot: URI,
	formatConfig: IPluginFormatConfig,
): IMcpServerDefinition[] {
	const mcpServers = resolveMcpServersMap(raw);
	if (!mcpServers) {
		return [];
	}

	const pluginFsPath = pluginRoot.fsPath;
	const definitions: IMcpServerDefinition[] = [];
	for (const [name, configValue] of Object.entries(mcpServers)) {
		const configuration = normalizeMcpServerConfiguration(configValue);
		if (!configuration) {
			continue;
		}

		let def: IMcpServerDefinition = {
			name,
			configuration,
			...(formatConfig.format !== PluginFormat.AgentPlugin && { defaultCwd: pluginRoot }),
			uri: definitionURI,
			customization: makeMcpServerCustomization(definitionURI, name),
		};
		def = interpolateMcpPluginRoot(def, pluginFsPath, formatConfig.pluginRootTokens, formatConfig.pluginRootEnvVars);
		if (formatConfig.format !== PluginFormat.AgentPlugin) {
			def = convertBareEnvVarsToVsCodeSyntax(def);
		}
		definitions.push(def);
	}

	return definitions;
}


export async function parsePlugin(
	pluginUri: URI,
	fileService: IFileService,
	workspaceRoot: URI | undefined,
	userHome: URI,
	boundaryUri?: URI,
): Promise<IParsedPlugin> {
	const formatConfig = await detectPluginFormat(pluginUri, fileService);

	const manifest = await readPluginManifest(pluginUri, formatConfig, fileService);
	if (formatConfig.requiresManifest && !manifest) {
		throw new Error(`Plugin manifest '${joinPath(pluginUri, formatConfig.manifestPath).toString()}' is missing`);
	}

	const hooksSection = getPluginManifestComponent(formatConfig, 'hooks', manifest);
	const mcpSection = getPluginManifestComponent(formatConfig, 'mcpServers', manifest);
	const skillsSection = getPluginManifestComponent(formatConfig, 'skills', manifest);
	const agentsSection = getPluginManifestComponent(formatConfig, 'agents', manifest);
	const rulesSection = getPluginManifestComponent(formatConfig, 'rules', manifest);
	const hookDirs = resolvePluginComponentDirs(pluginUri, formatConfig, 'hooks', formatConfig.hookConfigPath, hooksSection, boundaryUri);
	const mcpDirs = resolvePluginComponentDirs(pluginUri, formatConfig, 'mcpServers', '.mcp.json', mcpSection, boundaryUri);
	const skillDirs = resolvePluginComponentDirs(pluginUri, formatConfig, 'skills', 'skills', skillsSection, boundaryUri);
	const agentDirs = resolvePluginComponentDirs(pluginUri, formatConfig, 'agents', 'agents', agentsSection, boundaryUri);
	const instructionDirs = resolvePluginComponentDirs(pluginUri, formatConfig, 'rules', 'rules', rulesSection, boundaryUri);

	let embeddedMcp: IMcpServerDefinition[] = [];
	if (mcpSection && typeof mcpSection === 'object' && !Array.isArray(mcpSection) && !(hasKey(mcpSection, { paths: true }))) {
		embeddedMcp = parseMcpServerDefinitionMap(
			joinPath(pluginUri, formatConfig.manifestPath),
			{ mcpServers: mcpSection },
			pluginUri,
			formatConfig,
		);
	}

	let embeddedHooks: IParsedHookGroup[] = [];
	if (hooksSection && typeof hooksSection === 'object' && !Array.isArray(hooksSection) && !(hasKey(hooksSection, { paths: true }))) {
		const manifestUri = joinPath(pluginUri, formatConfig.manifestPath);
		embeddedHooks = formatConfig.parseHooks(manifestUri, hooksSection, pluginUri, workspaceRoot, userHome);
	}

	const [hooks, mcpServers, skills, agents, instructions] = await Promise.all([
		embeddedHooks.length > 0
			? Promise.resolve(embeddedHooks)
			: readHooks(pluginUri, hookDirs, formatConfig, fileService, workspaceRoot, userHome),
		embeddedMcp.length > 0
			? Promise.resolve(embeddedMcp)
			: readPluginMcpServers(pluginUri, mcpDirs, formatConfig, fileService),
		readPluginSkills(pluginUri, skillDirs, formatConfig, fileService),
		readAgentComponents(agentDirs, fileService, formatConfig.format === PluginFormat.AgentPlugin ? { containmentRoot: pluginUri } : undefined),
		readInstructionComponents(instructionDirs, fileService, formatConfig.format === PluginFormat.AgentPlugin ? { containmentRoot: pluginUri } : undefined),
	]);

	return {
		format: formatConfig.format,
		hooks,
		mcpServers,
		skills: skills.map(toParsedSkill),
		agents: agents.map(toParsedAgent),
		instructions: instructions.map(toParsedRule),
	};
}

export function toParsedAgent(resource: IAgentPluginResource): IParsedAgent {
	return { ...resource, customization: makeAgentCustomization(resource) };
}

export function toParsedSkill(resource: ISkillPluginResource): IParsedSkill {
	return { ...resource, customization: makeSkillCustomization(resource) };
}

function toParsedRule(resource: INamedPluginResource): IParsedRule {
	return { ...resource, customization: makeRuleCustomization(resource) };
}
