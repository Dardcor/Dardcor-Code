/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServerType, type IMcpServerConfiguration } from '../../../mcp/common/mcpPlatformTypes.js';
import type { URI } from '../../../../base/common/uri.js';
import { NKeyMap } from '../../../../base/common/map.js';
import { McpServerStatus, type McpServerState } from '../../common/state/protocol/channels-session/state.js';
import type { ISdkMcpServer } from '../shared/mcpCustomizationController.js';
import { resolveMcpServerWorkingDirectory } from '../shared/mcpServerWorkingDirectory.js';
import type { McpServerStartupState } from './protocol/generated/v2/McpServerStartupState.js';
import type { McpServerStatus as CodexMcpServerStatus } from './protocol/generated/v2/McpServerStatus.js';
import type { Resource } from './protocol/generated/Resource.js';
import type { ResourceTemplate } from './protocol/generated/ResourceTemplate.js';
import type { Tool } from './protocol/generated/Tool.js';

export interface ICodexMcpServerEntry {
	readonly state: McpServerState;
	readonly tools: readonly Tool[];
	readonly resources: readonly Resource[];
	readonly resourceTemplates: readonly ResourceTemplate[];
}

interface ICodexThreadMcpServerEntry {
	readonly name: string;
	readonly entry: ICodexMcpServerEntry;
}

export class CodexMcpInventory {
	private readonly _global = new Map<string, ICodexMcpServerEntry>();
	private readonly _byThread = new NKeyMap<ICodexThreadMcpServerEntry, [string, string]>();

	forThread(threadId: string | undefined): Map<string, ICodexMcpServerEntry> {
		const result = new Map(this._global);
		if (threadId !== undefined) {
			for (const scoped of this._byThread.getAll(threadId)) {
				result.set(scoped.name, scoped.entry);
			}
		}
		return result;
	}

	forScope(threadId: string | null): Map<string, ICodexMcpServerEntry> {
		if (threadId === null) {
			return new Map(this._global);
		}
		const result = new Map<string, ICodexMcpServerEntry>();
		for (const scoped of this._byThread.getAll(threadId)) {
			result.set(scoped.name, scoped.entry);
		}
		return result;
	}

	replace(threadId: string | null, entries: ReadonlyMap<string, ICodexMcpServerEntry>): void {
		if (threadId === null) {
			this._global.clear();
			for (const [name, entry] of entries) {
				this._global.set(name, entry);
			}
			return;
		}
		this._byThread.deleteAll(threadId);
		for (const [name, entry] of entries) {
			this._byThread.set({ name, entry }, threadId, name);
		}
	}

	setState(threadId: string | null, name: string, state: McpServerState): void {
		const previous = threadId === null
			? this._global.get(name)
			: this._byThread.get(threadId, name)?.entry ?? this._global.get(name);
		const entry: ICodexMcpServerEntry = {
			state,
			tools: previous?.tools ?? [],
			resources: previous?.resources ?? [],
			resourceTemplates: previous?.resourceTemplates ?? [],
		};
		if (threadId === null) {
			this._global.set(name, entry);
		} else {
			this._byThread.set({ name, entry }, threadId, name);
		}
	}

	hasThreadEntry(threadId: string, name: string): boolean {
		return this._byThread.get(threadId, name) !== undefined;
	}

	deleteThread(threadId: string): void {
		this._byThread.deleteAll(threadId);
	}

	clear(): void {
		this._global.clear();
		this._byThread.clear();
	}
}

export function translateCodexMcpStartupState(status: McpServerStartupState, error: string | null | undefined): McpServerState {
	switch (status) {
		case 'ready':
			return { kind: McpServerStatus.Ready };
		case 'starting':
			return { kind: McpServerStatus.Starting };
		case 'failed':
			return {
				kind: McpServerStatus.Error,
				error: { errorType: 'mcp-server-failed', message: error ?? 'MCP server failed to start' },
			};
		case 'cancelled':
			return { kind: McpServerStatus.Stopped };
		default:
			return { kind: McpServerStatus.Stopped };
	}
}

export function codexToolMapToArray(tools: CodexMcpServerStatus['tools']): Tool[] {
	const out: Tool[] = [];
	for (const key of Object.keys(tools)) {
		const tool = tools[key];
		if (tool) {
			out.push(tool);
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

export function codexMcpStatusToEntry(status: CodexMcpServerStatus): ICodexMcpServerEntry {
	return {
		state: { kind: McpServerStatus.Ready },
		tools: codexToolMapToArray(status.tools),
		resources: status.resources,
		resourceTemplates: status.resourceTemplates,
	};
}

export function codexMcpListToInventory(data: readonly CodexMcpServerStatus[]): Map<string, ICodexMcpServerEntry> {
	const inventory = new Map<string, ICodexMcpServerEntry>();
	for (const status of data) {
		inventory.set(status.name, codexMcpStatusToEntry(status));
	}
	return inventory;
}

export function inventoryToSdkServers(inventory: ReadonlyMap<string, ICodexMcpServerEntry>): ISdkMcpServer[] {
	const out: ISdkMcpServer[] = [];
	for (const [name, entry] of inventory) {
		out.push({ name, state: entry.state });
	}
	return out;
}

export function buildCodexMcpReadResult(method: string, entry: ICodexMcpServerEntry): { readonly handled: true; readonly result: unknown } | { readonly handled: false } {
	switch (method) {
		case 'tools/list':
			return { handled: true, result: { tools: entry.tools } };
		case 'resources/list':
			return { handled: true, result: { resources: entry.resources } };
		case 'resources/templates/list':
			return { handled: true, result: { resourceTemplates: entry.resourceTemplates } };
		default:
			return { handled: false };
	}
}

export function codexMcpToolsChanged(previous: ICodexMcpServerEntry | undefined, next: ICodexMcpServerEntry | undefined): boolean {
	const a = (previous?.tools ?? []).map(t => t.name).sort();
	const b = (next?.tools ?? []).map(t => t.name).sort();
	if (a.length !== b.length) {
		return true;
	}
	return a.some((name, i) => name !== b[i]);
}


export interface ICodexMcpServerConfigJson {
	command?: string;
	args?: readonly string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	http_headers?: Record<string, string>;
}

export function isSupportedMcpServerConfiguration(value: unknown): value is IMcpServerConfiguration {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as { type?: unknown; command?: unknown; url?: unknown };
	if (candidate.type === McpServerType.LOCAL) {
		return typeof candidate.command === 'string';
	}
	if (candidate.type === McpServerType.REMOTE) {
		return typeof candidate.url === 'string';
	}
	return false;
}

function toCodexStringRecord(record: Record<string, unknown> | undefined): Record<string, string> {
	const result: Record<string, string> = {};
	if (!record) {
		return result;
	}
	for (const [key, value] of Object.entries(record)) {
		if (value !== null && value !== undefined) {
			result[key] = String(value);
		}
	}
	return result;
}

function toCodexStringArray(values: readonly unknown[] | undefined): string[] {
	if (!Array.isArray(values)) {
		return [];
	}
	return values.filter(v => v !== null && v !== undefined).map(v => String(v));
}

export function toCodexMcpServerJson(config: IMcpServerConfiguration, defaultCwd?: URI): ICodexMcpServerConfigJson {
	if (config.type === McpServerType.LOCAL) {
		const out: ICodexMcpServerConfigJson = { command: config.command };
		const args = toCodexStringArray(config.args);
		if (args.length > 0) {
			out.args = args;
		}
		const env = toCodexStringRecord(config.env);
		if (Object.keys(env).length > 0) {
			out.env = env;
		}
		if (typeof config.cwd === 'string' || defaultCwd) {
			out.cwd = resolveMcpServerWorkingDirectory(config.cwd, defaultCwd);
		}
		return out;
	}
	const out: ICodexMcpServerConfigJson = { url: config.url };
	const headers = toCodexStringRecord(config.headers);
	if (Object.keys(headers).length > 0) {
		out.http_headers = headers;
	}
	return out;
}

export function codexMcpServersFromConfig(servers: Record<string, unknown> | undefined): Record<string, ICodexMcpServerConfigJson> {
	const out: Record<string, ICodexMcpServerConfigJson> = {};
	for (const [name, config] of Object.entries(servers ?? {})) {
		if (isSupportedMcpServerConfiguration(config)) {
			out[name] = toCodexMcpServerJson(config);
		}
	}
	return out;
}



export function normalizeCodexMcpResourceUrl(value: string): string | undefined {
	if (!URL.canParse(value)) {
		return undefined;
	}
	const url = new URL(value);
	url.hash = '';
	url.pathname = url.pathname.replace(/\/+$/, '');
	return url.href;
}

export function codexStartupErrorNeedsAuth(error: string | null | undefined): boolean {
	if (!error) {
		return false;
	}
	return /not logged in|mcp login|log in to|unauthori[sz]ed|requires? (?:authentication|authorization|login)|\b401\b/i.test(error);
}

export function injectCodexMcpAuthTokens(
	servers: Record<string, ICodexMcpServerConfigJson>,
	tokensByNormalizedUrl: ReadonlyMap<string, string>,
): Record<string, ICodexMcpServerConfigJson> {
	if (tokensByNormalizedUrl.size === 0) {
		return servers;
	}
	const out: Record<string, ICodexMcpServerConfigJson> = {};
	for (const [name, server] of Object.entries(servers)) {
		const normalized = server.url !== undefined ? normalizeCodexMcpResourceUrl(server.url) : undefined;
		const token = normalized !== undefined ? tokensByNormalizedUrl.get(normalized) : undefined;
		out[name] = token !== undefined
			? { ...server, http_headers: { ...withoutAuthorizationHeaders(server.http_headers), Authorization: `Bearer ${token}` } }
			: server;
	}
	return out;
}

function withoutAuthorizationHeaders(headers: Record<string, string> | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (headers) {
		for (const [key, value] of Object.entries(headers)) {
			if (key.toLowerCase() !== 'authorization') {
				out[key] = value;
			}
		}
	}
	return out;
}

