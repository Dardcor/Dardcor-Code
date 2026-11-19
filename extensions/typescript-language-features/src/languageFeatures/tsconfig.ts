/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as jsonc from 'jsonc-parser';
import { isAbsolute, posix } from 'path';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
import { coalesce } from '../utils/arrays';
import { exists, looksLikeAbsoluteWindowsPath } from '../utils/fs';

function mapChildren<R>(node: jsonc.Node | undefined, f: (x: jsonc.Node) => R): R[] {
	return node && node.type === 'array' && node.children
		? node.children.map(f)
		: [];
}

const openExtendsLinkCommandId = '_typescript.openExtendsLink';

enum TsConfigLinkType {
	Extends,
	References
}

type OpenExtendsLinkCommandArgs = {
	readonly resourceUri: vscode.Uri;
	readonly extendsValue: string;
	readonly linkType: TsConfigLinkType;
};


class TsconfigLinkProvider implements vscode.DocumentLinkProvider {

	public provideDocumentLinks(
		document: vscode.TextDocument,
		_token: vscode.CancellationToken
	): vscode.DocumentLink[] {
		const root = jsonc.parseTree(document.getText());
		if (!root) {
			return [];
		}

		return coalesce([
			this.getExtendsLink(document, root),
			...this.getFilesLinks(document, root),
			...this.getReferencesLinks(document, root)
		]);
	}

	private getExtendsLink(document: vscode.TextDocument, root: jsonc.Node): vscode.DocumentLink | undefined {
		const node = jsonc.findNodeAtLocation(root, ['extends']);
		return node && this.tryCreateTsConfigLink(document, node, TsConfigLinkType.Extends);
	}

	private getReferencesLinks(document: vscode.TextDocument, root: jsonc.Node) {
		return mapChildren(
			jsonc.findNodeAtLocation(root, ['references']),
			child => {
				const pathNode = jsonc.findNodeAtLocation(child, ['path']);
				return pathNode && this.tryCreateTsConfigLink(document, pathNode, TsConfigLinkType.References);
			});
	}

	private tryCreateTsConfigLink(document: vscode.TextDocument, node: jsonc.Node, linkType: TsConfigLinkType): vscode.DocumentLink | undefined {
		if (!this.isPathValue(node)) {
			return undefined;
		}

		const args: OpenExtendsLinkCommandArgs = {
			resourceUri: { ...document.uri.toJSON(), $mid: undefined },
			extendsValue: node.value,
			linkType
		};

		const link = new vscode.DocumentLink(
			this.getRange(document, node),
			vscode.Uri.parse(`command:${openExtendsLinkCommandId}?${JSON.stringify(args)}`));
		link.tooltip = vscode.l10n.t("Follow link");
		return link;
	}

	private getFilesLinks(document: vscode.TextDocument, root: jsonc.Node) {
		return mapChildren(
			jsonc.findNodeAtLocation(root, ['files']),
			child => this.pathNodeToLink(document, child));
	}

	private pathNodeToLink(
		document: vscode.TextDocument,
		node: jsonc.Node | undefined
	): vscode.DocumentLink | undefined {
		return this.isPathValue(node)
			? new vscode.DocumentLink(this.getRange(document, node), this.getFileTarget(document, node))
			: undefined;
	}

	private isPathValue(node: jsonc.Node | undefined): node is jsonc.Node {
		return node
			&& node.type === 'string'
			&& node.value
			&& !(node.value as string).includes('*');
	}

	private getFileTarget(document: vscode.TextDocument, node: jsonc.Node): vscode.Uri {
		if (isAbsolute(node.value)) {
			return vscode.Uri.file(node.value);
		}

		return vscode.Uri.joinPath(Utils.dirname(document.uri), node.value);
	}

	private getRange(document: vscode.TextDocument, node: jsonc.Node) {
		const offset = node.offset;
		const start = document.positionAt(offset + 1);
		const end = document.positionAt(offset + (node.length - 1));
		return new vscode.Range(start, end);
	}
}

async function resolveNodeModulesPath(baseDirUri: vscode.Uri, pathCandidates: string[]): Promise<vscode.Uri | undefined> {
	let currentUri = baseDirUri;
	const baseCandidate = pathCandidates[0];
	const sepIndex = baseCandidate.startsWith('@') ? 2 : 1;
	const moduleBasePath = baseCandidate.split(posix.sep).slice(0, sepIndex).join(posix.sep);
	while (true) {
		const moduleAbsoluteUrl = vscode.Uri.joinPath(currentUri, 'node_modules', moduleBasePath);
		let moduleStat: vscode.FileStat | undefined;
		try {
			moduleStat = await vscode.workspace.fs.stat(moduleAbsoluteUrl);
		} catch (err) {
		}

		if (moduleStat && (moduleStat.type & vscode.FileType.Directory)) {
			for (const uriCandidate of pathCandidates
				.map((relativePath) => relativePath.split(posix.sep).slice(sepIndex).join(posix.sep))
				.filter(Boolean)
				.map((relativeModulePath) => vscode.Uri.joinPath(moduleAbsoluteUrl, relativeModulePath))
			) {
				if (await exists(uriCandidate)) {
					return uriCandidate;
				}
			}
		}

		const oldUri = currentUri;
		currentUri = vscode.Uri.joinPath(currentUri, '..');

		if (oldUri.path === currentUri.path) {
			return;
		}
	}
}

async function getTsconfigPath(baseDirUri: vscode.Uri, pathValue: string, linkType: TsConfigLinkType): Promise<vscode.Uri | undefined> {
	async function resolve(absolutePath: vscode.Uri): Promise<vscode.Uri> {
		if (absolutePath.path.endsWith('.json') || await exists(absolutePath)) {
			return absolutePath;
		}
		return absolutePath.with({
			path: `${absolutePath.path}${linkType === TsConfigLinkType.References ? '/tsconfig.json' : '.json'}`
		});
	}

	const isRelativePath = ['./', '../'].some(str => pathValue.startsWith(str));
	if (isRelativePath) {
		return resolve(vscode.Uri.joinPath(baseDirUri, pathValue));
	}

	if (pathValue.startsWith('/') || looksLikeAbsoluteWindowsPath(pathValue)) {
		return resolve(vscode.Uri.file(pathValue));
	}

	return resolveNodeModulesPath(baseDirUri, [
		pathValue,
		...pathValue.endsWith('.json') ? [] : [
			`${pathValue}.json`,
			`${pathValue}/tsconfig.json`,
		]
	]);
}

export function register() {
	const patterns: vscode.GlobPattern[] = [
		'**/[jt]sconfig.json',
		'**/[jt]sconfig.*.json',
	];

	const languages = ['json', 'jsonc'];

	const selector: vscode.DocumentSelector =
		languages.map(language => patterns.map((pattern): vscode.DocumentFilter => ({ language, pattern })))
			.flat();

	return vscode.Disposable.from(
		vscode.commands.registerCommand(openExtendsLinkCommandId, async ({ resourceUri, extendsValue, linkType }: OpenExtendsLinkCommandArgs) => {
			const tsconfigPath = await getTsconfigPath(Utils.dirname(vscode.Uri.from(resourceUri)), extendsValue, linkType);
			if (tsconfigPath === undefined) {
				vscode.window.showErrorMessage(vscode.l10n.t("Failed to resolve {0} as module", extendsValue));
				return;
			}
			await vscode.commands.executeCommand('vscode.open', tsconfigPath);
		}),
		vscode.languages.registerDocumentLinkProvider(selector, new TsconfigLinkProvider()),
	);
}
