/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILink } from '../../../../editor/common/languages.js';
import { URI } from '../../../../base/common/uri.js';
import * as extpath from '../../../../base/common/extpath.js';
import * as resources from '../../../../base/common/resources.js';
import * as strings from '../../../../base/common/strings.js';
import { Range } from '../../../../editor/common/core/range.js';
import { isWindows } from '../../../../base/common/platform.js';
import { Schemas } from '../../../../base/common/network.js';
import { IWebWorkerServerRequestHandler, IWebWorkerServer } from '../../../../base/common/worker/webWorker.js';
import { WorkerTextModelSyncServer, ICommonModel } from '../../../../editor/common/services/textModelSync/textModelSync.impl.js';

export interface IResourceCreator {
	toResource: (folderRelativePath: string) => URI | null;
}

export class OutputLinkComputer implements IWebWorkerServerRequestHandler {
	_requestHandlerBrand: void = undefined;

	private readonly workerTextModelSyncServer = new WorkerTextModelSyncServer();
	private patterns = new Map<URI , RegExp[]>();

	constructor(workerServer: IWebWorkerServer) {
		this.workerTextModelSyncServer.bindToServer(workerServer);
	}

	$setWorkspaceFolders(workspaceFolders: string[]) {
		this.computePatterns(workspaceFolders);
	}

	private computePatterns(_workspaceFolders: string[]): void {

		const workspaceFolders = _workspaceFolders
			.sort((resourceStrA, resourceStrB) => resourceStrB.length - resourceStrA.length)
			.map(resourceStr => URI.parse(resourceStr));

		for (const workspaceFolder of workspaceFolders) {
			const patterns = OutputLinkComputer.createPatterns(workspaceFolder);
			this.patterns.set(workspaceFolder, patterns);
		}
	}

	private getModel(uri: string): ICommonModel | undefined {
		return this.workerTextModelSyncServer.getModel(uri);
	}

	$computeLinks(uri: string): ILink[] {
		const model = this.getModel(uri);
		if (!model) {
			return [];
		}

		const links: ILink[] = [];
		const lines = strings.splitLines(model.getValue());

		for (const [folderUri, folderPatterns] of this.patterns) {
			const resourceCreator: IResourceCreator = {
				toResource: (folderRelativePath: string): URI | null => {
					if (typeof folderRelativePath === 'string') {
						return resources.joinPath(folderUri, folderRelativePath);
					}

					return null;
				}
			};

			for (let i = 0, len = lines.length; i < len; i++) {
				links.push(...OutputLinkComputer.detectLinks(lines[i], i + 1, folderPatterns, resourceCreator));
			}
		}

		return links;
	}

	static createPatterns(workspaceFolder: URI): RegExp[] {
		const patterns: RegExp[] = [];

		const workspaceFolderPath = workspaceFolder.scheme === Schemas.file ? workspaceFolder.fsPath : workspaceFolder.path;
		const workspaceFolderVariants = [workspaceFolderPath];
		if (isWindows && workspaceFolder.scheme === Schemas.file) {
			workspaceFolderVariants.push(extpath.toSlashes(workspaceFolderPath));
		}

		for (const workspaceFolderVariant of workspaceFolderVariants) {
			const validPathCharacterPattern = '[^\\s\\(\\):<>\'"]';
			const validPathCharacterOrSpacePattern = `(?:${validPathCharacterPattern}| ${validPathCharacterPattern})`;
			const pathPattern = `${validPathCharacterOrSpacePattern}+\\.${validPathCharacterPattern}+`;
			const strictPathPattern = `${validPathCharacterPattern}+`;

			patterns.push(new RegExp(strings.escapeRegExpCharacters(workspaceFolderVariant) + `(${pathPattern}) on line ((\\d+)(, column (\\d+))?)`, 'gi'));

			patterns.push(new RegExp(strings.escapeRegExpCharacters(workspaceFolderVariant) + `(${pathPattern}):line ((\\d+)(, column (\\d+))?)`, 'gi'));

			patterns.push(new RegExp(strings.escapeRegExpCharacters(workspaceFolderVariant) + `(${pathPattern})(\\s?\\((\\d+)(,(\\d+))?)\\)`, 'gi'));

			patterns.push(new RegExp(strings.escapeRegExpCharacters(workspaceFolderVariant) + `(${strictPathPattern})(:(\\d+))?(:(\\d+))?`, 'gi'));
		}

		return patterns;
	}

	static detectLinks(line: string, lineIndex: number, patterns: RegExp[], resourceCreator: IResourceCreator): ILink[] {
		const links: ILink[] = [];

		patterns.forEach(pattern => {
			pattern.lastIndex = 0;

			let match: RegExpExecArray | null;
			let offset = 0;
			while ((match = pattern.exec(line)) !== null) {

				const folderRelativePath = strings.rtrim(match[1], '.').replace(/\\/g, '/');
				let resourceString: string | undefined;
				try {
					const resource = resourceCreator.toResource(folderRelativePath);
					if (resource) {
						resourceString = resource.toString();
					}
				} catch (error) {
					continue;
				}

				if (match[3]) {
					const lineNumber = match[3];

					if (match[5]) {
						const columnNumber = match[5];
						resourceString = strings.format('{0}#{1},{2}', resourceString, lineNumber, columnNumber);
					} else {
						resourceString = strings.format('{0}#{1}', resourceString, lineNumber);
					}
				}

				const fullMatch = strings.rtrim(match[0], '.');

				const index = line.indexOf(fullMatch, offset);
				offset = index + fullMatch.length;

				const linkRange = {
					startColumn: index + 1,
					startLineNumber: lineIndex,
					endColumn: index + 1 + fullMatch.length,
					endLineNumber: lineIndex
				};

				if (links.some(link => Range.areIntersectingOrTouching(link.range, linkRange))) {
					return;
				}

				links.push({
					range: linkRange,
					url: resourceString
				});
			}
		});

		return links;
	}
}

export function create(workerServer: IWebWorkerServer): OutputLinkComputer {
	return new OutputLinkComputer(workerServer);
}
