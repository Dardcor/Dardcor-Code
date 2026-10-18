/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, JumpListCategory, JumpListItem } from 'electron';
import { coalesce } from '../../../base/common/arrays.js';
import { ThrottledDelayer } from '../../../base/common/async.js';
import { Emitter, Event as CommonEvent } from '../../../base/common/event.js';
import { normalizeDriveLetter, splitRecentLabel } from '../../../base/common/labels.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Schemas } from '../../../base/common/network.js';
import { isMacintosh, isWindows } from '../../../base/common/platform.js';
import { basename, extUriBiasedIgnorePathCase, originalFSPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { Promises } from '../../../base/node/pfs.js';
import { localize } from '../../../nls.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILifecycleMainService, LifecycleMainPhase } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { IRecent, IRecentFile, IRecentFolder, IRecentlyOpened, IRecentWorkspace, isRecentFile, isRecentFolder, isRecentWorkspace, restoreRecentlyOpened, toStoreData } from '../common/workspaces.js';
import { IWorkspaceIdentifier, WORKSPACE_EXTENSION } from '../../workspace/common/workspace.js';
import { IWorkspacesManagementMainService } from './workspacesManagementMainService.js';
import { ResourceMap } from '../../../base/common/map.js';
import { IDialogMainService } from '../../dialogs/electron-main/dialogMainService.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';

export const IWorkspacesHistoryMainService = createDecorator<IWorkspacesHistoryMainService>('workspacesHistoryMainService');

export interface IWorkspacesHistoryMainService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeRecentlyOpened: CommonEvent<void>;

	addRecentlyOpened(recents: IRecent[]): Promise<void>;
	getRecentlyOpened(): Promise<IRecentlyOpened>;
	removeRecentlyOpened(paths: URI[]): Promise<void>;
	clearRecentlyOpened(options?: { confirm?: boolean }): Promise<void>;
}

export class WorkspacesHistoryMainService extends Disposable implements IWorkspacesHistoryMainService {

	private static readonly MAX_TOTAL_RECENT_ENTRIES = 500;

	private static readonly RECENTLY_OPENED_STORAGE_KEY = 'history.recentlyOpenedPathsList';

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeRecentlyOpened = this._register(new Emitter<void>());
	readonly onDidChangeRecentlyOpened = this._onDidChangeRecentlyOpened.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IWorkspacesManagementMainService private readonly workspacesManagementMainService: IWorkspacesManagementMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IApplicationStorageMainService private readonly applicationStorageMainService: IApplicationStorageMainService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		this.lifecycleMainService.when(LifecycleMainPhase.Eventually).then(() => this.handleWindowsJumpList());

		this._register(this.workspacesManagementMainService.onDidEnterWorkspace(event => this.addRecentlyOpened([{ workspace: event.workspace, remoteAuthority: event.window.remoteAuthority }])));
	}


	async addRecentlyOpened(recentToAdd: IRecent[]): Promise<void> {
		let workspaces: Array<IRecentFolder | IRecentWorkspace> = [];
		let files: IRecentFile[] = [];

		for (const recent of recentToAdd) {

			if (isRecentWorkspace(recent)) {
				if (!this.workspacesManagementMainService.isUntitledWorkspace(recent.workspace) && !this.containsWorkspace(workspaces, recent.workspace)) {
					workspaces.push(recent);
				}
			}

			else if (isRecentFolder(recent)) {
				if (!this.containsFolder(workspaces, recent.folderUri)) {
					workspaces.push(recent);
				}
			}

			else {
				const alreadyExistsInHistory = this.containsFile(files, recent.fileUri);
				const shouldBeFiltered = recent.fileUri.scheme === Schemas.file && WorkspacesHistoryMainService.COMMON_FILES_FILTER.indexOf(basename(recent.fileUri)) >= 0;

				if (!alreadyExistsInHistory && !shouldBeFiltered) {
					files.push(recent);

					if (isWindows && recent.fileUri.scheme === Schemas.file && !this.environmentMainService.isPortable) {
						app.addRecentDocument(recent.fileUri.fsPath);
					}
				}
			}
		}

		const mergedEntries = await this.mergeEntriesFromStorage({ workspaces, files });
		workspaces = this.filterAgentSessionsWorkspaces(mergedEntries.workspaces);
		files = mergedEntries.files;

		if (workspaces.length > WorkspacesHistoryMainService.MAX_TOTAL_RECENT_ENTRIES) {
			workspaces.length = WorkspacesHistoryMainService.MAX_TOTAL_RECENT_ENTRIES;
		}

		if (files.length > WorkspacesHistoryMainService.MAX_TOTAL_RECENT_ENTRIES) {
			files.length = WorkspacesHistoryMainService.MAX_TOTAL_RECENT_ENTRIES;
		}

		await this.saveRecentlyOpened({ workspaces, files });
		this._onDidChangeRecentlyOpened.fire();

		if (isMacintosh && !this.environmentMainService.isPortable) {
			this.macOSRecentDocumentsUpdater.trigger(() => this.updateMacOSRecentDocuments());
		}
	}

	async removeRecentlyOpened(recentToRemove: URI[]): Promise<void> {
		const keep = (recent: IRecent) => {
			const uri = this.location(recent);
			for (const resourceToRemove of recentToRemove) {
				if (extUriBiasedIgnorePathCase.isEqual(resourceToRemove, uri)) {
					return false;
				}
			}

			return true;
		};

		const mru = await this.getRecentlyOpened();
		const workspaces = mru.workspaces.filter(keep);
		const files = mru.files.filter(keep);

		if (workspaces.length !== mru.workspaces.length || files.length !== mru.files.length) {
			await this.saveRecentlyOpened({ files, workspaces });
			this._onDidChangeRecentlyOpened.fire();

			if (isMacintosh && !this.environmentMainService.isPortable) {
				this.macOSRecentDocumentsUpdater.trigger(() => this.updateMacOSRecentDocuments());
			}
		}
	}

	async clearRecentlyOpened(options?: { confirm?: boolean }): Promise<void> {
		if (options?.confirm) {
			const { response } = await this.dialogMainService.showMessageBox({
				type: 'warning',
				buttons: [
					localize({ key: 'clearButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Clear"),
					localize({ key: 'cancel', comment: ['&& denotes a mnemonic'] }, "&&Cancel")
				],
				message: localize('confirmClearRecentsMessage', "Do you want to clear all recently opened files and workspaces?"),
				detail: localize('confirmClearDetail', "This action is irreversible!"),
				cancelId: 1
			});

			if (response !== 0) {
				return;
			}
		}

		await this.saveRecentlyOpened({ workspaces: [], files: [] });

		if (!this.environmentMainService.isPortable) {
			app.clearRecentDocuments();
		}

		this._onDidChangeRecentlyOpened.fire();
	}

	async getRecentlyOpened(): Promise<IRecentlyOpened> {
		const recentlyOpened = await this.mergeEntriesFromStorage();

		return {
			workspaces: this.filterAgentSessionsWorkspaces(recentlyOpened.workspaces),
			files: recentlyOpened.files
		};
	}

	private filterAgentSessionsWorkspaces(workspaces: Array<IRecentWorkspace | IRecentFolder>): Array<IRecentWorkspace | IRecentFolder> {
		return workspaces.filter(recent => {
			if (isRecentWorkspace(recent)) {
				if (this.isAgentSessionsWorkspace(recent.workspace)) {
					return false;
				}
				if (recent.label === 'Agents Window' || recent.label?.startsWith('Agents Window')) {
					return false;
				}
			}
			return true;
		});
	}

	private isAgentSessionsWorkspace(workspace: IWorkspaceIdentifier): boolean {
		return basename(workspace.configPath) === 'agent-sessions.code-workspace' || workspace.configPath.path.includes('agent-sessions');
	}

	private async mergeEntriesFromStorage(existingEntries?: IRecentlyOpened): Promise<IRecentlyOpened> {


		const mapWorkspaceIdToWorkspace = new ResourceMap<IRecentFolder | IRecentWorkspace>(uri => extUriBiasedIgnorePathCase.getComparisonKey(uri));
		if (existingEntries?.workspaces) {
			for (const workspace of existingEntries.workspaces) {
				mapWorkspaceIdToWorkspace.set(this.location(workspace), workspace);
			}
		}

		const mapFileIdToFile = new ResourceMap<IRecentFile>(uri => extUriBiasedIgnorePathCase.getComparisonKey(uri));
		if (existingEntries?.files) {
			for (const file of existingEntries.files) {
				mapFileIdToFile.set(this.location(file), file);
			}
		}


		const recentFromStorage = await this.getRecentlyOpenedFromStorage();
		for (const recentWorkspaceFromStorage of recentFromStorage.workspaces) {
			const existingRecentWorkspace = mapWorkspaceIdToWorkspace.get(this.location(recentWorkspaceFromStorage));
			if (existingRecentWorkspace) {
				existingRecentWorkspace.label = existingRecentWorkspace.label ?? recentWorkspaceFromStorage.label;
			} else {
				mapWorkspaceIdToWorkspace.set(this.location(recentWorkspaceFromStorage), recentWorkspaceFromStorage);
			}
		}

		for (const recentFileFromStorage of recentFromStorage.files) {
			const existingRecentFile = mapFileIdToFile.get(this.location(recentFileFromStorage));
			if (existingRecentFile) {
				existingRecentFile.label = existingRecentFile.label ?? recentFileFromStorage.label;
			} else {
				mapFileIdToFile.set(this.location(recentFileFromStorage), recentFileFromStorage);
			}
		}

		return {
			workspaces: [...mapWorkspaceIdToWorkspace.values()],
			files: [...mapFileIdToFile.values()]
		};
	}

	private async getRecentlyOpenedFromStorage(): Promise<IRecentlyOpened> {

		// Wait for global storage to be ready
		await this.applicationStorageMainService.whenReady;

		let storedRecentlyOpened: object | undefined = undefined;

		const storedRecentlyOpenedRaw = this.applicationStorageMainService.get(WorkspacesHistoryMainService.RECENTLY_OPENED_STORAGE_KEY, StorageScope.APPLICATION_SHARED);
		if (typeof storedRecentlyOpenedRaw === 'string') {
			try {
				storedRecentlyOpened = JSON.parse(storedRecentlyOpenedRaw);
			} catch (error) {
				this.logService.error('Unexpected error parsing opened paths list', error);
			}
		}

		return restoreRecentlyOpened(storedRecentlyOpened, this.logService);
	}

	private async saveRecentlyOpened(recent: IRecentlyOpened): Promise<void> {

		// Wait for global storage to be ready
		await this.applicationStorageMainService.whenReady;

		this.applicationStorageMainService.store(WorkspacesHistoryMainService.RECENTLY_OPENED_STORAGE_KEY, JSON.stringify(toStoreData(recent)), StorageScope.APPLICATION_SHARED, StorageTarget.MACHINE);
	}

	private location(recent: IRecent): URI {
		if (isRecentFolder(recent)) {
			return recent.folderUri;
		}

		if (isRecentFile(recent)) {
			return recent.fileUri;
		}

		return recent.workspace.configPath;
	}

	private containsWorkspace(recents: IRecent[], candidate: IWorkspaceIdentifier): boolean {
		return !!recents.find(recent => isRecentWorkspace(recent) && recent.workspace.id === candidate.id);
	}

	private containsFolder(recents: IRecent[], candidate: URI): boolean {
		return !!recents.find(recent => isRecentFolder(recent) && extUriBiasedIgnorePathCase.isEqual(recent.folderUri, candidate));
	}

	private containsFile(recents: IRecentFile[], candidate: URI): boolean {
		return !!recents.find(recent => extUriBiasedIgnorePathCase.isEqual(recent.fileUri, candidate));
	}




	private static readonly MAX_MACOS_DOCK_RECENT_WORKSPACES = 7;
	private static readonly MAX_MACOS_DOCK_RECENT_ENTRIES_TOTAL = 10;

	private static readonly COMMON_FILES_FILTER = [
		'COMMIT_EDITMSG',
		'MERGE_MSG',
		'git-rebase-todo'
	];

	private readonly macOSRecentDocumentsUpdater = this._register(new ThrottledDelayer<void>(800));

	private async handleWindowsJumpList(): Promise<void> {
		if (!isWindows) {
			return;
		}

		if (this.environmentMainService.isPortable) {
			return;
		}

		await this.updateWindowsJumpList();
		this._register(this.onDidChangeRecentlyOpened(() => this.updateWindowsJumpList()));
	}

	private async updateWindowsJumpList(): Promise<void> {
		if (!isWindows) {
			return;
		}

		const jumpList: JumpListCategory[] = [];

		jumpList.push({
			type: 'tasks',
			items: [
				{
					type: 'task',
					title: localize('newWindow', "New Window"),
					description: localize('newWindowDesc', "Opens a new window"),
					program: process.execPath,
					args: '-n',
					iconPath: process.execPath,
					iconIndex: 0
				}
			]
		});

		if ((await this.getRecentlyOpened()).workspaces.length > 0) {

			const jumpListSettings = app.getJumpListSettings();
			const toRemove: URI[] = [];
			for (const item of jumpListSettings.removedItems) {
				const args = item.args;
				if (args) {
					const match = /^--(folder|file)-uri\s+"([^"]+)"$/.exec(args);
					if (match) {
						toRemove.push(URI.parse(match[2]));
					}
				}
			}
			await this.removeRecentlyOpened(toRemove);

			let hasWorkspaces = false;
			const items: JumpListItem[] = coalesce((await this.getRecentlyOpened()).workspaces.slice(0, jumpListSettings.minItems).map(recent => {
				const workspace = isRecentWorkspace(recent) ? recent.workspace : recent.folderUri;

				const { title, description } = this.getWindowsJumpListLabel(workspace, recent.label);
				let args;
				if (URI.isUri(workspace)) {
					args = `--folder-uri "${workspace.toString()}"`;
				} else {
					hasWorkspaces = true;
					args = `--file-uri "${workspace.configPath.toString()}"`;
				}

				return {
					type: 'task',
					title: title.substr(0, 255),
					description: description.substr(0, 255),
					program: process.execPath,
					args,
					iconPath: 'explorer.exe',
					iconIndex: 0
				};
			}));

			if (items.length > 0) {
				jumpList.push({
					type: 'custom',
					name: hasWorkspaces ? localize('recentFoldersAndWorkspaces', "Recent Folders & Workspaces") : localize('recentFolders', "Recent Folders"),
					items
				});
			}
		}

		jumpList.push({
			type: 'recent'
		});

		try {
			const res = app.setJumpList(jumpList);
			if (res && res !== 'ok') {
				this.logService.warn(`updateWindowsJumpList#setJumpList unexpected result: ${res}`);
			}
		} catch (error) {
			this.logService.warn('updateWindowsJumpList#setJumpList', error);
		}
	}

	private getWindowsJumpListLabel(workspace: IWorkspaceIdentifier | URI, recentLabel: string | undefined): { title: string; description: string } {

		if (recentLabel) {
			return { title: splitRecentLabel(recentLabel).name, description: recentLabel };
		}

		if (URI.isUri(workspace)) {
			return { title: basename(workspace), description: this.renderJumpListPathDescription(workspace) };
		}

		if (this.workspacesManagementMainService.isUntitledWorkspace(workspace)) {
			return { title: localize('untitledWorkspace', "Untitled (Workspace)"), description: '' };
		}

		let filename = basename(workspace.configPath);
		if (filename.endsWith(WORKSPACE_EXTENSION)) {
			filename = filename.substr(0, filename.length - WORKSPACE_EXTENSION.length - 1);
		}

		return { title: localize('workspaceName', "{0} (Workspace)", filename), description: this.renderJumpListPathDescription(workspace.configPath) };
	}

	private renderJumpListPathDescription(uri: URI) {
		return uri.scheme === 'file' ? normalizeDriveLetter(uri.fsPath) : uri.toString();
	}

	private async updateMacOSRecentDocuments(): Promise<void> {
		if (!isMacintosh) {
			return;
		}

		app.clearRecentDocuments();

		const mru = await this.getRecentlyOpened();

		const workspaceEntries: string[] = [];
		let entries = 0;
		for (let i = 0; i < mru.workspaces.length && entries < WorkspacesHistoryMainService.MAX_MACOS_DOCK_RECENT_WORKSPACES; i++) {
			const loc = this.location(mru.workspaces[i]);
			if (loc.scheme === Schemas.file) {
				const workspacePath = originalFSPath(loc);
				if (await Promises.exists(workspacePath)) {
					workspaceEntries.push(workspacePath);
					entries++;
				}
			}
		}

		const fileEntries: string[] = [];
		for (let i = 0; i < mru.files.length && entries < WorkspacesHistoryMainService.MAX_MACOS_DOCK_RECENT_ENTRIES_TOTAL; i++) {
			const loc = this.location(mru.files[i]);
			if (loc.scheme === Schemas.file) {
				const filePath = originalFSPath(loc);
				if (
					WorkspacesHistoryMainService.COMMON_FILES_FILTER.includes(basename(loc)) ||
					workspaceEntries.includes(filePath)
				) {
					continue;
				}

				if (await Promises.exists(filePath)) {
					fileEntries.push(filePath);
					entries++;
				}
			}
		}

		fileEntries.reverse().forEach(fileEntry => app.addRecentDocument(fileEntry));
		workspaceEntries.reverse().forEach(workspaceEntry => app.addRecentDocument(workspaceEntry));
	}

}
