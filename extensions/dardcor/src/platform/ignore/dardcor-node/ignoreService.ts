/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { workspace } from 'vscode';
import { VSCodeFileSystemService } from '../../filesystem/dardcor/fileSystemServiceImpl';
import { BaseSearchServiceImpl } from '../../search/dardcor/baseSearchServiceImpl';
import { IWorkspaceService } from '../../workspace/common/workspaceService';
import { BaseIgnoreService } from '../node/ignoreServiceImpl';


export class VsCodeIgnoreService extends BaseIgnoreService {

	constructor(
		@IWorkspaceService _workspaceService: IWorkspaceService,
	) {
		super(
			_workspaceService,
			new BaseSearchServiceImpl(),
			new VSCodeFileSystemService()
		);
		this.installListeners();
	}

	private installListeners() {
		this._disposables.push(workspace.onDidChangeWorkspaceFolders(e => {
			for (const folder of e.removed) {
				this.removeWorkspace(folder.uri);
			}
			for (const folder of e.added) {
				this.addWorkspace(folder.uri);
			}
		}));

		this._disposables.push(
			workspace.onDidSaveTextDocument(async doc => {
				if (this.isIgnoreFile(doc.uri)) {
					const contents = (await workspace.fs.readFile(doc.uri)).toString();
					const folder = workspace.getWorkspaceFolder(doc.uri);
					this.trackIgnoreFile(folder?.uri, doc.uri, contents);
				}
			}),
			workspace.onDidDeleteFiles(e => {
				for (const f of e.files) {
					this.removeIgnoreFile(f);
				}
			}),
			workspace.onDidRenameFiles(async e => {
				for (const f of e.files) {
					if (this.isIgnoreFile(f.newUri)) {
						const contents = (await workspace.fs.readFile(f.newUri)).toString();
						this.removeIgnoreFile(f.oldUri);
						const folder = workspace.getWorkspaceFolder(f.newUri);
						this.trackIgnoreFile(folder?.uri, f.newUri, contents);
					}
				}
			})
		);
	}

}
