/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';

type OverwriteBehavior = 'overwrite' | 'nameIncrementally';

export interface CopyFileConfiguration {
	readonly destination: Record<string, string>;
	readonly overwriteBehavior: OverwriteBehavior;
}

export function getCopyFileConfiguration(document: vscode.TextDocument): CopyFileConfiguration {
	const config = vscode.workspace.getConfiguration('markdown', document);
	return {
		destination: config.get<Record<string, string>>('copyFiles.destination') ?? {},
		overwriteBehavior: readOverwriteBehavior(config),
	};
}

function readOverwriteBehavior(config: vscode.WorkspaceConfiguration): OverwriteBehavior {
	switch (config.get('copyFiles.overwriteBehavior')) {
		case 'overwrite': return 'overwrite';
		default: return 'nameIncrementally';
	}
}

export function parseGlob(rawGlob: string): Iterable<string> {
	if (rawGlob.startsWith('/')) {
		return (vscode.workspace.workspaceFolders ?? []).map(folder => vscode.Uri.joinPath(folder.uri, rawGlob).path);
	}

	if (!rawGlob.startsWith('**')) {
		return ['**/' + rawGlob];
	}

	return [rawGlob];
}

type GetWorkspaceFolder = (documentUri: vscode.Uri) => vscode.Uri | undefined;

export function resolveCopyDestination(documentUri: vscode.Uri, fileName: string, dest: string, getWorkspaceFolder: GetWorkspaceFolder): vscode.Uri {
	const resolvedDest = resolveCopyDestinationSetting(documentUri, fileName, dest, getWorkspaceFolder);

	if (resolvedDest.startsWith('/')) {
		return Utils.resolvePath(documentUri, resolvedDest);
	}

	const dirName = Utils.dirname(documentUri);
	return Utils.resolvePath(dirName, resolvedDest);
}


function resolveCopyDestinationSetting(documentUri: vscode.Uri, fileName: string, dest: string, getWorkspaceFolder: GetWorkspaceFolder): string {
	let outDest = dest.trim();
	if (!outDest) {
		outDest = '${fileName}';
	}

	if (outDest.startsWith('/')) {
		outDest = '${documentWorkspaceFolder}/' + outDest.slice(1);
	}

	if (outDest.endsWith('/')) {
		outDest += '${fileName}';
	}

	const documentDirName = Utils.dirname(documentUri);
	const documentBaseName = Utils.basename(documentUri);
	const documentExtName = Utils.extname(documentUri);

	const workspaceFolder = getWorkspaceFolder(documentUri);

	const vars = new Map<string, string>([
		['documentDirName', documentDirName.path],
		['documentRelativeDirName', workspaceFolder ? path.posix.relative(workspaceFolder.path, documentDirName.path) : documentDirName.path],
		['documentFileName', documentBaseName],
		['documentBaseName', documentBaseName.slice(0, documentBaseName.length - documentExtName.length)],
		['documentExtName', documentExtName.replace('.', '')],
		['documentFilePath', documentUri.path],
		['documentRelativeFilePath', workspaceFolder ? path.posix.relative(workspaceFolder.path, documentUri.path) : documentUri.path],

		['documentWorkspaceFolder', ((workspaceFolder ?? documentDirName).path)],

		['fileName', fileName],
		['fileExtName', path.extname(fileName).replace('.', '')],
		['unixTime', Date.now().toString()],
		['isoTime', new Date().toISOString()],
	]);

	return outDest.replaceAll(/(?<escape>\\\$)|(?<!\\)\$\{(?<name>\w+)(?:\/(?<pattern>(?:\\\/|[^\}\/])+)\/(?<replacement>(?:\\\/|[^\}\/])*)\/)?\}/g, (match, _escape, name, pattern, replacement, _offset, _str, groups) => {
		if (groups?.['escape']) {
			return '$';
		}

		const entry = vars.get(name);
		if (typeof entry !== 'string') {
			return match;
		}

		if (pattern && replacement) {
			try {
				return entry.replace(new RegExp(replaceTransformEscapes(pattern)), replaceTransformEscapes(replacement));
			} catch (e) {
				console.log(`Error applying 'resolveCopyDestinationSetting' transform: ${pattern} -> ${replacement}`);
			}
		}

		return entry;
	});
}

function replaceTransformEscapes(str: string): string {
	return str.replaceAll(/\\\//g, '/');
}
