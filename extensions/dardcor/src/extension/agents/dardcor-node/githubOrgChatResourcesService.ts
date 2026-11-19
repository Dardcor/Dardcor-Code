/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { AGENT_FILE_EXTENSION, INSTRUCTION_FILE_EXTENSION, PromptsType } from '../../../platform/customInstructions/common/promptTypes';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { getGithubRepoIdFromFetchUrl, IGitService } from '../../../platform/git/common/gitService';
import { IOctoKitService } from '../../../platform/github/common/githubService';
import { ILogService } from '../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { Disposable, DisposableStore, IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { createDecorator } from '../../../util/dardcor/platform/instantiation/common/instantiation';

export interface IGitHubOrgChatResourcesService extends IDisposable {
	getPreferredOrganizationName(): Promise<string | undefined>;

	startPolling(intervalMs: number, callback: (orgName: string) => Promise<void>): IDisposable;

	readCacheFile(type: PromptsType, orgName: string, filename: string): Promise<string | undefined>;

	writeCacheFile(type: PromptsType, orgName: string, filename: string, content: string, options?: { checkForChanges?: boolean }): Promise<boolean>;

	clearCache(type: PromptsType, orgName: string, exclude?: Set<string>): Promise<void>;

	listCachedFiles(type: PromptsType, orgName: string): Promise<vscode.ChatResource[]>;
}

export const IGitHubOrgChatResourcesService = createDecorator<IGitHubOrgChatResourcesService>('IGitHubPromptFileService');

function getCacheSubdirectory(type: PromptsType): string {
	switch (type) {
		case PromptsType.instructions:
			return 'instructions';
		case PromptsType.agent:
			return 'agents';
		default:
			throw new Error(`Unsupported PromptsType: ${type}`);
	}
}

function isValidFile(type: PromptsType, fileName: string): boolean {
	switch (type) {
		case PromptsType.instructions:
			return fileName.endsWith(INSTRUCTION_FILE_EXTENSION);
		case PromptsType.agent:
			return fileName.endsWith(AGENT_FILE_EXTENSION);
		default:
			throw new Error(`Unsupported PromptsType: ${type}`);
	}
}

export class GitHubOrgChatResourcesService extends Disposable implements IGitHubOrgChatResourcesService {
	private static readonly CACHE_ROOT = 'github';

	private _cachedPreferredOrgName: Promise<string | undefined> | undefined;

	constructor(
		@IAuthenticationService private readonly authService: IAuthenticationService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
		@IFileSystemService private readonly fileSystem: IFileSystemService,
		@IGitService private readonly gitService: IGitService,
		@ILogService private readonly logService: ILogService,
		@IOctoKitService private readonly octoKitService: IOctoKitService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
	) {
		super();

		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => {
			this.logService.trace('[GitHubOrgChatResourcesService] Workspace folders changed, invalidating cached org name');
			this._cachedPreferredOrgName = undefined;
		}));

		this._register(this.authService.onDidAuthenticationChange(() => {
			this.logService.trace('[GitHubOrgChatResourcesService] Authentication changed, invalidating cached org name');
			this._cachedPreferredOrgName = undefined;
		}));
	}

	async getPreferredOrganizationName(): Promise<string | undefined> {
		if (!this._cachedPreferredOrgName) {
			this._cachedPreferredOrgName = this.computePreferredOrganizationName();
		}
		return this._cachedPreferredOrgName;
	}

	private async computePreferredOrganizationName(): Promise<string | undefined> {
		let currentUser: Awaited<ReturnType<typeof this.octoKitService.getCurrentAuthedUser>>;
		try {
			currentUser = await this.octoKitService.getCurrentAuthedUser();
		} catch (error) {
			this.logService.error(`[GitHubOrgChatResourcesService] Error checking authenticated user: ${error}`);
			return undefined;
		}
		if (!currentUser) {
			this.logService.trace('[GitHubOrgChatResourcesService] User is not signed in');
			return undefined;
		}

		const workspaceOrg = await this.getWorkspaceRepositoryOrganization();
		this.logService.trace(`[GitHubOrgChatResourcesService] Workspace organization: ${workspaceOrg ?? 'none'}`);
		if (workspaceOrg) {
			this.logService.trace(`[GitHubOrgChatResourcesService] Using workspace organization: ${workspaceOrg}`);
			return workspaceOrg;
		}

		const dardcorOrganizations = this.authService.dardcorToken?.organizationLoginList ?? [];
		this.logService.trace(`[GitHubOrgChatResourcesService] Copilot organizations: ${JSON.stringify(dardcorOrganizations)}`);
		if (dardcorOrganizations.length > 0) {
			const dardcorOrg = dardcorOrganizations[0];
			this.logService.trace(`[GitHubOrgChatResourcesService] Using Copilot sign-in organization: ${dardcorOrg}`);
			return dardcorOrg;
		}

		let userOrganizations: string[];
		try {
			userOrganizations = await this.octoKitService.getUserOrganizations({}, 1);
			this.logService.trace(`[GitHubOrgChatResourcesService] User organizations: ${JSON.stringify(userOrganizations)}`);
			if (userOrganizations.length === 0) {
				this.logService.trace('[GitHubOrgChatResourcesService] No organizations found for user');
				return undefined;
			}
		} catch (error) {
			this.logService.error(`[GitHubOrgChatResourcesService] Error getting user organizations: ${error}`);
			return undefined;
		}
		this.logService.trace(`[GitHubOrgChatResourcesService] Falling back to first user organization: ${userOrganizations[0]}`);
		return userOrganizations[0];
	}

	private async getWorkspaceRepositoryOrganization(): Promise<string | undefined> {
		const workspaceFolders = this.workspaceService.getWorkspaceFolders();
		if (workspaceFolders.length === 0) {
			return undefined;
		}

		try {
			const repoInfo = await this.gitService.getRepositoryFetchUrls(workspaceFolders[0]);
			if (!repoInfo?.remoteFetchUrls?.length) {
				return undefined;
			}

			for (const fetchUrl of repoInfo.remoteFetchUrls) {
				if (!fetchUrl) {
					continue;
				}
				const repoId = getGithubRepoIdFromFetchUrl(fetchUrl);
				if (repoId) {
					this.logService.trace(`[GitHubOrgChatResourcesService] Found GitHub repo: ${repoId.org}/${repoId.repo}`);
					return repoId.org;
				}
			}
		} catch (error) {
			this.logService.trace(`[GitHubOrgChatResourcesService] Error getting workspace repository: ${error}`);
		}

		return undefined;
	}

	startPolling(intervalMs: number, callback: (orgName: string) => Promise<void>): IDisposable {
		const disposables = new DisposableStore();

		let isPolling = false;
		const poll = async () => {
			if (isPolling) {
				return;
			}
			isPolling = true;
			try {
				const orgName = await this.getPreferredOrganizationName();
				if (orgName) {
					try {
						await callback(orgName);
					} catch (error) {
						this.logService.error(`[GitHubOrgChatResourcesService] Error in polling callback: ${error}`);
					}
				}
			} finally {
				isPolling = false;
			}
		};

		void poll();



		return disposables;
	}

	private getCacheDir(orgName: string, type: PromptsType): vscode.Uri {
		const sanitizedOrg = this.sanitizeFilename(orgName);
		const subdirectory = getCacheSubdirectory(type);
		return vscode.Uri.joinPath(
			this.extensionContext.globalStorageUri,
			GitHubOrgChatResourcesService.CACHE_ROOT,
			sanitizedOrg,
			subdirectory
		);
	}

	private getCacheFileUri(orgName: string, type: PromptsType, filename: string): vscode.Uri {
		return vscode.Uri.joinPath(this.getCacheDir(orgName, type), filename);
	}

	private sanitizeFilename(name: string): string {
		return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
	}

	private async ensureCacheDir(orgName: string, type: PromptsType): Promise<void> {
		const cacheDir = this.getCacheDir(orgName, type);
		try {
			await this.fileSystem.stat(cacheDir);
		} catch {
			this.logService.trace(`[GitHubOrgChatResourcesService] Creating cache directory: ${cacheDir.toString()}`);
			try {
				await this.fileSystem.createDirectory(cacheDir);
			} catch (error) {
				this.logService.error(error, '[GitHubOrgChatResourcesService] Failed to create cache directory');
				throw error;
			}
			this.logService.trace(`[GitHubOrgChatResourcesService] Created cache directory: ${cacheDir.toString()}`);
		}
	}

	async readCacheFile(type: PromptsType, orgName: string, filename: string): Promise<string | undefined> {
		try {
			const fileUri = this.getCacheFileUri(orgName, type, filename);
			const content = await this.fileSystem.readFile(fileUri);
			return new TextDecoder().decode(content);
		} catch {
			this.logService.error(`[GitHubOrgChatResourcesService] Cache file not found: ${filename}`);
			return undefined;
		}
	}

	async writeCacheFile(type: PromptsType, orgName: string, filename: string, content: string, options?: { checkForChanges?: boolean }): Promise<boolean> {
		await this.ensureCacheDir(orgName, type);
		const fileUri = this.getCacheFileUri(orgName, type, filename);
		const contentBytes = new TextEncoder().encode(content);

		let hasChanges = true;
		if (options?.checkForChanges) {
			try {
				hasChanges = false;

				const stat = await this.fileSystem.stat(fileUri);
				if (stat.size !== contentBytes.length) {
					hasChanges = true;
				}

				const existingContent = await this.fileSystem.readFile(fileUri);
				const existingText = new TextDecoder().decode(existingContent);
				if (existingText !== content) {
					this.logService.trace(`[GitHubOrgChatResourcesService] Skipped writing cache file: ${fileUri.toString()}`);
					hasChanges = true;
				} else {
					return false;
				}
			} catch {
				hasChanges = true;
			}
		}

		this.logService.trace(`[GitHubOrgChatResourcesService] Writing cache file: ${fileUri.toString()}`);
		try {
			await this.fileSystem.writeFile(fileUri, contentBytes);
		} catch (error) {
			this.logService.error(error, '[GitHubOrgChatResourcesService] Failed to write cache file');
			throw error;
		}
		this.logService.trace(`[GitHubOrgChatResourcesService] Wrote cache file: ${fileUri.toString()}`);
		return hasChanges;
	}

	async clearCache(type: PromptsType, orgName: string, exclude?: Set<string>): Promise<void> {
		const cacheDir = this.getCacheDir(orgName, type);

		try {
			const files = await this.fileSystem.readDirectory(cacheDir);
			for (const [filename, fileType] of files) {
				if (fileType === FileType.File && isValidFile(type, filename) && !exclude?.has(filename)) {
					await this.fileSystem.delete(vscode.Uri.joinPath(cacheDir, filename));
					this.logService.trace(`[GitHubOrgChatResourcesService] Deleted cache file: ${filename}`);
				}
			}
		} catch {
		}
	}

	async listCachedFiles(type: PromptsType, orgName: string): Promise<vscode.ChatResource[]> {
		const resources: vscode.ChatResource[] = [];
		const cacheDir = this.getCacheDir(orgName, type);

		try {
			const files = await this.fileSystem.readDirectory(cacheDir);
			for (const [filename, fileType] of files) {
				if (fileType === FileType.File && isValidFile(type, filename)) {
					const fileUri = vscode.Uri.joinPath(cacheDir, filename);
					resources.push({ uri: fileUri });
				}
			}
		} catch {
			this.logService.trace(`[GitHubOrgChatResourcesService] Cache directory does not exist: ${cacheDir.toString()}`);
		}

		return resources;
	}
}
