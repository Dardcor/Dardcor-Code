/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { LRUCache } from '../../../../../base/common/map.js';
import { Schemas } from '../../../../../base/common/network.js';
import { join } from '../../../../../base/common/path.js';
import { isWindows, OperatingSystem } from '../../../../../base/common/platform.js';
import { env } from '../../../../../base/common/process.js';
import { isNumber } from '../../../../../base/common/types.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { FileOperationError, FileOperationResult, IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { GeneralShellType, PosixShellType, TerminalShellType } from '../../../../../platform/terminal/common/terminal.js';
import { IRemoteAgentService } from '../../../../services/remote/common/remoteAgentService.js';
import { TerminalHistorySettingId } from './terminal.history.js';

export interface ITerminalPersistedHistory<T> {
	readonly entries: IterableIterator<[string, T]>;
	add(key: string, value: T): void;
	remove(key: string): void;
	clear(): void;
}

interface ISerializedCache<T> {
	entries: { key: string; value: T }[];
}

const enum Constants {
	DefaultHistoryLimit = 100
}

const enum StorageKeys {
	Entries = 'terminal.history.entries',
	Timestamp = 'terminal.history.timestamp'
}

let directoryHistory: ITerminalPersistedHistory<{ remoteAuthority?: string }> | undefined = undefined;
export function getDirectoryHistory(accessor: ServicesAccessor): ITerminalPersistedHistory<{ remoteAuthority?: string }> {
	if (!directoryHistory) {
		directoryHistory = accessor.get(IInstantiationService).createInstance(TerminalPersistedHistory, 'dirs') as TerminalPersistedHistory<{ remoteAuthority?: string }>;
	}
	return directoryHistory;
}

let commandHistory: ITerminalPersistedHistory<{ shellType: TerminalShellType }> | undefined = undefined;
export function getCommandHistory(accessor: ServicesAccessor): ITerminalPersistedHistory<{ shellType: TerminalShellType | undefined }> {
	if (!commandHistory) {
		commandHistory = accessor.get(IInstantiationService).createInstance(TerminalPersistedHistory, 'commands') as TerminalPersistedHistory<{ shellType: TerminalShellType }>;
	}
	return commandHistory;
}

export class TerminalPersistedHistory<T> extends Disposable implements ITerminalPersistedHistory<T> {
	private readonly _entries: LRUCache<string, T>;
	private _timestamp: number = 0;
	private _isReady = false;
	private _isStale = true;

	get entries(): IterableIterator<[string, T]> {
		this._ensureUpToDate();
		return this._entries.entries();
	}

	constructor(
		private readonly _storageDataKey: string,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		this._entries = new LRUCache<string, T>(this._getHistoryLimit());

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(TerminalHistorySettingId.ShellIntegrationCommandHistory)) {
				this._entries.limit = this._getHistoryLimit();
			}
		}));

		this._register(this._storageService.onDidChangeValue(StorageScope.APPLICATION, this._getTimestampStorageKey(), this._store)(() => {
			if (!this._isStale) {
				this._isStale = this._storageService.getNumber(this._getTimestampStorageKey(), StorageScope.APPLICATION, 0) !== this._timestamp;
			}
		}));
	}

	add(key: string, value: T) {
		this._ensureUpToDate();
		this._entries.set(key, value);
		this._saveState();
	}

	remove(key: string) {
		this._ensureUpToDate();
		this._entries.delete(key);
		this._saveState();
	}

	clear() {
		this._ensureUpToDate();
		this._entries.clear();
		this._saveState();
	}

	private _ensureUpToDate() {
		if (!this._isReady) {
			this._loadState();
			this._isReady = true;
		}

		if (this._isStale) {
			this._entries.clear();
			this._loadState();
			this._isStale = false;
		}
	}

	private _loadState() {
		this._timestamp = this._storageService.getNumber(this._getTimestampStorageKey(), StorageScope.APPLICATION, 0);

		// Load global entries plus
		const serialized = this._loadPersistedState();
		if (serialized) {
			for (const entry of serialized.entries) {
				this._entries.set(entry.key, entry.value);
			}
		}
	}

	private _loadPersistedState(): ISerializedCache<T> | undefined {
		const raw = this._storageService.get(this._getEntriesStorageKey(), StorageScope.APPLICATION);
		if (raw === undefined || raw.length === 0) {
			return undefined;
		}
		let serialized: ISerializedCache<T> | undefined = undefined;
		try {
			serialized = JSON.parse(raw);
		} catch {
			return undefined;
		}
		return serialized;
	}

	private _saveState() {
		const serialized: ISerializedCache<T> = { entries: [] };
		this._entries.forEach((value, key) => serialized.entries.push({ key, value }));
		this._storageService.store(this._getEntriesStorageKey(), JSON.stringify(serialized), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._timestamp = Date.now();
		this._storageService.store(this._getTimestampStorageKey(), this._timestamp, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private _getHistoryLimit() {
		const historyLimit = this._configurationService.getValue(TerminalHistorySettingId.ShellIntegrationCommandHistory);
		return isNumber(historyLimit) ? historyLimit : Constants.DefaultHistoryLimit;
	}

	private _getTimestampStorageKey() {
		return `${StorageKeys.Timestamp}.${this._storageDataKey}`;
	}

	private _getEntriesStorageKey() {
		return `${StorageKeys.Entries}.${this._storageDataKey}`;
	}
}

interface IShellFileHistoryEntry {
	sourceLabel: string;
	sourceResource: URI;
	commands: string[];
}
const shellFileHistory: Map<TerminalShellType | undefined, IShellFileHistoryEntry | null> = new Map();
export async function getShellFileHistory(accessor: ServicesAccessor, shellType: TerminalShellType | undefined): Promise<IShellFileHistoryEntry | undefined> {
	const cached = shellFileHistory.get(shellType);
	if (cached === null) {
		return undefined;
	}
	if (cached !== undefined) {
		return cached;
	}
	let result: IShellFileHistoryEntry | undefined;
	switch (shellType) {
		case PosixShellType.Bash:
			result = await fetchBashHistory(accessor);
			break;
		case GeneralShellType.PowerShell:
			result = await fetchPwshHistory(accessor);
			break;
		case PosixShellType.Zsh:
			result = await fetchZshHistory(accessor);
			break;
		case PosixShellType.Fish:
			result = await fetchFishHistory(accessor);
			break;
		case GeneralShellType.Python:
			result = await fetchPythonHistory(accessor);
			break;
		default: return undefined;
	}
	if (result === undefined) {
		shellFileHistory.set(shellType, null);
		return undefined;
	}
	shellFileHistory.set(shellType, result);
	return result;
}
export function clearShellFileHistory() {
	shellFileHistory.clear();
}

export async function fetchBashHistory(accessor: ServicesAccessor): Promise<IShellFileHistoryEntry | undefined> {
	const fileService = accessor.get(IFileService);
	const remoteAgentService = accessor.get(IRemoteAgentService);
	const remoteEnvironment = await remoteAgentService.getEnvironment();
	if (remoteEnvironment?.os === OperatingSystem.Windows || !remoteEnvironment && isWindows) {
		return undefined;
	}
	const sourceLabel = '~/.bash_history';
	const home = remoteEnvironment?.userHome?.fsPath ?? env['HOME'];
	const resolvedFile = await fetchFileContents(home, '.bash_history', false, fileService, remoteAgentService);
	if (resolvedFile === undefined) {
		return undefined;
	}
	const fileLines = resolvedFile.content.split('\n');
	const result: Set<string> = new Set();
	let currentLine: string;
	let currentCommand: string | undefined = undefined;
	let wrapChar: string | undefined = undefined;
	for (let i = 0; i < fileLines.length; i++) {
		currentLine = fileLines[i];
		if (currentCommand === undefined) {
			currentCommand = currentLine;
		} else {
			currentCommand += `\n${currentLine}`;
		}
		for (let c = 0; c < currentLine.length; c++) {
			if (wrapChar) {
				if (currentLine[c] === wrapChar) {
					wrapChar = undefined;
				}
			} else {
				if (currentLine[c].match(/['"]/)) {
					wrapChar = currentLine[c];
				}
			}
		}
		if (wrapChar === undefined) {
			if (currentCommand.length > 0) {
				result.add(currentCommand.trim());
			}
			currentCommand = undefined;
		}
	}

	return {
		sourceLabel,
		sourceResource: resolvedFile.resource,
		commands: Array.from(result.values())
	};
}

export async function fetchZshHistory(accessor: ServicesAccessor): Promise<IShellFileHistoryEntry | undefined> {
	const fileService = accessor.get(IFileService);
	const remoteAgentService = accessor.get(IRemoteAgentService);
	const remoteEnvironment = await remoteAgentService.getEnvironment();
	if (remoteEnvironment?.os === OperatingSystem.Windows || !remoteEnvironment && isWindows) {
		return undefined;
	}

	const sourceLabel = '~/.zsh_history';
	const home = remoteEnvironment?.userHome?.fsPath ?? env['HOME'];
	const resolvedFile = await fetchFileContents(home, '.zsh_history', false, fileService, remoteAgentService);
	if (resolvedFile === undefined) {
		return undefined;
	}
	const isExtendedHistory = /^:\s\d+:\d+;/.test(resolvedFile.content);
	const fileLines = resolvedFile.content.split(isExtendedHistory ? /\:\s\d+\:\d+;/ : /(?<!\\)\n/);
	const result: Set<string> = new Set();
	for (let i = 0; i < fileLines.length; i++) {
		const sanitized = fileLines[i].replace(/\\\n/g, '\n').trim();
		if (sanitized.length > 0) {
			result.add(sanitized);
		}
	}
	return {
		sourceLabel,
		sourceResource: resolvedFile.resource,
		commands: Array.from(result.values())
	};
}


export async function fetchPythonHistory(accessor: ServicesAccessor): Promise<IShellFileHistoryEntry | undefined> {
	const fileService = accessor.get(IFileService);
	const remoteAgentService = accessor.get(IRemoteAgentService);
	const remoteEnvironment = await remoteAgentService.getEnvironment();

	const sourceLabel = '~/.python_history';
	const home = remoteEnvironment?.userHome?.fsPath ?? env['HOME'];
	const resolvedFile = await fetchFileContents(home, '.python_history', false, fileService, remoteAgentService);

	if (resolvedFile === undefined) {
		return undefined;
	}

	const fileLines = resolvedFile.content.split('\n');
	const result: Set<string> = new Set();

	fileLines.forEach(line => {
		if (line.trim().length > 0) {
			result.add(line.trim());
		}
	});

	return {
		sourceLabel,
		sourceResource: resolvedFile.resource,
		commands: Array.from(result.values())
	};
}

export async function fetchPwshHistory(accessor: ServicesAccessor): Promise<IShellFileHistoryEntry | undefined> {
	const fileService: Pick<IFileService, 'readFile'> = accessor.get(IFileService);
	const remoteAgentService: Pick<IRemoteAgentService, 'getConnection' | 'getEnvironment'> = accessor.get(IRemoteAgentService);
	let folderPrefix: string | undefined;
	let filePath: string;
	const remoteEnvironment = await remoteAgentService.getEnvironment();
	const isFileWindows = remoteEnvironment?.os === OperatingSystem.Windows || !remoteEnvironment && isWindows;
	let sourceLabel: string;
	if (isFileWindows) {
		folderPrefix = env['APPDATA'];
		filePath = 'Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt';
		sourceLabel = `$APPDATA\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt`;
	} else {
		folderPrefix = remoteEnvironment?.userHome?.fsPath ?? env['HOME'];
		filePath = '.local/share/powershell/PSReadline/ConsoleHost_history.txt';
		sourceLabel = `~/${filePath}`;
	}
	const resolvedFile = await fetchFileContents(folderPrefix, filePath, isFileWindows, fileService, remoteAgentService);
	if (resolvedFile === undefined) {
		return undefined;
	}
	const fileLines = resolvedFile.content.split('\n');
	const result: Set<string> = new Set();
	let currentLine: string;
	let currentCommand: string | undefined = undefined;
	let wrapChar: string | undefined = undefined;
	for (let i = 0; i < fileLines.length; i++) {
		currentLine = fileLines[i];
		if (currentCommand === undefined) {
			currentCommand = currentLine;
		} else {
			currentCommand += `\n${currentLine}`;
		}
		if (!currentLine.endsWith('`')) {
			const sanitized = currentCommand.trim();
			if (sanitized.length > 0) {
				result.add(sanitized);
			}
			currentCommand = undefined;
			continue;
		}
		for (let c = 0; c < currentLine.length; c++) {
			if (wrapChar) {
				if (currentLine[c] === wrapChar) {
					wrapChar = undefined;
				}
			} else {
				if (currentLine[c].match(/`/)) {
					wrapChar = currentLine[c];
				}
			}
		}
		if (!wrapChar) {
			const sanitized = currentCommand.trim();
			if (sanitized.length > 0) {
				result.add(sanitized);
			}
			currentCommand = undefined;
		} else {
			currentCommand = currentCommand.replace(/`$/, '');
			wrapChar = undefined;
		}
	}

	return {
		sourceLabel,
		sourceResource: resolvedFile.resource,
		commands: Array.from(result.values())
	};
}

export async function fetchFishHistory(accessor: ServicesAccessor): Promise<IShellFileHistoryEntry | undefined> {
	const fileService = accessor.get(IFileService);
	const remoteAgentService = accessor.get(IRemoteAgentService);
	const remoteEnvironment = await remoteAgentService.getEnvironment();
	if (remoteEnvironment?.os === OperatingSystem.Windows || !remoteEnvironment && isWindows) {
		return undefined;
	}

	const overridenDataHome = env['XDG_DATA_HOME'];


	let folderPrefix: string | undefined;
	let filePath: string;
	let sourceLabel: string;
	if (overridenDataHome) {
		sourceLabel = '$XDG_DATA_HOME/fish/fish_history';
		folderPrefix = env['XDG_DATA_HOME'];
		filePath = 'fish/fish_history';
	} else {
		sourceLabel = '~/.local/share/fish/fish_history';
		folderPrefix = remoteEnvironment?.userHome?.fsPath ?? env['HOME'];
		filePath = '.local/share/fish/fish_history';
	}
	const resolvedFile = await fetchFileContents(folderPrefix, filePath, false, fileService, remoteAgentService);
	if (resolvedFile === undefined) {
		return undefined;
	}

	const result: Set<string> = new Set();
	const cmds = resolvedFile.content.split('\n')
		.filter(x => x.startsWith('- cmd:'))
		.map(x => x.substring(6).trimStart());
	for (let i = 0; i < cmds.length; i++) {
		const sanitized = sanitizeFishHistoryCmd(cmds[i]).trim();
		if (sanitized.length > 0) {
			result.add(sanitized);
		}
	}
	return {
		sourceLabel,
		sourceResource: resolvedFile.resource,
		commands: Array.from(result.values())
	};
}

export function sanitizeFishHistoryCmd(cmd: string): string {
	return repeatedReplace(/(^|[^\\])((?:\\\\)*)(\\n)/g, cmd, '$1$2\n');
}

function repeatedReplace(pattern: RegExp, value: string, replaceValue: string): string {
	let last;
	let current = value;
	while (true) {
		last = current;
		current = current.replace(pattern, replaceValue);
		if (current === last) {
			return current;
		}
	}
}

async function fetchFileContents(
	folderPrefix: string | undefined,
	filePath: string,
	isFileWindows: boolean,
	fileService: Pick<IFileService, 'readFile'>,
	remoteAgentService: Pick<IRemoteAgentService, 'getConnection'>,
): Promise<{ resource: URI; content: string } | undefined> {
	if (!folderPrefix) {
		return undefined;
	}
	const connection = remoteAgentService.getConnection();
	const isRemote = !!connection?.remoteAuthority;
	const resource = URI.from({
		scheme: isRemote ? Schemas.vscodeRemote : Schemas.file,
		authority: isRemote ? connection.remoteAuthority : undefined,
		path: URI.file(join(folderPrefix, filePath)).path
	});
	let content: IFileContent;
	try {
		content = await fileService.readFile(resource);
	} catch (e: unknown) {
		if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
			return undefined;
		}
		throw e;
	}
	if (content === undefined) {
		return undefined;
	}
	return {
		resource,
		content: content.value.toString()
	};
}
