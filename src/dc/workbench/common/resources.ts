/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../base/common/uri.js';
import { equals } from '../../base/common/objects.js';
import { isAbsolute } from '../../base/common/path.js';
import { Emitter } from '../../base/common/event.js';
import { relativePath } from '../../base/common/resources.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { ParsedExpression, IExpression, parse } from '../../base/common/glob.js';
import { IWorkspaceContextService } from '../../platform/workspace/common/workspace.js';
import { IConfigurationService, IConfigurationChangeEvent } from '../../platform/configuration/common/configuration.js';
import { Schemas } from '../../base/common/network.js';
import { ResourceSet } from '../../base/common/map.js';
import { getDriveLetter } from '../../base/common/extpath.js';

interface IConfiguredExpression {
	readonly expression: IExpression;
	readonly hasAbsolutePath: boolean;
}

export class ResourceGlobMatcher extends Disposable {

	private static readonly NO_FOLDER = null;

	private readonly _onExpressionChange = this._register(new Emitter<void>());
	readonly onExpressionChange = this._onExpressionChange.event;

	private readonly mapFolderToParsedExpression = new Map<string | null, ParsedExpression>();
	private readonly mapFolderToConfiguredExpression = new Map<string | null, IConfiguredExpression>();

	constructor(
		private getExpression: (folder?: URI) => IExpression | undefined,
		private shouldUpdate: (event: IConfigurationChangeEvent) => boolean,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		this.updateExpressions(false);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (this.shouldUpdate(e)) {
				this.updateExpressions(true);
			}
		}));

		this._register(this.contextService.onDidChangeWorkspaceFolders(() => this.updateExpressions(true)));
	}

	private updateExpressions(fromEvent: boolean): void {
		let changed = false;

		for (const folder of this.contextService.getWorkspace().folders) {
			const folderUriStr = folder.uri.toString();

			const newExpression = this.doGetExpression(folder.uri);
			const currentExpression = this.mapFolderToConfiguredExpression.get(folderUriStr);

			if (newExpression) {
				if (!currentExpression || !equals(currentExpression.expression, newExpression.expression)) {
					changed = true;

					this.mapFolderToParsedExpression.set(folderUriStr, parse(newExpression.expression));
					this.mapFolderToConfiguredExpression.set(folderUriStr, newExpression);
				}
			} else {
				if (currentExpression) {
					changed = true;

					this.mapFolderToParsedExpression.delete(folderUriStr);
					this.mapFolderToConfiguredExpression.delete(folderUriStr);
				}
			}
		}

		const foldersMap = new ResourceSet(this.contextService.getWorkspace().folders.map(folder => folder.uri));
		for (const [folder] of this.mapFolderToConfiguredExpression) {
			if (folder === ResourceGlobMatcher.NO_FOLDER) {
				continue;
			}

			if (!foldersMap.has(URI.parse(folder))) {
				this.mapFolderToParsedExpression.delete(folder);
				this.mapFolderToConfiguredExpression.delete(folder);

				changed = true;
			}
		}

		const globalNewExpression = this.doGetExpression(undefined);
		const globalCurrentExpression = this.mapFolderToConfiguredExpression.get(ResourceGlobMatcher.NO_FOLDER);
		if (globalNewExpression) {
			if (!globalCurrentExpression || !equals(globalCurrentExpression.expression, globalNewExpression.expression)) {
				changed = true;

				this.mapFolderToParsedExpression.set(ResourceGlobMatcher.NO_FOLDER, parse(globalNewExpression.expression));
				this.mapFolderToConfiguredExpression.set(ResourceGlobMatcher.NO_FOLDER, globalNewExpression);
			}
		} else {
			if (globalCurrentExpression) {
				changed = true;

				this.mapFolderToParsedExpression.delete(ResourceGlobMatcher.NO_FOLDER);
				this.mapFolderToConfiguredExpression.delete(ResourceGlobMatcher.NO_FOLDER);
			}
		}

		if (fromEvent && changed) {
			this._onExpressionChange.fire();
		}
	}

	private doGetExpression(resource: URI | undefined): IConfiguredExpression | undefined {
		const expression = this.getExpression(resource);
		if (!expression) {
			return undefined;
		}

		const keys = Object.keys(expression);
		if (keys.length === 0) {
			return undefined;
		}

		let hasAbsolutePath = false;


		const massagedExpression: IExpression = Object.create(null);
		for (const key of keys) {
			if (!hasAbsolutePath) {
				hasAbsolutePath = isAbsolute(key);
			}

			let massagedKey = key;

			const driveLetter = getDriveLetter(massagedKey, true );
			if (driveLetter) {
				const driveLetterLower = driveLetter.toLowerCase();
				if (driveLetter !== driveLetter.toLowerCase()) {
					massagedKey = `${driveLetterLower}${massagedKey.substring(1)}`;
				}
			}

			massagedExpression[massagedKey] = expression[key];
		}

		return {
			expression: massagedExpression,
			hasAbsolutePath
		};
	}

	matches(
		resource: URI,
		hasSibling?: (name: string) => boolean
	): boolean {
		if (this.mapFolderToParsedExpression.size === 0) {
			return false;
		}

		const folder = this.contextService.getWorkspaceFolder(resource);
		let expressionForFolder: ParsedExpression | undefined;
		let expressionConfigForFolder: IConfiguredExpression | undefined;
		if (folder && this.mapFolderToParsedExpression.has(folder.uri.toString())) {
			expressionForFolder = this.mapFolderToParsedExpression.get(folder.uri.toString());
			expressionConfigForFolder = this.mapFolderToConfiguredExpression.get(folder.uri.toString());
		} else {
			expressionForFolder = this.mapFolderToParsedExpression.get(ResourceGlobMatcher.NO_FOLDER);
			expressionConfigForFolder = this.mapFolderToConfiguredExpression.get(ResourceGlobMatcher.NO_FOLDER);
		}

		if (!expressionForFolder) {
			return false;
		}


		let resourcePathToMatch: string | undefined;
		if (folder) {
			resourcePathToMatch = relativePath(folder.uri, resource);
		} else {
			resourcePathToMatch = this.uriToPath(resource);
		}

		if (typeof resourcePathToMatch === 'string' && !!expressionForFolder(resourcePathToMatch, undefined, hasSibling)) {
			return true;
		}


		if (resourcePathToMatch !== this.uriToPath(resource) && expressionConfigForFolder?.hasAbsolutePath) {
			return !!expressionForFolder(this.uriToPath(resource), undefined, hasSibling);
		}

		return false;
	}

	private uriToPath(uri: URI): string {
		if (uri.scheme === Schemas.file) {
			return uri.fsPath;
		}

		return uri.path;
	}
}
