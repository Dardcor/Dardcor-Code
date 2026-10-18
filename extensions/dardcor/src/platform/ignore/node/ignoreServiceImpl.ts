/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IFileSystemService } from '../../filesystem/common/fileSystemService';
import { RelativePattern } from '../../filesystem/common/fileTypes';
import { ISearchService } from '../../search/common/searchService';
import { IWorkspaceService } from '../../workspace/common/workspaceService';
import { IIgnoreService } from '../common/ignoreService';
import { IgnoreFile } from './ignoreFile';

export const DARDCOR_IGNORE_FILE_NAME = '.dardcorignore';

export class BaseIgnoreService implements IIgnoreService {

	declare readonly _serviceBrand: undefined;

	private readonly _dardcorIgnoreFiles = new IgnoreFile();

	protected _disposables: IDisposable[] = [];

	constructor(
		private readonly _workspaceService: IWorkspaceService,
		private readonly searchService: ISearchService,
		private readonly fs: IFileSystemService,
	) {
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];
	}

	get isEnabled(): boolean {
		return true;
	}

	get isRegexExclusionsEnabled(): boolean {
		return false;
	}

	public async isIgnored(file: URI, _token?: CancellationToken): Promise<boolean> {
		return this._dardcorIgnoreFiles.isIgnored(file);
	}


	async asMinimatchPattern(): Promise<string | undefined> {
		const allall = this._dardcorIgnoreFiles.asMinimatchPatterns();
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
		if (ignoreFile.path.endsWith(DARDCOR_IGNORE_FILE_NAME)) {
			this._dardcorIgnoreFiles.setIgnoreFile(workspaceRoot, ignoreFile, contents);
		}
		return;
	}

	protected removeIgnoreFile(ignoreFile: URI) {
		if (ignoreFile.path.endsWith(DARDCOR_IGNORE_FILE_NAME)) {
			this._dardcorIgnoreFiles.removeIgnoreFile(ignoreFile);
		}
		return;
	}

	protected removeWorkspace(workspace: URI) {
		this._dardcorIgnoreFiles.removeWorkspace(workspace);
	}

	protected isIgnoreFile(fileUri: URI) {
		if (fileUri.path.endsWith(DARDCOR_IGNORE_FILE_NAME)) {
			return true;
		}
		return false;
	}

	protected async addWorkspace(workspaceUri: URI) {
		if (workspaceUri.scheme !== 'file') {
			return;
		}

		const files: URI[] = await this.searchService.findFilesWithDefaultExcludes(new RelativePattern(workspaceUri, `${DARDCOR_IGNORE_FILE_NAME}`), undefined, CancellationToken.None);
		for (const file of files) {
			const contents = (await this.fs.readFile(file)).toString();
			this.trackIgnoreFile(workspaceUri, file, contents);
		}
	}
}
