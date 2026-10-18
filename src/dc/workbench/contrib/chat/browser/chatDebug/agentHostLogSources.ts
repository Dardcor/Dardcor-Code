/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, type VSBufferReadableStream } from '../../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { agentHostAuthority, toAgentHostUri } from '../../../../../platform/agentHost/common/agentHostUri.js';
import { AgentHostAhpJsonlLoggingSettingId, IAgentHostService } from '../../../../../platform/agentHost/common/agentService.js';
import { AGENT_HOST_LOG_OUTPUT_CHANNEL_ID, IRemoteAgentHostConnectionInfo, IRemoteAgentHostService, remoteAgentHostLogOutputChannelId } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IFileService, type IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IOutputService } from '../../../../services/output/common/output.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { buildLocalCopilotLogsUri, buildRemoteCopilotLogsUri, COPILOT_CLI_LOCAL_AH_SCHEME, getCopilotCliSessionRawId, parseRemoteAuthorityFromScheme, resolveEventsUri } from '../copilotCliEventsUri.js';

const WINDOW_LOG_CHANNEL_ID = 'rendererLog';
const SHARED_PROCESS_LOG_CHANNEL_ID = 'shared';
export const MAX_COPILOT_LOG_SCAN_FILES = 10;
export const MAX_COPILOT_LOG_SCAN_FILE_SIZE = 1024 * 1024 * 1024;
const MAX_COPILOT_LOG_VIEW_FILE_SIZE = 10 * 1024 * 1024;
export const DEFAULT_RAW_LOG_VIEW_CAP_BYTES = 2 * 1024 * 1024;

export interface ICopilotLogFile {
	readonly path: string;
	readonly resource: URI;
	readonly size: number;
}

export const enum AgentHostLogSourceKind {
	Events = 'events',
	WireLog = 'wire',
	CliLog = 'cliLog',
	ProcessChannel = 'processChannel',
	RemoteProcessLog = 'remoteProcessLog',
}

export interface IAgentHostLogSource {
	readonly id: string;
	readonly label: string;
	readonly kind: AgentHostLogSourceKind;
	readonly isRemote: boolean;
	readonly resource?: URI;
	readonly channelId?: string;
	readonly cliLogs?: { readonly dir: URI; readonly rawSessionId: string };
	readonly remoteConnection?: IRemoteAgentHostConnectionInfo;
}

export interface IAgentHostLogSourceServices {
	readonly pathService: IPathService;
	readonly agentHostService: IAgentHostService;
	readonly remoteAgentHostService: IRemoteAgentHostService;
	readonly outputService: IOutputService;
	readonly fileService: IFileService;
	readonly textModelService: ITextModelService;
	readonly configurationService: IConfigurationService;
	readonly environmentService: IEnvironmentService;
	readonly productService: IProductService;
	readonly logService: ILogService;
}

export interface IAgentHostLogContent {
	readonly text: string;
	readonly totalBytes: number | undefined;
	readonly truncated: boolean;
	readonly fileResource?: URI;
}

export function isAgentHostSession(resource: URI | undefined): boolean {
	if (!resource) {
		return false;
	}
	return resource.scheme === COPILOT_CLI_LOCAL_AH_SCHEME || !!parseRemoteAuthorityFromScheme(resource.scheme);
}

export function getRemoteConnectionForSession(sessionResource: URI, connections: readonly IRemoteAgentHostConnectionInfo[]): IRemoteAgentHostConnectionInfo | undefined {
	const authority = parseRemoteAuthorityFromScheme(sessionResource.scheme);
	return authority ? connections.find(connection => agentHostAuthority(connection.address) === authority) : undefined;
}

export function sanitizeFilePart(value: string): string {
	return value.replace(/[\\/:\*\?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'connection';
}

export async function enumerateAgentHostLogSources(
	services: IAgentHostLogSourceServices,
	sessionResource: URI | undefined,
): Promise<IAgentHostLogSource[]> {
	if (!isAgentHostSession(sessionResource) || !sessionResource) {
		return [];
	}

	const { pathService, agentHostService, remoteAgentHostService, outputService, fileService, configurationService, environmentService } = services;
	const userHome = pathService.userHome({ preferLocal: true });
	const isLocal = sessionResource.scheme === COPILOT_CLI_LOCAL_AH_SCHEME;
	const remoteConnection = isLocal ? undefined : getRemoteConnectionForSession(sessionResource, remoteAgentHostService.connections);

	const sources: IAgentHostLogSource[] = [];

	const eventsResult = resolveEventsUri(
		sessionResource,
		userHome,
		authority => remoteAgentHostService.connections.find(c => agentHostAuthority(c.address) === authority),
	);
	if (eventsResult.kind === 'ok') {
		sources.push({
			id: 'events',
			label: localize('agentHostLogs.events', "Session Events (events.jsonl)"),
			kind: AgentHostLogSourceKind.Events,
			isRemote: !isLocal,
			resource: eventsResult.resource,
		});
	}

	if (configurationService.getValue<boolean>(AgentHostAhpJsonlLoggingSettingId)) {
		const nameToken = isLocal
			? sanitizeFilePart(agentHostService.clientId)
			: remoteConnection ? sanitizeFilePart(remoteConnection.address) : undefined;
		const wireFiles = await listWireLogFiles(fileService, environmentService, nameToken);
		wireFiles.forEach((file, index) => {
			sources.push({
				id: `wire:${file.resource.toString()}`,
				label: index === 0
					? localize('agentHostLogs.wire', "AHP Log")
					: localize('agentHostLogs.wireN', "AHP Log — {0}", file.name),
				kind: AgentHostLogSourceKind.WireLog,
				isRemote: !isLocal,
				resource: file.resource,
			});
		});
	}

	const channelIds: string[] = [];
	if (isLocal) {
		channelIds.push(AGENT_HOST_LOG_OUTPUT_CHANNEL_ID);
	} else if (remoteConnection) {
		channelIds.push(remoteAgentHostLogOutputChannelId(remoteConnection.address));
	}
	channelIds.push(WINDOW_LOG_CHANNEL_ID, SHARED_PROCESS_LOG_CHANNEL_ID);
	for (const channelId of channelIds) {
		const descriptor = outputService.getChannelDescriptor(channelId);
		if (!descriptor) {
			continue;
		}
		sources.push({
			id: `channel:${channelId}`,
			label: localize('agentHostLogs.channel', "{0} (Log)", descriptor.label),
			kind: AgentHostLogSourceKind.ProcessChannel,
			isRemote: !isLocal,
			channelId,
		});
	}

	if (remoteConnection?.defaultDirectory) {
		sources.push({
			id: 'remoteProcessLog',
			label: localize('agentHostLogs.remoteProcess', "Remote Agent Host Log (agenthost.log)"),
			kind: AgentHostLogSourceKind.RemoteProcessLog,
			isRemote: true,
			remoteConnection,
		});
	}

	const rawSessionId = getCopilotCliSessionRawId(sessionResource);
	if (rawSessionId) {
		const copilotLogsDir = isLocal
			? buildLocalCopilotLogsUri(userHome)
			: remoteConnection ? buildRemoteCopilotLogsUri(remoteConnection) : undefined;
		if (copilotLogsDir) {
			sources.push({
				id: 'cliLog',
				label: localize('agentHostLogs.cliLog', "Dardcor AI CLI Logs"),
				kind: AgentHostLogSourceKind.CliLog,
				isRemote: !isLocal,
				cliLogs: { dir: copilotLogsDir, rawSessionId },
			});
		}
	}

	return sources;
}

export async function readAgentHostLogSourceContent(
	source: IAgentHostLogSource,
	services: IAgentHostLogSourceServices,
	capBytes: number = DEFAULT_RAW_LOG_VIEW_CAP_BYTES,
): Promise<IAgentHostLogContent | undefined> {
	const { fileService, outputService, textModelService, productService, logService } = services;

	switch (source.kind) {
		case AgentHostLogSourceKind.Events:
		case AgentHostLogSourceKind.WireLog: {
			if (!source.resource) {
				return undefined;
			}
			return readFileTail(fileService, source.resource, capBytes);
		}
		case AgentHostLogSourceKind.ProcessChannel: {
			if (!source.channelId) {
				return undefined;
			}
			const channel = outputService.getChannel(source.channelId);
			if (!channel) {
				return undefined;
			}
			const modelRef = await textModelService.createModelReference(channel.uri);
			try {
				const value = modelRef.object.textEditorModel.getValue();
				return tailString(value, capBytes);
			} finally {
				modelRef.dispose();
			}
		}
		case AgentHostLogSourceKind.RemoteProcessLog: {
			if (!source.remoteConnection) {
				return undefined;
			}
			const value = await readRemoteAgentHostLog(source.remoteConnection, productService.serverDataFolderName, fileService);
			return value === undefined ? undefined : tailString(value, capBytes);
		}
		case AgentHostLogSourceKind.CliLog: {
			if (!source.cliLogs) {
				return undefined;
			}
			const files = await readCopilotLogsForSession(source.cliLogs.dir, source.cliLogs.rawSessionId, fileService, logService);
			if (files.length === 0) {
				return { text: '', totalBytes: 0, truncated: false };
			}
			const combined = files.map(f => `===== ${f.path} =====\n${f.contents}`).join('\n\n');
			return tailString(combined, capBytes);
		}
	}
}

async function listWireLogFiles(
	fileService: IFileService,
	environmentService: IEnvironmentService,
	nameToken: string | undefined,
): Promise<{ resource: URI; name: string; mtime: number }[]> {
	const ahpDir = joinPath(environmentService.logsHome, 'ahp');
	let children: IFileStatWithMetadata[] | undefined;
	try {
		children = (await fileService.resolve(ahpDir, { resolveMetadata: true })).children;
	} catch {
		return [];
	}
	const files = (children ?? [])
		.filter(child => !child.isDirectory && child.name.endsWith('.jsonl'))
		.map(child => ({ resource: child.resource, name: child.name, mtime: child.mtime ?? 0 }));

	const matching = nameToken ? files.filter(file => file.name.includes(nameToken)) : [];
	const selected = matching.length > 0 ? matching : files;

	return selected.sort((a, b) => b.mtime - a.mtime);
}

async function readFileTail(fileService: IFileService, resource: URI, capBytes: number): Promise<IAgentHostLogContent> {
	let size: number | undefined;
	try {
		size = (await fileService.resolve(resource, { resolveMetadata: true })).size;
	} catch {
		size = undefined;
	}

	if (size !== undefined && size > capBytes) {
		const content = await fileService.readFile(resource, { position: size - capBytes, length: capBytes });
		let text = content.value.toString();
		const firstNewline = text.indexOf('\n');
		if (firstNewline >= 0) {
			text = text.slice(firstNewline + 1);
		}
		return { text, totalBytes: size, truncated: true, fileResource: resource };
	}

	const content = await fileService.readFile(resource, { limits: { size: capBytes } });
	return { text: content.value.toString(), totalBytes: size, truncated: false, fileResource: resource };
}

function tailString(value: string, capBytes: number): IAgentHostLogContent {
	if (value.length <= capBytes) {
		return { text: value, totalBytes: value.length, truncated: false };
	}
	let text = value.slice(value.length - capBytes);
	const firstNewline = text.indexOf('\n');
	if (firstNewline >= 0) {
		text = text.slice(firstNewline + 1);
	}
	return { text, totalBytes: value.length, truncated: true };
}

export async function readCopilotLogsForSession(
	logsDir: URI,
	rawSessionId: string,
	fileService: IFileService,
	logService: ILogService,
): Promise<{ path: string; contents: string }[]> {
	const matchingLogs = await findRelevantCopilotLogs(logsDir, rawSessionId, fileService, logService);
	const files: { path: string; contents: string }[] = [];
	for (const log of matchingLogs) {
		try {
			const content = log.size > MAX_COPILOT_LOG_VIEW_FILE_SIZE
				? await fileService.readFile(log.resource, { position: log.size - MAX_COPILOT_LOG_VIEW_FILE_SIZE, length: MAX_COPILOT_LOG_VIEW_FILE_SIZE })
				: await fileService.readFile(log.resource, { limits: { size: MAX_COPILOT_LOG_VIEW_FILE_SIZE } });
			files.push({ path: log.path, contents: content.value.toString() });
		} catch (error) {
			logService.warn(`[AgentHostLogSources] Failed to read Copilot log '${log.resource.path}': ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return files;
}

export async function findRelevantCopilotLogs(
	logsDir: URI,
	rawSessionId: string | undefined,
	fileService: IFileService,
	logService: ILogService,
): Promise<ICopilotLogFile[]> {
	let children: IFileStatWithMetadata[] | undefined;
	try {
		children = (await fileService.resolve(logsDir, { resolveMetadata: true })).children;
	} catch {
		return [];
	}

	const processLogs = (children ?? [])
		.filter(child => !child.isDirectory && child.name.endsWith('.log'))
		.sort((a, b) => b.mtime - a.mtime)
		.map(child => ({ path: `copilot-logs/${child.name}`, resource: child.resource, size: child.size }));
	const files: ICopilotLogFile[] = [];
	const candidateLogs = processLogs
		.slice(0, MAX_COPILOT_LOG_SCAN_FILES)
		.filter(child => child.size <= MAX_COPILOT_LOG_SCAN_FILE_SIZE);
	if (rawSessionId) {
		for (const candidate of candidateLogs) {
			try {
				if (await logStreamContains(candidate.resource, rawSessionId, fileService)) {
					files.push(candidate);
				}
			} catch (error) {
				logService.warn(`[AgentHostLogSources] Failed to scan Copilot log '${candidate.path}': ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
	return files.length > 0 ? files : processLogs.slice(0, 1);
}

async function logStreamContains(
	resource: URI,
	rawSessionId: string,
	fileService: IFileService,
): Promise<boolean> {
	const tokenSource = new CancellationTokenSource();
	let stream: VSBufferReadableStream;
	try {
		stream = (await fileService.readFileStream(resource, {
			length: MAX_COPILOT_LOG_SCAN_FILE_SIZE,
			limits: { size: MAX_COPILOT_LOG_SCAN_FILE_SIZE },
		}, tokenSource.token)).value;
	} catch (error) {
		tokenSource.dispose(true);
		throw error;
	}
	return new Promise<boolean>((resolve, reject) => {
		let settled = false;
		let previous = '';

		const cleanup = (removeErrorListener: boolean) => {
			stream.removeListener('data', onData);
			stream.removeListener('end', onEnd);
			if (removeErrorListener) {
				stream.removeListener('error', onError);
			}
		};
		const settle = (contains: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			tokenSource.dispose(contains);
			cleanup(!contains);
			resolve(contains);
		};
		const onData = (chunk: VSBuffer) => {
			const text = previous + chunk.toString();
			if (text.includes(rawSessionId)) {
				settle(true);
				return;
			}
			previous = text.slice(Math.max(0, text.length - rawSessionId.length + 1));
		};
		const onError = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			tokenSource.dispose();
			cleanup(true);
			reject(error);
		};
		const onEnd = () => {
			settle(false);
		};

		stream.on('error', onError);
		stream.on('end', onEnd);
		stream.on('data', onData);
	});
}

export async function readRemoteAgentHostLog(
	connection: IRemoteAgentHostConnectionInfo,
	serverDataFolderName: string | undefined,
	fileService: IFileService,
): Promise<string | undefined> {
	const homePath = connection.defaultDirectory;
	if (!homePath) {
		return undefined;
	}
	const authority = agentHostAuthority(connection.address);
	const homeUri = toAgentHostUri(URI.from({ scheme: 'file', path: homePath }), authority);

	const candidates = new Set<string>();
	if (serverDataFolderName) {
		candidates.add(serverDataFolderName);
		if (serverDataFolderName.endsWith('-dev')) {
			candidates.add(serverDataFolderName.slice(0, -'-dev'.length));
		}
	}
	candidates.add('.vscode-server');
	candidates.add('.vscode-server-insiders');
	candidates.add('.vscode-server-oss');
	candidates.add('.vscode-server-exploration');

	let best: { uri: URI; mtime: number } | undefined;
	for (const folderName of candidates) {
		const logsDirUri = joinPath(homeUri, folderName, 'data', 'logs');
		let entries;
		try {
			const stat = await fileService.resolve(logsDirUri, { resolveMetadata: true });
			entries = stat.children;
		} catch {
			continue;
		}
		if (!entries) {
			continue;
		}
		for (const dir of entries) {
			if (!dir.isDirectory) {
				continue;
			}
			const logUri = joinPath(dir.resource, 'agenthost.log');
			let logStat;
			try {
				logStat = await fileService.resolve(logUri, { resolveMetadata: true });
			} catch {
				continue;
			}
			const mtime = logStat.mtime ?? 0;
			if (!best || mtime > best.mtime) {
				best = { uri: logUri, mtime };
			}
		}
	}

	if (!best) {
		return undefined;
	}
	const content = await fileService.readFile(best.uri);
	return content.value.toString();
}
