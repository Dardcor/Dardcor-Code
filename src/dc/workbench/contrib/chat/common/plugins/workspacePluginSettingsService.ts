/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse as parseJSONC } from '../../../../../base/common/json.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { autorun, derived, IObservable, observableFromEvent, observableValue } from '../../../../../base/common/observable.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { CLAUDE_CONFIG_FOLDER } from '../promptSyntax/config/promptFileLocations.js';
import { IMarketplaceReference, parseMarketplaceObjectEntry } from './marketplaceReference.js';

const SETTINGS_FILENAME = 'settings.json';
const SETTINGS_LOCAL_FILENAME = 'settings.local.json';

const COPILOT_CONFIG_FOLDER = '.github/copilot';

export interface IWorkspaceMarketplaceEntry {
	readonly name: string;
	readonly reference: IMarketplaceReference;
}

export const IWorkspacePluginSettingsService = createDecorator<IWorkspacePluginSettingsService>('workspacePluginSettingsService');

export interface IWorkspacePluginSettingsService {
	readonly _serviceBrand: undefined;

	readonly extraMarketplaces: IObservable<readonly IWorkspaceMarketplaceEntry[]>;

	readonly enabledPlugins: IObservable<ReadonlyMap<string, boolean>>;
}


function parseEnabledPlugins(json: unknown): ReadonlyMap<string, boolean> {
	const result = new Map<string, boolean>();

	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		return result;
	}

	const obj = json as Record<string, unknown>;
	for (const [key, value] of Object.entries(obj)) {
		if (typeof value === 'boolean') {
			result.set(key, value);
		}
	}

	return result;
}

function parseExtraMarketplaces(json: unknown, logPrefix: string, logService: ILogService): readonly IWorkspaceMarketplaceEntry[] {
	const entries: IWorkspaceMarketplaceEntry[] = [];

	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		return entries;
	}

	const obj = json as Record<string, unknown>;
	for (const [name, value] of Object.entries(obj)) {
		if (!value || typeof value !== 'object') {
			logService.debug(`${logPrefix} Ignoring non-object extraKnownMarketplaces entry: ${name}`);
			continue;
		}

		const reference = parseMarketplaceObjectEntry({ ...value, name });
		if (!reference) {
			logService.debug(`${logPrefix} Could not parse marketplace reference for: ${name}`);
			continue;
		}

		entries.push({ name, reference });
	}

	return entries;
}


interface IWorkspaceSettingsData {
	readonly marketplaces: readonly IWorkspaceMarketplaceEntry[];
	readonly enabledPlugins: ReadonlyMap<string, boolean>;
}

const EMPTY_DATA: IWorkspaceSettingsData = { marketplaces: [], enabledPlugins: new Map() };

class WorkspaceSettingsReader extends Disposable {

	private readonly _data = observableValue<IWorkspaceSettingsData>('data', EMPTY_DATA);
	readonly data: IObservable<IWorkspaceSettingsData> = this._data;

	constructor(
		configFolder: string,
		logPrefix: string,
		fileService: IFileService,
		workspaceContextService: IWorkspaceContextService,
		private readonly _logService: ILogService,
	) {
		super();

		const settingsDirs = observableFromEvent(
			this,
			workspaceContextService.onDidChangeWorkspaceFolders,
			() => workspaceContextService.getWorkspace().folders.map(f => f.uri.path ? joinPath(f.uri, configFolder) : joinPath(f.uri.with({ path: '/' }), configFolder)),
		);

		const watcherStore = this._register(new DisposableStore());
		this._register(autorun(reader => {
			const dirs = settingsDirs.read(reader);
			watcherStore.clear();

			const scheduler = new RunOnceScheduler(() => this._readSettings(dirs, logPrefix, fileService), 100);
			watcherStore.add(scheduler);

			for (const dir of dirs) {
				const watcher = fileService.createWatcher(dir, { recursive: false, excludes: [] });
				watcherStore.add(watcher);
				watcherStore.add(watcher.onDidChange(e => {
					if (e.affects(joinPath(dir, SETTINGS_FILENAME)) || e.affects(joinPath(dir, SETTINGS_LOCAL_FILENAME))) {
						scheduler.schedule();
					}
				}));
			}

			this._readSettings(dirs, logPrefix, fileService);
		}));
	}

	private async _readSettings(dirs: readonly URI[], logPrefix: string, fileService: IFileService): Promise<void> {
		const allMarketplaces: IWorkspaceMarketplaceEntry[] = [];
		const mergedEnabled = new Map<string, boolean>();

		for (const dir of dirs) {
			const sharedUri = joinPath(dir, SETTINGS_FILENAME);
			const localUri = joinPath(dir, SETTINGS_LOCAL_FILENAME);

			for (const uri of [sharedUri, localUri]) {
				try {
					const content = await fileService.readFile(uri);
					const json = parseJSONC(content.value.toString());

					if (!json || typeof json !== 'object') {
						continue;
					}

					const root = json as Record<string, unknown>;

					const marketplaces = parseExtraMarketplaces(root.extraKnownMarketplaces, logPrefix, this._logService);
					for (const entry of marketplaces) {
						if (!allMarketplaces.some(e => e.reference.canonicalId === entry.reference.canonicalId)) {
							allMarketplaces.push(entry);
						}
					}

					const enabled = parseEnabledPlugins(root.enabledPlugins);
					for (const [key, value] of enabled) {
						mergedEnabled.set(key, value);
					}
				} catch {
					this._logService.debug(`${logPrefix} Could not read ${uri.toString()}`);
				}
			}
		}

		this._data.set({ marketplaces: allMarketplaces, enabledPlugins: mergedEnabled }, undefined);
	}
}


export class WorkspacePluginSettingsService extends Disposable implements IWorkspacePluginSettingsService {
	declare readonly _serviceBrand: undefined;

	readonly extraMarketplaces: IObservable<readonly IWorkspaceMarketplaceEntry[]>;
	readonly enabledPlugins: IObservable<ReadonlyMap<string, boolean>>;

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ILogService logService: ILogService,
	) {
		super();

		const claudeReader = this._register(new WorkspaceSettingsReader(
			CLAUDE_CONFIG_FOLDER, '[ClaudePluginSettings]',
			fileService, workspaceContextService, logService,
		));

		const copilotReader = this._register(new WorkspaceSettingsReader(
			COPILOT_CONFIG_FOLDER, '[CopilotPluginSettings]',
			fileService, workspaceContextService, logService,
		));

		this.extraMarketplaces = derived(reader => {
			const claude = claudeReader.data.read(reader).marketplaces;
			const copilot = copilotReader.data.read(reader).marketplaces;
			const byCanonicalId = new Map<string, IWorkspaceMarketplaceEntry>();
			for (const entry of [...claude, ...copilot]) {
				if (!byCanonicalId.has(entry.reference.canonicalId)) {
					byCanonicalId.set(entry.reference.canonicalId, entry);
				}
			}
			return [...byCanonicalId.values()];
		});

		this.enabledPlugins = derived(reader => {
			const claude = claudeReader.data.read(reader).enabledPlugins;
			const copilot = copilotReader.data.read(reader).enabledPlugins;
			const merged = new Map<string, boolean>();
			for (const [key, value] of claude) {
				merged.set(key, value);
			}
			for (const [key, value] of copilot) {
				if (!merged.has(key)) {
					merged.set(key, value);
				}
			}
			return merged;
		});
	}
}
