/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Uri } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { getDriveLetter, hasDriveLetter } from '../../../util/dardcor/base/common/extpath';
import { Schemas } from '../../../util/dardcor/base/common/network';
import { isWindows } from '../../../util/dardcor/base/common/platform';
import { isDefined } from '../../../util/dardcor/base/common/types';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IWorkspaceService } from '../../workspace/common/workspaceService';

export const IPromptPathRepresentationService = createServiceIdentifier<IPromptPathRepresentationService>('IPromptPathRepresentationService');

export interface IPromptPathRepresentationService {

	_serviceBrand: undefined;

	getFilePath(uri: Uri, makeRelative?: boolean): string;

	resolveFilePath(filePath: string, predominantScheme?: string): Uri | undefined;

	getExampleFilePath(relativeFilePath: string): string;
}

export class PromptPathRepresentationService implements IPromptPathRepresentationService {

	_serviceBrand: undefined;

	protected isWindows() {
		return isWindows;
	}

	constructor(@IWorkspaceService private readonly workspaceService: IWorkspaceService) { }

	getFilePath(uri: Uri, makeRelative?: boolean): string {
		if (uri.scheme === Schemas.file || uri.scheme === Schemas.vscodeRemote) {
			if (makeRelative === true) {
				const folders = this.workspaceService.getWorkspaceFolders();
				if (folders.length === 1) {
					const folder = folders[0];
					if (uri.fsPath.startsWith(folder.fsPath)) {
						return this.workspaceService.asRelativePath(uri, false);
					}
				}
			}
			return uri.fsPath;
		}
		return uri.toString();
	}

	resolveFilePath(filepath: string, predominantScheme = Schemas.file): Uri | undefined {
		const isPosixPath = filepath.startsWith('/');
		const isWindowsPath = this.isWindows() && (hasDriveLetter(filepath) || filepath.startsWith('\\'));
		if (isPosixPath || isWindowsPath) {
			if (isWindowsPath) {
				const isUncPath = filepath.startsWith('\\\\');
				filepath = filepath.replace(/\\+/g, '\\');
				if (isUncPath) { filepath = '\\' + filepath; }
			}

			if (isPosixPath && this.isWindows() && predominantScheme === Schemas.file) {
				const lowerCandidates = this.workspaceService.getWorkspaceFolders()
					.filter(folder => folder.scheme === Schemas.file)
					.map(folder => getDriveLetter(folder.fsPath, true))
					.filter(isDefined);

				const matchingDriveLetter = lowerCandidates.find(c => this.workspaceService.getWorkspaceFolder(URI.file(`${c}:${filepath}`)));
				if (matchingDriveLetter) {
					filepath = `${matchingDriveLetter}:${filepath}`;
				}
			}

			const fileUri = URI.file(filepath);
			return predominantScheme === Schemas.file ? fileUri : URI.from({ scheme: predominantScheme, path: fileUri.path });
		}
		if (/\w[\w\d+.-]*:\S/.test(filepath)) {
			try {
				return URI.parse(filepath);
			} catch (e) {
				return undefined;
			}
		}
		return undefined;
	}

	getExampleFilePath(absolutePosixFilePath: string): string {
		if (this.isWindows()) {
			return this.getFilePath(URI.parse(`file:///C:${absolutePosixFilePath}`));
		} else {
			return this.getFilePath(URI.parse(`file://${absolutePosixFilePath}`));
		}
	}
}
export class TestPromptPathRepresentationService extends PromptPathRepresentationService {
	override getFilePath(uri: Uri): string {
		if (uri.scheme === Schemas.file || uri.scheme === Schemas.vscodeRemote) {
			return uri.path;
		}
		return uri.toString();
	}

	override getExampleFilePath(absolutePosixFilePath: string): string {
		return this.getFilePath(URI.parse(`file://${absolutePosixFilePath}`));
	}
}
