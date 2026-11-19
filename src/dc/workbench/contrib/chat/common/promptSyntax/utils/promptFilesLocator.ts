/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { isAbsolute } from '../../../../../../base/common/path.js';
import { ResourceSet } from '../../../../../../base/common/map.js';
import * as nls from '../../../../../../nls.js';
import { FileOperation, FileOperationError, FileOperationResult, IFileService } from '../../../../../../platform/files/common/files.js';
import { getPromptFileLocationsConfigKey, isTildePath, PromptsConfig } from '../config/config.js';
import { basename, dirname, isEqual, isEqualOrParent, joinPath } from '../../../../../../base/common/resources.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { AGENTS_SOURCE_FOLDER, CLAUDE_CONFIG_FOLDER, COPILOT_CONFIG_FOLDER, GITHUB_CONFIG_FOLDER, getPromptFileExtension, getPromptFileType, LEGACY_MODE_FILE_EXTENSION, getCleanPromptName, AGENT_FILE_EXTENSION, getPromptFileDefaultLocations, SKILL_FILENAME, IPromptSourceFolder, IResolvedPromptSourceFolder } from '../config/promptFileLocations.js';
import { PromptFileSource, PromptsType } from '../promptTypes.js';
import { IWorkbenchEnvironmentService } from '../../../../../services/environment/common/environmentService.js';
import { Schemas } from '../../../../../../base/common/network.js';
import { getExcludes, IFileQuery, ISearchConfiguration, ISearchService, QueryType } from '../../../../../services/search/common/search.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../../base/common/errors.js';
import { AgentInstructionFileType, IPromptPath, IAgentInstructionFile, Logger, PromptsStorage } from '../service/promptsService.js';
import { IUserDataProfileService } from '../../../../../services/userDataProfile/common/userDataProfile.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IPathService } from '../../../../../services/path/common/pathService.js';
import { equalsIgnoreCase } from '../../../../../../base/common/strings.js';
import { IWorkspaceTrustManagementService } from '../../../../../../platform/workspace/common/workspaceTrust.js';
import { AGENT_HOST_SCHEME } from '../../../../../../platform/agentHost/common/agentHostUri.js';

const MAX_INSTRUCTIONS_RECURSION_DEPTH = 5;

export interface IWorkspaceInstructionFile {
	readonly fileName: string;
	readonly type: AgentInstructionFileType;
}

export class PromptFilesLocator {

	private readonly userDataFolder: IResolvedPromptSourceFolder;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@ISearchService private readonly searchService: ISearchService,
		@IUserDataProfileService private readonly userDataService: IUserDataProfileService,
		@ILogService private readonly logService: ILogService,
		@IPathService private readonly pathService: IPathService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
	) {

		const userDataPromptsHome = this.userDataService.currentProfile.promptsHome;
		this.userDataFolder = {
			uri: userDataPromptsHome,
			searchRoot: userDataPromptsHome,
			filePattern: undefined,
			source: PromptFileSource.UserData,
			storage: PromptsStorage.user,
			displayPath: nls.localize('promptsUserDataFolder', "User Data"),
			isDefault: true
		};
	}

	protected getWorkspaceFolders(): readonly IWorkspaceFolder[] {
		return this.workspaceService.getWorkspace().folders.filter(f => f.uri.scheme !== AGENT_HOST_SCHEME);
	}

	protected getWorkspaceFolder(resource: URI): IWorkspaceFolder | undefined {
		return this.workspaceService.getWorkspaceFolder(resource) ?? undefined;
	}

	protected onDidChangeWorkspaceFolders(): Event<void> {
		return Event.map(this.workspaceService.onDidChangeWorkspaceFolders, () => undefined);
	}

	protected getPromptSourceFolders(type: PromptsType): IPromptSourceFolder[] {
		return PromptsConfig.promptSourceFolders(this.configService, type);
	}

	protected getDefaultSourceFolders(type: PromptsType): readonly IPromptSourceFolder[] {
		return getPromptFileDefaultLocations(type);
	}

	public async getWorkspaceFolderRoots(includeParents: boolean, logger?: Logger, root?: URI): Promise<URI[]> {
		const workspaceFolders = root
			? root.scheme === AGENT_HOST_SCHEME ? [] : [{ uri: root }]
			: this.getWorkspaceFolders();
		if (includeParents) {
			const roots = new ResourceSet();
			const userHome = await this.pathService.userHome();
			for (const workspaceFolder of workspaceFolders) {
				roots.add(workspaceFolder.uri);
				const parents = await this.findParentRepoFolders(workspaceFolder.uri, userHome, roots, logger);
				for (const parent of parents) {
					roots.add(parent);
				}
			}
			return [...roots];
		}
		return workspaceFolders.map(f => f.uri);
	}

	private async findParentRepoFolders(folderUri: URI, userHome: URI, seen: ResourceSet, logger?: Logger): Promise<URI[]> {
		const candidates: URI[] = [];
		let current = folderUri;
		while (true) {
			try {
				const gitStat = await this.fileService.stat(joinPath(current, '.git')).then(stat => stat, () => undefined);
				const isRepoRoot = gitStat?.isDirectory === true;
				if (isRepoRoot) {
					if ((await this.workspaceTrustManagementService.getUriTrustInfo(current)).trusted) {
						candidates.push(current);
						return candidates;
					}
					logger?.logInfo(`Repository root found at ${current.toString()}, but it is not trusted. Skipping parent folder inclusion for this workspace folder.`);
					return [];
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				logger?.logInfo(`No repository root found for folder ${folderUri.toString()}. Error accessing ${joinPath(current, '.git')}: ${msg}.`);
				return [];
			}
			candidates.push(current);
			const parent = dirname(current);
			if (isEqual(current, parent) || current.path === '/' || isEqual(userHome, parent) || seen.has(parent)) {
				break;
			}
			current = parent;
		}
		logger?.logInfo(`No repository root found for folder ${folderUri.toString()}.`);
		return [];
	}

	public async listFiles(type: PromptsType, storage: PromptsStorage, token: CancellationToken, root?: URI): Promise<readonly URI[]> {
		const files = await this.listFilesWithSource(type, storage, token, root);
		return files.map(file => file.uri);
	}

	public async listFilesWithSource(type: PromptsType, storage: PromptsStorage, token: CancellationToken, root?: URI): Promise<readonly { uri: URI; source: PromptFileSource }[]> {
		if (storage !== PromptsStorage.user && storage !== PromptsStorage.local) {
			throw new Error(`Unsupported prompt file storage: ${storage}`);
		}

		const isConfigured = PromptsConfig.getLocationsValue(this.configService, type) !== undefined;
		const defaultFolders = this.getDefaultSourceFolders(type);
		const allFolders = isConfigured ? this.getPromptSourceFolders(type) : defaultFolders;
		const localRoot = storage === PromptsStorage.local ? root : undefined;
		const absoluteLocations = await this.toAbsoluteLocations(type, allFolders.filter(location => location.storage === storage), defaultFolders, localRoot);

		if (storage === PromptsStorage.user && this.isUserDataPromptType(type)) {
			const localLocations = await this.toAbsoluteLocations(type, allFolders.filter(location => location.storage === PromptsStorage.local), defaultFolders);
			absoluteLocations.push(...localLocations.filter(location => this.sourceFolderOverlapsUserData(type, location.searchRoot)));
			absoluteLocations.push(this.userDataFolder);
		}

		const paths = new ResourceSet();
		const result: { uri: URI; source: PromptFileSource }[] = [];

		for (const { searchRoot, filePattern, source, storage: sourceStorage } of absoluteLocations) {
			const files = (filePattern === undefined)
				? await this.resolveFilesAtLocation(searchRoot, type, token, 0, localRoot)
				: await this.searchFilesInLocation(searchRoot, filePattern, token);
			for (const file of files) {
				if (getPromptFileType(file) !== type || paths.has(file)) {
					continue;
				}

				const isUserDataFile = this.isUserDataPromptFile(type, file);
				if ((isUserDataFile && storage !== PromptsStorage.user)
					|| (!isUserDataFile && sourceStorage !== storage)) {
					continue;
				}

				paths.add(file);
				result.push({ uri: file, source: isUserDataFile ? PromptFileSource.UserData : source });
			}
			if (token.isCancellationRequested) {
				return [];
			}
		}
		return result;
	}

	private isUserDataPromptType(type: PromptsType): boolean {
		return type === PromptsType.agent || type === PromptsType.instructions || type === PromptsType.prompt;
	}

	private isUserDataPromptFile(type: PromptsType, resource: URI): boolean {
		return this.isUserDataPromptType(type) && isEqualOrParent(resource, this.userDataFolder.uri);
	}

	private sourceFolderOverlapsUserData(type: PromptsType, searchRoot: URI): boolean {
		return this.isUserDataPromptType(type)
			&& (isEqualOrParent(searchRoot, this.userDataFolder.uri) || isEqualOrParent(this.userDataFolder.uri, searchRoot));
	}

	public createFilesUpdatedEvent(type: PromptsType): { readonly event: Event<void>; dispose: () => void } {
		const disposables = new DisposableStore();
		const eventEmitter = disposables.add(new Emitter<void>());
		const token = disposables.add(new CancellationTokenSource()).token;

		const externalFolderWatchers = disposables.add(new DisposableStore());
		const key = getPromptFileLocationsConfigKey(type);
		const userDataFolder = this.userDataService.currentProfile.promptsHome;

		let parentFolders: readonly IResolvedPromptSourceFolder[] = [];

		const updateExternalFolderWatchers = () => {
			externalFolderWatchers.clear();
			for (const folder of parentFolders) {
				if (!this.getWorkspaceFolder(folder.searchRoot)) {
					const recursive = folder.filePattern !== undefined || type === PromptsType.instructions || type === PromptsType.skill;
					externalFolderWatchers.add(this.fileService.watch(folder.searchRoot, { recursive, excludes: [] }));
				}
			}
		};

		const update = async () => {
			try {
				parentFolders = await this.getSourceFoldersInDiscoveryOrder(type);

				if (token.isCancellationRequested) {
					return;
				}
				updateExternalFolderWatchers();
			} catch (err) {
				this.logService.error(`Error updating prompt file watchers after config change:`, err);
			}
		};
		disposables.add(this.configService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(key) || e.affectsConfiguration(PromptsConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS)) {
				void update();
				eventEmitter.fire();
			}
		}));
		disposables.add(this.onDidChangeWorkspaceFolders()(() => {
			void update();
			eventEmitter.fire();
		}));
		disposables.add(this.workspaceTrustManagementService.onDidChangeTrustedFolders(() => {
			void update();
			eventEmitter.fire();
		}));
		disposables.add(this.fileService.onDidFilesChange(e => {
			if (e.affects(userDataFolder)) {
				eventEmitter.fire();
				return;
			}
			if (parentFolders.some(folder => e.affects(folder.searchRoot) || e.affects(dirname(folder.searchRoot)))) {
				void update();
				eventEmitter.fire();
				return;
			}
		}));
		disposables.add(this.fileService.watch(userDataFolder));

		void update();

		return { event: eventEmitter.event, dispose: () => disposables.dispose() };
	}

	public createAgentInstructionsUpdatedEvent(): { readonly event: Event<void>; dispose: () => void } {
		const disposables = new DisposableStore();
		const eventEmitter = disposables.add(new Emitter<void>());
		const cts = new CancellationTokenSource();
		disposables.add(toDisposable(() => cts.dispose(true)));
		const token = cts.token;
		const watchers = disposables.add(new DisposableStore());
		const watchedRoots = new ResourceSet();

		const addWatch = (resource: URI) => {
			if (token.isCancellationRequested) {
				return;
			}
			if (watchedRoots.has(resource)) {
				return;
			}

			watchedRoots.add(resource);
			watchers.add(this.fileService.watch(resource));
		};

		const updateWatchers = async () => {
			watchers.clear();
			watchedRoots.clear();

			const watchWorkspaceRoots = this.configService.getValue(PromptsConfig.USE_AGENT_MD) || this.configService.getValue(PromptsConfig.USE_CLAUDE_MD);
			const watchClaudeFolders = this.configService.getValue(PromptsConfig.USE_CLAUDE_MD);
			const watchCopilotFolders = this.configService.getValue(PromptsConfig.USE_COPILOT_INSTRUCTION_FILES);
			const includeParents = this.configService.getValue(PromptsConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS) === true;
			const workspaceRoots = await this.getWorkspaceFolderRoots(includeParents);
			if (token.isCancellationRequested) {
				return;
			}
			const userHome = await this.pathService.userHome();
			if (token.isCancellationRequested) {
				return;
			}

			for (const workspaceRoot of workspaceRoots) {
				if (watchWorkspaceRoots) {
					addWatch(workspaceRoot);
				}
				if (watchClaudeFolders) {
					addWatch(joinPath(workspaceRoot, CLAUDE_CONFIG_FOLDER));
				}
				if (watchCopilotFolders) {
					addWatch(joinPath(workspaceRoot, GITHUB_CONFIG_FOLDER));
				}
			}

			if (watchClaudeFolders) {
				addWatch(joinPath(userHome, CLAUDE_CONFIG_FOLDER));
			}
			if (watchCopilotFolders) {
				addWatch(joinPath(userHome, COPILOT_CONFIG_FOLDER));
			}
		};

		const refresh = () => {
			void updateWatchers();
			eventEmitter.fire();
		};

		disposables.add(this.configService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(PromptsConfig.USE_AGENT_MD) ||
				e.affectsConfiguration(PromptsConfig.USE_CLAUDE_MD) ||
				e.affectsConfiguration(PromptsConfig.USE_COPILOT_INSTRUCTION_FILES) ||
				e.affectsConfiguration(PromptsConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS)
			) {
				refresh();
			}
		}));
		disposables.add(this.onDidChangeWorkspaceFolders()(() => {
			refresh();
		}));
		disposables.add(this.workspaceTrustManagementService.onDidChangeTrustedFolders(() => {
			refresh();
		}));
		disposables.add(this.fileService.onDidFilesChange(e => {
			for (const watchedRoot of watchedRoots) {
				if (e.affects(watchedRoot)) {
					eventEmitter.fire();
					return;
				}
			}
		}));
		disposables.add(this.fileService.onDidRunOperation(e => {
			for (const watchedRoot of watchedRoots) {
				if (isEqualOrParent(e.resource, watchedRoot)) {
					eventEmitter.fire();
					return;
				}
				if (e.isOperation(FileOperation.CREATE) || e.isOperation(FileOperation.MOVE) || e.isOperation(FileOperation.COPY)) {
					if (isEqualOrParent(e.target.resource, watchedRoot)) {
						eventEmitter.fire();
						return;
					}
				}
			}
		}));

		void updateWatchers();

		return { event: eventEmitter.event, dispose: () => disposables.dispose() };
	}

	public async getHookSourceFolders(): Promise<readonly IResolvedPromptSourceFolder[]> {
		const configuredLocations = this.getPromptSourceFolders(PromptsType.hook);

		const allowedHookFolders = configuredLocations.filter(loc =>
			!loc.path.startsWith('.claude/') && !loc.path.includes('/.claude/')
		);

		const absoluteLocations = await this.toAbsoluteLocations(PromptsType.hook, allowedHookFolders);

		const seen = new ResourceSet();
		const result: IResolvedPromptSourceFolder[] = [];
		for (const location of absoluteLocations) {
			if (!seen.has(location.searchRoot)) {
				seen.add(location.searchRoot);
				result.push({ ...location, uri: location.searchRoot, filePattern: undefined });
			}
		}

		return result;
	}

	public async getConfigBasedSourceFolders(type: PromptsType): Promise<readonly URI[]> {
		const isConfigured = PromptsConfig.getLocationsValue(this.configService, type) !== undefined;
		const defaultFolders = this.getDefaultSourceFolders(type);
		const allFolders = isConfigured ? this.getPromptSourceFolders(type) : defaultFolders;
		const absoluteLocations = await this.toAbsoluteLocations(type, allFolders, defaultFolders);

		if (type !== PromptsType.prompt && type !== PromptsType.instructions) {
			return absoluteLocations.map(l => l.uri);
		}

		const result = new ResourceSet();
		for (const absoluteLocation of absoluteLocations) {
			let location = absoluteLocation.uri;
			const baseName = basename(location);

			const filePatterns = ['*.md', `*${getPromptFileExtension(type)}`];
			for (const filePattern of filePatterns) {
				if (baseName === filePattern) {
					location = dirname(location);
					continue;
				}
			}

			if (baseName === '*') {
				location = dirname(location);
			}

			if (isValidGlob(location.path) === true) {
				continue;
			}

			result.add(location);
		}

		return [...result];
	}

	public async getResolvedSourceFolders(type: PromptsType): Promise<readonly IResolvedPromptSourceFolder[]> {
		const absoluteLocations = await this.getLocalStorageFolders(type);

		const localFolders = absoluteLocations.filter(loc => loc.storage === PromptsStorage.local);
		const userFolders = absoluteLocations.filter(loc => loc.storage === PromptsStorage.user);
		return this.dedupeSourceFolders([...localFolders, ...userFolders]);
	}

	public async getSourceFoldersInDiscoveryOrder(type: PromptsType): Promise<readonly IResolvedPromptSourceFolder[]> {
		const absoluteLocations = await this.getLocalStorageFolders(type);
		const userFolders = absoluteLocations.filter(loc => loc.storage === PromptsStorage.user);
		const localFolders = absoluteLocations.filter(loc => loc.storage === PromptsStorage.local);
		return this.dedupeSourceFolders([...userFolders, ...localFolders]);
	}

	private async getLocalStorageFolders(type: PromptsType): Promise<readonly IResolvedPromptSourceFolder[]> {
		const configuredLocations = this.getPromptSourceFolders(type);
		const defaultFolders = this.getDefaultSourceFolders(type);

		const isConfigured = PromptsConfig.getLocationsValue(this.configService, type) !== undefined;
		const allFolders = isConfigured ? configuredLocations : defaultFolders;

		const absoluteLocations = await this.toAbsoluteLocations(type, allFolders, defaultFolders);
		if (type === PromptsType.agent || type === PromptsType.instructions || type === PromptsType.prompt) {
			absoluteLocations.push(this.userDataFolder);
		}
		return absoluteLocations;
	}

	private dedupeSourceFolders(folders: readonly IResolvedPromptSourceFolder[]): IResolvedPromptSourceFolder[] {
		const seen = new ResourceSet();
		const result: IResolvedPromptSourceFolder[] = [];
		for (const folder of folders) {
			if (!seen.has(folder.uri)) {
				seen.add(folder.uri);
				result.push(folder);
			}
		}
		return result;
	}

	private async toAbsoluteLocations(type: PromptsType, configuredLocations: readonly IPromptSourceFolder[], defaultLocations?: readonly IPromptSourceFolder[], root?: URI): Promise<IResolvedPromptSourceFolder[]> {
		const result: IResolvedPromptSourceFolder[] = [];
		const seen = new ResourceSet();

		const userHome = await this.pathService.userHome();
		const rootFolders = await this.getWorkspaceFolderRoots(this.configService.getValue(PromptsConfig.USE_CUSTOMIZATIONS_IN_PARENT_REPOS) === true, undefined, root);

		const defaultPaths = new Set(defaultLocations?.map(loc => loc.path));

		const validLocations = configuredLocations.filter(sourceFolder => {
			if (type === PromptsType.instructions || type === PromptsType.prompt) {
				const path = sourceFolder.path;
				if (hasGlobPattern(path)) {
					if (type === PromptsType.prompt) {
						this.logService.warn(`[Deprecated] Glob patterns (* and **) in prompt file locations are deprecated: "${path}". Consider using explicit paths instead.`);
					} else if (type === PromptsType.instructions) {
						this.logService.info(`Glob patterns (* and **) detected in instruction file location: "${path}". Consider using explicit paths for better performance.`);
					}
				}
				return true;
			}
			const configuredLocation = sourceFolder.path;
			if (!isValidPromptFolderPath(configuredLocation)) {
				this.logService.warn(`Skipping invalid path (glob patterns and absolute paths not supported): ${configuredLocation}`);
				return false;
			}
			return true;
		});

		for (const sourceFolder of validLocations) {
			const configuredLocation = sourceFolder.path;
			const isDefault = defaultPaths?.has(configuredLocation);
			try {
				if (isTildePath(configuredLocation)) {
					const uri = joinPath(userHome, configuredLocation.substring(2));
					if (!seen.has(uri)) {
						seen.add(uri);
						const { searchRoot, filePattern } = resolveSearchLocation(type, uri);
						result.push({ uri, searchRoot: searchRoot, filePattern, source: sourceFolder.source, storage: sourceFolder.storage, displayPath: configuredLocation, isDefault });
					}
					continue;
				}

				if (isAbsolute(configuredLocation)) {
					let uri = URI.file(configuredLocation);
					const remoteAuthority = this.environmentService.remoteAuthority;
					if (remoteAuthority) {
						uri = uri.with({ scheme: Schemas.vscodeRemote, authority: remoteAuthority });
					}
					if (!seen.has(uri)) {
						seen.add(uri);
						const { searchRoot, filePattern } = resolveSearchLocation(type, uri);
						result.push({ uri, searchRoot: searchRoot, filePattern, source: sourceFolder.source, storage: sourceFolder.storage, displayPath: configuredLocation, isDefault });
					}
				} else {
					for (const folder of rootFolders) {
						const absolutePath = joinPath(folder, configuredLocation);
						if (!seen.has(absolutePath)) {
							seen.add(absolutePath);
							const { searchRoot, filePattern } = resolveSearchLocation(type, absolutePath);
							result.push({ uri: absolutePath, searchRoot: searchRoot, filePattern, source: sourceFolder.source, storage: sourceFolder.storage, displayPath: configuredLocation, isDefault });
						}
					}
				}
			} catch (error) {
				this.logService.error(`Failed to resolve prompt file location: ${configuredLocation}`, error);
			}
		}

		return result;
	}

	private async resolveFilesAtLocation(location: URI, type: PromptsType, token: CancellationToken, depth: number = 0, root?: URI): Promise<URI[]> {
		if (type === PromptsType.skill) {
			return this.findAgentSkillsInFolder(location, token);
		}
		const isWorkspaceRoot = depth === 0 && (root ? isEqual(root, location) : this.getWorkspaceFolders().some(f => isEqual(f.uri, location)));
		const recursive = type === PromptsType.instructions
			&& !isWorkspaceRoot
			&& !hasGlobPattern(location.path)
			&& depth < MAX_INSTRUCTIONS_RECURSION_DEPTH;
		try {
			const info = await this.fileService.resolve(location);
			if (token.isCancellationRequested) {
				return [];
			}
			if (info.isFile) {
				return [info.resource];
			} else if (info.isDirectory && info.children) {
				const result: URI[] = [];
				for (const child of info.children) {
					if (child.isFile) {
						result.push(child.resource);
					} else if (recursive && child.isDirectory) {
						const subFiles = await this.resolveFilesAtLocation(child.resource, type, token, depth + 1, root);
						result.push(...subFiles);
					}
				}
				return result;
			}
		} catch (e) {
			if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
			} else {
				this.logService.error(`Failed to resolve files at location: ${location.toString()}`, e);
			}
		}
		return [];
	}

	private async searchFilesInLocation(folder: URI, filePattern: string | undefined, token: CancellationToken): Promise<URI[]> {
		if (!this.searchService.schemeHasFileSearchProvider(folder.scheme)) {
			this.logService.warn(`[PromptFilesLocator] No FileSearchProvider available for scheme '${folder.scheme}'. Cannot search for pattern '${filePattern}' in ${folder.toString()}`);
			return [];
		}

		const disregardIgnoreFiles = this.configService.getValue<boolean>('explorer.excludeGitIgnore');

		const workspaceRoot = this.getWorkspaceFolder(folder);

		const getExcludePattern = (folder: URI) => getExcludes(this.configService.getValue<ISearchConfiguration>({ resource: folder })) || {};
		const searchOptions: IFileQuery = {
			folderQueries: [{ folder, disregardIgnoreFiles }],
			type: QueryType.File,
			shouldGlobMatchFilePattern: true,
			excludePattern: workspaceRoot ? getExcludePattern(workspaceRoot.uri) : undefined,
			ignoreGlobCase: true,
			sortByScore: true,
			filePattern
		};

		try {
			const searchResult = await this.searchService.fileSearch(searchOptions, token);
			if (token.isCancellationRequested) {
				return [];
			}
			return searchResult.results.map(r => r.resource);
		} catch (e) {
			if (!isCancellationError(e)) {
				throw e;
			}
		}
		return [];
	}

	public async findAgentMDsInWorkspace(token: CancellationToken): Promise<IAgentInstructionFile[]> {
		const result = await Promise.all(this.getWorkspaceFolders().map(folder => this.findAgentMDsInFolder(folder.uri, token)));
		return result.flat(1);
	}

	private async findAgentMDsInFolder(folder: URI, token: CancellationToken): Promise<IAgentInstructionFile[]> {
		if (this.searchService.schemeHasFileSearchProvider(folder.scheme)) {
			const disregardIgnoreFiles = this.configService.getValue<boolean>('explorer.excludeGitIgnore');
			const getExcludePattern = (folder: URI) => getExcludes(this.configService.getValue<ISearchConfiguration>({ resource: folder })) || {};
			const searchOptions: IFileQuery = {
				folderQueries: [{ folder, disregardIgnoreFiles }],
				type: QueryType.File,
				shouldGlobMatchFilePattern: true,
				excludePattern: getExcludePattern(folder),
				filePattern: '**/AGENTS.md',
				ignoreGlobCase: true,
			};

			try {
				const searchResult = await this.searchService.fileSearch(searchOptions, token);
				if (token.isCancellationRequested) {
					return [];
				}
				const results: IAgentInstructionFile[] = [];
				for (const r of searchResult.results) {
					const realPath = undefined;
					results.push({ uri: r.resource, realPath, type: AgentInstructionFileType.agentsMd });
				}
				return results;
			} catch (e) {
				if (!isCancellationError(e)) {
					throw e;
				}
			}
			return [];
		} else {
			return this.findAgentMDsUsingFileService(folder, token);
		}
	}

	private async findAgentMDsUsingFileService(folder: URI, token: CancellationToken): Promise<IAgentInstructionFile[]> {
		const result: IAgentInstructionFile[] = [];
		const agentsMdFileName = 'agents.md';

		const traverse = async (uri: URI): Promise<void> => {
			if (token.isCancellationRequested) {
				return;
			}

			try {
				const stat = await this.fileService.resolve(uri);
				if (stat.isFile && stat.name.toLowerCase() === agentsMdFileName) {
					const realPath = stat.isSymbolicLink ? await this.fileService.realpath(stat.resource) : undefined;
					result.push({ uri: stat.resource, realPath, type: AgentInstructionFileType.agentsMd });
				} else if (stat.isDirectory && stat.children) {
					for (const child of stat.children) {
						await traverse(child.resource);
					}
				}
			} catch (error) {
				this.logService.trace(`[PromptFilesLocator] Error traversing ${uri.toString()}: ${error}`);
			}
		};

		await traverse(folder);
		return result;
	}



	public async findFilesInRoots(roots: URI[], folder: string | undefined, paths: IWorkspaceInstructionFile[], token: CancellationToken, result: IAgentInstructionFile[] = []): Promise<IAgentInstructionFile[]> {
		const toResolve = roots.map(root => ({ resource: folder !== undefined ? joinPath(root, folder) : root }));
		const resolvedRoots = await this.fileService.resolveAll(toResolve);
		if (token.isCancellationRequested) {
			return result;
		}
		for (const root of resolvedRoots) {
			if (root.success && root.stat?.children) {
				for (const child of root.stat.children) {
					if (child.isFile) {
						const matchingPath = paths.find(p => equalsIgnoreCase(p.fileName, child.name));
						if (matchingPath) {
							const realPath = child.isSymbolicLink ? await this.fileService.realpath(child.resource) : undefined;
							result.push({ uri: child.resource, realPath, type: matchingPath.type });
						}
					}
				}
			}
		}
		return result;
	}

	public getAgentFileURIFromModeFile(oldURI: URI): URI | undefined {
		if (oldURI.path.endsWith(LEGACY_MODE_FILE_EXTENSION)) {
			let newLocation;
			const workspaceFolder = this.getWorkspaceFolder(oldURI);
			if (workspaceFolder) {
				newLocation = joinPath(workspaceFolder.uri, AGENTS_SOURCE_FOLDER, getCleanPromptName(oldURI) + AGENT_FILE_EXTENSION);
			} else if (isEqualOrParent(oldURI, this.userDataService.currentProfile.promptsHome)) {
				newLocation = joinPath(this.userDataService.currentProfile.promptsHome, getCleanPromptName(oldURI) + AGENT_FILE_EXTENSION);
			}
			return newLocation;
		}
		return undefined;
	}

	private async findAgentSkillsInFolder(uri: URI, token: CancellationToken): Promise<URI[]> {
		try {
			const result: URI[] = [];
			const stat = await this.fileService.resolve(uri);
			if (stat.isDirectory && stat.children) {
				for (const child of stat.children) {
					try {
						if (token.isCancellationRequested) {
							return [];
						}
						if (child.isDirectory) {
							const skillFile = joinPath(child.resource, SKILL_FILENAME);
							const skillStat = await this.fileService.resolve(skillFile);
							if (skillStat.isFile) {
								result.push(skillStat.resource);
							}
						}
					} catch (error) {
					}
				}
			}
			return result;
		} catch (e) {
			if (!isCancellationError(e)) {
				this.logService.trace(`[PromptFilesLocator] Error searching for skills in ${uri.toString()}: ${e}`);
			}
			return [];
		}
	}

	public async findAgentSkills(token: CancellationToken): Promise<IPromptPath[]> {
		const absoluteLocations = await this.getSourceFoldersInDiscoveryOrder(PromptsType.skill);
		const allResults: IPromptPath[] = [];

		for (const { uri, source, storage } of absoluteLocations) {
			if (token.isCancellationRequested) {
				return [];
			}
			const results = await this.findAgentSkillsInFolder(uri, token);
			for (const skillUri of results) {
				allResults.push({ uri: skillUri, source, storage, type: PromptsType.skill });
			}
		}

		return allResults;
	}
}


export function hasGlobPattern(path: string): boolean {
	return path.includes('*');
}


export function isValidGlob(pattern: string): boolean {
	let squareBrackets = false;
	let squareBracketsCount = 0;

	let curlyBrackets = false;
	let curlyBracketsCount = 0;

	let previousCharacter: string | undefined;
	for (const char of pattern) {
		if (previousCharacter === '\\') {
			previousCharacter = char;
			continue;
		}

		if (char === '*') {
			return true;
		}

		if (char === '?') {
			return true;
		}

		if (char === '[') {
			squareBrackets = true;
			squareBracketsCount++;

			previousCharacter = char;
			continue;
		}

		if (char === ']') {
			squareBrackets = true;
			squareBracketsCount--;
			previousCharacter = char;
			continue;
		}

		if (char === '{') {
			curlyBrackets = true;
			curlyBracketsCount++;
			continue;
		}

		if (char === '}') {
			curlyBrackets = true;
			curlyBracketsCount--;
			previousCharacter = char;
			continue;
		}

		previousCharacter = char;
	}

	if (squareBrackets && (squareBracketsCount === 0)) {
		return true;
	}

	if (curlyBrackets && (curlyBracketsCount === 0)) {
		return true;
	}

	return false;
}

interface ISearchLocationResult {
	readonly searchRoot: URI;
	readonly filePattern?: string;
}

function resolveSearchLocation(type: PromptsType, location: URI): ISearchLocationResult {
	if (type !== PromptsType.instructions && type !== PromptsType.prompt) {
		return { searchRoot: location };
	}

	const segments = location.path.split('/');
	let i = 0;
	while (i < segments.length && isValidGlob(segments[i]) === false) {
		i++;
	}
	if (i === segments.length) {
		return { searchRoot: location };
	}
	const parent = location.with({ path: segments.slice(0, i).join('/') });
	if (i === segments.length - 1 && segments[i] === '*' || segments[i] === ``) {
		return { searchRoot: parent };
	}

	return {
		searchRoot: parent,
		filePattern: segments.slice(i).join('/')
	};
}


export const VALID_PROMPT_FOLDER_PATTERN = '^(?![A-Za-z]:[\\\\/])(?!/)(?!~(?!/))(?!.*\\\\)(?!.*[*?\\[\\]{}]).*\\S.*$';
const VALID_PROMPT_FOLDER_REGEX = new RegExp(VALID_PROMPT_FOLDER_PATTERN);

export function isValidPromptFolderPath(path: string): boolean {
	return VALID_PROMPT_FOLDER_REGEX.test(path);
}
