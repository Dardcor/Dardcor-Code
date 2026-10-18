/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { getWorkspaceFileDisplayPath, IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { normalizePath as normalizeUriPath } from '../../../util/dardcor/base/common/resources';
import { Location, Position, Range, Uri } from '../../../dardcorTypes';
import { coalesceParts, LinkifiedPart, LinkifiedText, LinkifyLocationAnchor } from './linkifiedText';
import { IContributedLinkifier, LinkifierContext } from './linkifyService';
import { IStatCache } from './statCache';

const modelLinkRe = /\[(?<text>[^\]\n]+)\]\((?<target>[^\s)]+)\)/gu;

export class ModelFilePathLinkifier implements IContributedLinkifier {
	constructor(
		private readonly workspaceService: IWorkspaceService,
		private readonly statCache: IStatCache,
	) { }

	async linkify(text: string, context: LinkifierContext, token: CancellationToken): Promise<LinkifiedText | undefined> {
		let lastIndex = 0;
		const parts: Array<LinkifiedPart | Promise<LinkifiedPart>> = [];
		const workspaceFolders = this.workspaceService.getWorkspaceFolders();

		for (const match of text.matchAll(modelLinkRe)) {
			const original = match[0];
			const prefix = text.slice(lastIndex, match.index);
			if (prefix) {
				parts.push(prefix);
			}
			lastIndex = match.index + original.length;

			const parsed = this.parseModelLinkMatch(match);
			if (!parsed) {
				parts.push(original);
				continue;
			}

			if (!this.canLinkify(parsed, workspaceFolders)) {
				parts.push(original);
				continue;
			}

			parts.push(this.resolveTarget(parsed.targetPath, parsed.originalTargetPath, workspaceFolders, parsed.preserveDirectorySlash, token).then(resolved => {
				if (!resolved) {
					return original;
				}

				const basePath = getWorkspaceFileDisplayPath(this.workspaceService, resolved);
				const anchorRange = this.parseAnchor(parsed.anchor);
				if (parsed.anchor && !anchorRange) {
					return original;
				}

				if (anchorRange) {
					const { range, startLine, endLine } = anchorRange;
					const displayPath = endLine && startLine !== endLine
						? `${basePath}#L${startLine}-L${endLine}`
						: `${basePath}#L${startLine}`;
					return new LinkifyLocationAnchor(new Location(resolved, range), displayPath);
				}

				return new LinkifyLocationAnchor(resolved, basePath);
			}));
		}

		const suffix = text.slice(lastIndex);
		if (suffix) {
			parts.push(suffix);
		}

		if (!parts.length) {
			return undefined;
		}

		return { parts: coalesceParts(await Promise.all(parts)) };
	}

	private parseModelLinkMatch(match: RegExpMatchArray): { readonly text: string; readonly targetPath: string; readonly anchor: string | undefined; readonly preserveDirectorySlash: boolean; readonly originalTargetPath: string } | undefined {
		const rawText = match.groups?.['text'];
		const rawTarget = match.groups?.['target'];
		if (!rawText || !rawTarget) {
			return undefined;
		}

		const hashIndex = rawTarget.indexOf('#');
		const baseTarget = hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex);
		const anchor = hashIndex === -1 ? undefined : rawTarget.slice(hashIndex + 1);

		let decodedBase = baseTarget;
		try {
			decodedBase = decodeURIComponent(baseTarget);
		} catch {
		}

		const preserveDirectorySlash = decodedBase.endsWith('/') && decodedBase.length > 1;
		const normalizedTarget = this.normalizeSlashes(decodedBase);
		const normalizedText = this.normalizeLinkText(rawText);
		return { text: normalizedText, targetPath: normalizedTarget, anchor, preserveDirectorySlash, originalTargetPath: decodedBase };
	}

	private normalizeSlashes(value: string): string {
		return value.replace(/\\+/g, '/');
	}

	private normalizeLinkText(rawText: string): string {
		let text = this.normalizeSlashes(rawText);
		text = text.replace(/^`|`$/g, '');

		const anchorMatch = /^(.+?)(#L\d+(?:-\d+)?)$/.exec(text);
		return anchorMatch ? anchorMatch[1] : text;
	}

	private canLinkify(parsed: { readonly text: string; readonly targetPath: string; readonly anchor: string | undefined }, workspaceFolders: readonly Uri[]): boolean {
		const { text, targetPath, anchor } = parsed;
		const textMatchesBase = targetPath === text;
		const textIsFilename = !text.includes('/') && targetPath.endsWith(`/${text}`);

		let descriptiveWithAnchor = false;
		if (anchor) {
			const textLooksLikeFilename = /\.\w+$/.test(text);
			if (textLooksLikeFilename) {
				const targetBasename = targetPath.split('/').pop() ?? '';
				const textBasename = text.split('/').pop() ?? '';
				descriptiveWithAnchor = textBasename === targetBasename;
			} else {
				descriptiveWithAnchor = true;
			}
		}

		return Boolean(workspaceFolders.length) && (textMatchesBase || textIsFilename || descriptiveWithAnchor);
	}

	private async resolveTarget(targetPath: string, originalTargetPath: string, workspaceFolders: readonly Uri[], preserveDirectorySlash: boolean, token: CancellationToken): Promise<Uri | undefined> {
		if (!workspaceFolders.length) {
			return undefined;
		}

		if (token.isCancellationRequested) {
			return undefined;
		}

		if (this.isAbsolutePath(targetPath)) {
			const normalizedAbs = targetPath.replace(/\\/g, '/');

			const candidates: Uri[] = [];
			for (const folderUri of workspaceFolders) {
				if (folderUri.scheme === 'file') {
					const absoluteFileUri = this.tryCreateFileUri(originalTargetPath);
					if (absoluteFileUri && this.isEqualOrParent(absoluteFileUri, folderUri)) {
						candidates.push(absoluteFileUri);
					}
				} else {
					const folderPath = folderUri.path.replace(/\\/g, '/');
					const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
					if (normalizedAbs.startsWith(prefix)) {
						candidates.push(folderUri.with({ path: normalizedAbs }));
					}
				}
			}

			if (candidates.length) {
				const results = await Promise.all(candidates.map(c => this.tryStat(c, preserveDirectorySlash, token)));
				const found = results.find((r): r is Uri => r !== undefined);
				if (found) {
					return found;
				}
			}
			return undefined;
		}

		const segments = targetPath.split('/').filter(Boolean);
		const candidates = workspaceFolders.map(folderUri => Uri.joinPath(folderUri, ...segments));
		const results = await Promise.all(candidates.map(c => this.tryStat(c, preserveDirectorySlash, token)));
		const found = results.find((r): r is Uri => r !== undefined);
		if (found) {
			return found;
		}

		return undefined;
	}

	private tryCreateFileUri(path: string): Uri | undefined {
		try {
			return Uri.file(path);
		} catch {
			return undefined;
		}
	}


	private isEqualOrParent(target: Uri, folder: Uri): boolean {
		const targetPath = normalizeUriPath(target).path;
		const folderPath = normalizeUriPath(folder).path;
		return targetPath === folderPath || targetPath.startsWith(folderPath.endsWith('/') ? folderPath : `${folderPath}/`);
	}

	private parseAnchor(anchor: string | undefined): { readonly range: Range; readonly startLine: string; readonly endLine: string | undefined } | undefined {
		if (!anchor) {
			return undefined;
		}
		const match = /^L?(\d+)(?:-L?(\d+))?$/.exec(anchor);
		if (!match) {
			return undefined;
		}

		const startLine = match[1];
		const endLineRaw = match[2];
		const normalizedEndLine = endLineRaw === startLine ? undefined : endLineRaw;
		const start = parseInt(startLine, 10) - 1;
		const end = parseInt(normalizedEndLine ?? startLine, 10) - 1;
		if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start) {
			return undefined;
		}

		return {
			range: new Range(new Position(start, 0), new Position(end, 0)),
			startLine,
			endLine: normalizedEndLine,
		};
	}

	private isAbsolutePath(path: string): boolean {
		return /^[a-z]:/i.test(path) || path.startsWith('/');
	}

	private async tryStat(uri: Uri, preserveDirectorySlash: boolean, token: CancellationToken): Promise<Uri | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}
		try {
			const stat = await this.statCache.stat(uri);
			if (!stat) {
				return undefined;
			}
			if (stat.type === FileType.Directory) {
				const isRoot = uri.path === '/';
				const hasTrailingSlash = uri.path.endsWith('/');
				const shouldHaveTrailingSlash = preserveDirectorySlash && !isRoot;

				if (shouldHaveTrailingSlash && !hasTrailingSlash) {
					return uri.with({ path: `${uri.path}/` });
				}
				if (!shouldHaveTrailingSlash && hasTrailingSlash) {
					return uri.with({ path: uri.path.slice(0, -1) });
				}
			}
			return uri;
		} catch {
			return undefined;
		}
	}
}
