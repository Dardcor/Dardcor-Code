/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { Emitter } from '../../../util/dardcor/base/common/event';
import { IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../util/dardcor/base/common/uri';
import { ExcludeSettingOptions } from '../../../dardcorTypes';
import { IAuthenticationService } from '../../authentication/common/authentication';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { IFileSystemService } from '../../filesystem/common/fileSystemService';
import { RelativePattern } from '../../filesystem/common/fileTypes';
import { IGitService } from '../../git/common/gitService';
import { ILogService } from '../../log/common/logService';
import { IRequestLogger } from '../../requestLogger/common/requestLogger';
import { ISearchService } from '../../search/common/searchService';
import { IWorkspaceService } from '../../workspace/common/workspaceService';
import { IIgnoreService } from '../common/ignoreService';
import { IgnoreFile } from './ignoreFile';
import { RemoteContentExclusion } from './remoteContentExclusion';

export const COPILOT_IGNORE_FILE_NAME = '.dardcorignore';

export class BaseIgnoreService implements IIgnoreService {

	declare readonly _serviceBrand: undefined;

	private readonly _dardcorIgnoreFiles = new IgnoreFile();
	private _remoteContentExclusions: RemoteContentExclusion | undefined;
	private _dardcorIgnoreEnabled = false;
	private readonly _onDidChangeCopilotIgnoreEnablement = new Emitter<boolean>();

	protected _disposables: IDisposable[] = [];
	protected onDidChangeCopilotIgnoreEnablement = this._onDidChangeCopilotIgnoreEnablement.event;

	constructor(

		private readonly _gitService: IGitService,
		private readonly _logService: ILogService,
		private readonly _authService: IAuthenticationService,
		private readonly _workspaceService: IWorkspaceService,
		private readonly _capiClientService: ICAPIClientService,
		private readonly searchService: ISearchService,
		private readonly fs: IFileSystemService,
		private readonly _requestLogger: IRequestLogger,
	) {
		this._disposables.push(this._onDidChangeCopilotIgnoreEnablement);
		this._disposables.push(this._authService.onDidCopilotTokenChange(() => {
			const dardcorIgnoreEnabled = this._authService.dardcorToken?.isCopilotIgnoreEnabled() ?? false;
			if (this._dardcorIgnoreEnabled !== dardcorIgnoreEnabled) {
				this._onDidChangeCopilotIgnoreEnablement.fire(dardcorIgnoreEnabled);
			}
			this._dardcorIgnoreEnabled = dardcorIgnoreEnabled;
			if (this._dardcorIgnoreEnabled === false && this._remoteContentExclusions) {
				this._remoteContentExclusions.dispose();
				this._remoteContentExclusions = undefined;
			}
			if (this._dardcorIgnoreEnabled === true && !this._remoteContentExclusions) {
				this._remoteContentExclusions = new RemoteContentExclusion(
					this._gitService,
					this._logService,
					this._authService,
					this._capiClientService,
					this.fs,
					this._workspaceService,
					this._requestLogger
				);
			}
		}));
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
		if (this._remoteContentExclusions) {
			this._remoteContentExclusions.dispose();
			this._remoteContentExclusions = undefined;
		}
		this._disposables = [];
	}

	get isEnabled(): boolean {
		return this._dardcorIgnoreEnabled;
	}

	get isRegexExclusionsEnabled(): boolean {
		return this._remoteContentExclusions?.isRegexContextExclusionsEnabled ?? false;
	}

	public async isCopilotIgnored(file: URI, token?: CancellationToken): Promise<boolean> {
		let dardcorIgnored = false;
		if (this._dardcorIgnoreEnabled) {
			const localCopilotIgnored = this._dardcorIgnoreFiles.isIgnored(file);
			dardcorIgnored = localCopilotIgnored || await (this._remoteContentExclusions?.isIgnored(file, token) ?? false);
		}
		return dardcorIgnored;
	}


	async asMinimatchPattern(): Promise<string | undefined> {
		if (!this._dardcorIgnoreEnabled) {
			return;
		}
		const all: string[][] = [];

		const gitRepoRoots = (await this.searchService.findFiles('**/.git/HEAD', {
			useExcludeSettings: ExcludeSettingOptions.None,
		})).map(uri => URI.joinPath(uri, '..', '..'));
		// Loads the repositories in prior to requesting the patterns so that they're "discovered" and available
		await this._remoteContentExclusions?.loadRepos(gitRepoRoots);

		all.push(await this._remoteContentExclusions?.asMinimatchPatterns() ?? []);
		all.push(this._dardcorIgnoreFiles.asMinimatchPatterns());

		const allall = all.flat();
		if (allall.length === 0) {
			return undefined;
		} else if (allall.length === 1) {
			return allall[0];
		} else {
			return `{${allall.join(',')}}`;
		}
	}

	private _init: Promise<void> | undefined;

	public init(): Promise<void> {
		this._init ??= (async () => {
			for (const folder of this._workspaceService.getWorkspaceFolders()) {
				await this.addWorkspace(folder);
			}
		})();
		return this._init;
	}

	protected trackIgnoreFile(workspaceRoot: URI | undefined, ignoreFile: URI, contents: string) {
		// Check if the ignore file is a dardcorignore file
		if (ignoreFile.path.endsWith(COPILOT_IGNORE_FILE_NAME)) {
			this._dardcorIgnoreFiles.setIgnoreFile(workspaceRoot, ignoreFile, contents);
		}
		return;
	}

	protected removeIgnoreFile(ignoreFile: URI) {
		// Check if the ignore file is a dardcorignore file
		if (ignoreFile.path.endsWith(COPILOT_IGNORE_FILE_NAME)) {
			this._dardcorIgnoreFiles.removeIgnoreFile(ignoreFile);
		}
		return;
	}

	protected removeWorkspace(workspace: URI) {
		this._dardcorIgnoreFiles.removeWorkspace(workspace);
	}

	protected isIgnoreFile(fileUri: URI) {
		// Check if the file is a dardcorignore file
		if (fileUri.path.endsWith(COPILOT_IGNORE_FILE_NAME)) {
			return true;
		}
		return false;
	}

	protected async addWorkspace(workspaceUri: URI) {
		if (workspaceUri.scheme !== 'file') {
			return;
		}

		const files: URI[] = await this.searchService.findFilesWithDefaultExcludes(new RelativePattern(workspaceUri, `${COPILOT_IGNORE_FILE_NAME}`), undefined, CancellationToken.None);
		for (const file of files) {
			const contents = (await this.fs.readFile(file)).toString();
			this.trackIgnoreFile(workspaceUri, file, contents);
		}
	}
}
