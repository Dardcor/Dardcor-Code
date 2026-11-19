/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OS } from '../../../../../base/common/platform.js';
import { URI } from '../../../../../base/common/uri.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ITerminalLinkDetector, ITerminalLinkResolver, ITerminalSimpleLink, ResolvedLink, TerminalBuiltinLinkType } from './links.js';
import { convertLinkRangeToBuffer, getXtermLineContent, getXtermRangesByAttr, osPathModule, updateLinkWithRelativeCwd } from './terminalLinkHelpers.js';
import { ITerminalCapabilityStore, TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import type { IBufferLine, IBufferRange, Terminal } from '@xterm/xterm';
import { ITerminalProcessManager } from '../../../terminal/common/terminal.js';
import { detectLinks } from './terminalLinkParsing.js';
import { ITerminalBackend, ITerminalLogService } from '../../../../../platform/terminal/common/terminal.js';

const enum Constants {
	MaxLineLength = 2000,

	MaxResolvedLinksInLine = 10,

	MaxResolvedLinkLength = 1024,
}

const fallbackMatchers: RegExp[] = [
	/^ *File (?<link>"(?<path>.+)"(, line (?<line>\d+))?)/,
	/^ +FILE +(?<link>(?<path>.+)(?::(?<line>\d+)(?::(?<col>\d+))?)?)/,
	/^(?<link>(?<path>.+)\((?<line>\d+)(?:, ?(?<col>\d+))?\)) ?:/,
	/^(?<link>(?<path>.+):(?<line>\d+)(?::(?<col>\d+))?) ?:/,
	/^(?:PS\s+)?(?<link>(?<path>[^>]+))>/,
	/^ *(?<link>(?<path>.+))/
];

export class TerminalLocalLinkDetector implements ITerminalLinkDetector {
	static id = 'local';

	readonly maxLinkLength = 500;

	constructor(
		readonly xterm: Terminal,
		private readonly _capabilities: ITerminalCapabilityStore,
		private readonly _processManager: Pick<ITerminalProcessManager, 'initialCwd' | 'os' | 'remoteAuthority' | 'userHome'> & { backend?: Pick<ITerminalBackend, 'getWslPath'> },
		private readonly _linkResolver: ITerminalLinkResolver,
		@ITerminalLogService private readonly _logService: ITerminalLogService,
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService
	) {
	}

	async detect(lines: IBufferLine[], startLine: number, endLine: number): Promise<ITerminalSimpleLink[]> {
		const links: ITerminalSimpleLink[] = [];

		const text = getXtermLineContent(this.xterm.buffer.active, startLine, endLine, this.xterm.cols);
		if (text === '' || text.length > Constants.MaxLineLength) {
			return [];
		}

		let stringIndex = -1;
		let resolvedLinkCount = 0;

		const os = this._processManager.os || OS;
		const parsedLinks = detectLinks(text, os);
		this._logService.trace('terminalLocalLinkDetector#detect text', text);
		this._logService.trace('terminalLocalLinkDetector#detect parsedLinks', parsedLinks);
		for (const parsedLink of parsedLinks) {

			if (parsedLink.path.text.length > Constants.MaxResolvedLinkLength) {
				continue;
			}

			const bufferRange = convertLinkRangeToBuffer(lines, this.xterm.cols, {
				startColumn: (parsedLink.prefix?.index ?? parsedLink.path.index) + 1,
				startLineNumber: 1,
				endColumn: parsedLink.path.index + parsedLink.path.text.length + (parsedLink.suffix?.suffix.text.length ?? 0) + 1,
				endLineNumber: 1
			}, startLine);

			const linkCandidates: string[] = [];
			const osPath = osPathModule(os);
			const isUri = parsedLink.path.text.startsWith('file://');
			if (osPath.isAbsolute(parsedLink.path.text) || parsedLink.path.text.startsWith('~') || isUri) {
				linkCandidates.push(parsedLink.path.text);
			} else {
				if (this._capabilities.has(TerminalCapability.CommandDetection)) {
					const absolutePath = updateLinkWithRelativeCwd(this._capabilities, bufferRange.start.y, parsedLink.path.text, osPath, this._logService);
					if (absolutePath) {
						linkCandidates.push(...absolutePath);
					}
				}
				if (linkCandidates.length === 0) {
					linkCandidates.push(parsedLink.path.text);
					if (parsedLink.path.text.match(/^(\.\.[\/\\])+/)) {
						linkCandidates.push(parsedLink.path.text.replace(/^(\.\.[\/\\])+/, ''));
					}
				}
			}

			const specialEndCharRegex = /[\[\]"'\.]$/;
			const trimRangeMap: Map<string, number> = new Map();
			const specialEndLinkCandidates: string[] = [];
			for (const candidate of linkCandidates) {
				let previous = candidate;
				let removed = previous.replace(specialEndCharRegex, '');
				let trimRange = 0;
				while (removed !== previous) {
					if (!parsedLink.suffix) {
						trimRange++;
					}
					specialEndLinkCandidates.push(removed);
					trimRangeMap.set(removed, trimRange);
					previous = removed;
					removed = removed.replace(specialEndCharRegex, '');
				}
			}
			linkCandidates.push(...specialEndLinkCandidates);
			this._logService.trace('terminalLocalLinkDetector#detect linkCandidates', linkCandidates);

			const simpleLink = await this._validateAndGetLink(undefined, bufferRange, linkCandidates, trimRangeMap);
			if (simpleLink) {
				simpleLink.parsedLink = parsedLink;
				simpleLink.text = text.substring(
					parsedLink.prefix?.index ?? parsedLink.path.index,
					parsedLink.suffix ? parsedLink.suffix.suffix.index + parsedLink.suffix.suffix.text.length : parsedLink.path.index + parsedLink.path.text.length
				);
				this._logService.trace('terminalLocalLinkDetector#detect verified link', simpleLink);
				links.push(simpleLink);
			}

			if (++resolvedLinkCount >= Constants.MaxResolvedLinksInLine) {
				break;
			}
		}

		if (links.length === 0) {
			for (const matcher of fallbackMatchers) {
				const match = text.match(matcher);
				const group = match?.groups;
				if (!group) {
					continue;
				}
				const link = group?.link;
				const path = group?.path;
				const line = group?.line;
				const col = group?.col;
				if (!link || !path) {
					continue;
				}

				if (link.length > Constants.MaxResolvedLinkLength) {
					continue;
				}

				stringIndex = text.indexOf(link);
				const bufferRange = convertLinkRangeToBuffer(lines, this.xterm.cols, {
					startColumn: stringIndex + 1,
					startLineNumber: 1,
					endColumn: stringIndex + link.length + 1,
					endLineNumber: 1
				}, startLine);

				const suffix = line ? `:${line}${col ? `:${col}` : ''}` : '';
				const simpleLink = await this._validateAndGetLink(`${path}${suffix}`, bufferRange, [path]);
				if (simpleLink) {
					links.push(simpleLink);
				}

			}
		}

		if (links.length === 0) {
			const rangeCandidates = getXtermRangesByAttr(this.xterm.buffer.active, startLine, endLine, this.xterm.cols);
			for (const rangeCandidate of rangeCandidates) {
				let text = '';
				for (let y = rangeCandidate.start.y; y <= rangeCandidate.end.y; y++) {
					const line = this.xterm.buffer.active.getLine(y);
					if (!line) {
						break;
					}
					const lineStartX = y === rangeCandidate.start.y ? rangeCandidate.start.x : 0;
					const lineEndX = y === rangeCandidate.end.y ? rangeCandidate.end.x : this.xterm.cols - 1;
					text += line.translateToString(false, lineStartX, lineEndX);
				}

				rangeCandidate.start.x++;
				rangeCandidate.start.y++;
				rangeCandidate.end.y++;

				const simpleLink = await this._validateAndGetLink(text, rangeCandidate, [text]);
				if (simpleLink) {
					links.push(simpleLink);
				}

				if (++resolvedLinkCount >= Constants.MaxResolvedLinksInLine) {
					break;
				}
			}
		}

		return links;
	}
	private async _validateLinkCandidates(linkCandidates: string[]): Promise<ResolvedLink | undefined> {
		for (const link of linkCandidates) {
			let uri: URI | undefined;
			if (link.startsWith('file://')) {
				uri = URI.parse(link);
			}
			const result = await this._linkResolver.resolveLink(this._processManager, link, uri);
			if (result) {
				return result;
			}
		}
		return undefined;
	}

	private async _validateAndGetLink(linkText: string | undefined, bufferRange: IBufferRange, linkCandidates: string[], trimRangeMap?: Map<string, number>): Promise<ITerminalSimpleLink | undefined> {
		const linkStat = await this._validateLinkCandidates(linkCandidates);
		if (linkStat) {
			const type = getTerminalLinkType(linkStat.uri, linkStat.isDirectory, this._uriIdentityService, this._workspaceContextService);

			const trimRange = trimRangeMap?.get(linkStat.link);
			if (trimRange) {
				bufferRange.end.x -= trimRange;
				if (bufferRange.end.x < 0) {
					bufferRange.end.y--;
					bufferRange.end.x += this.xterm.cols;
				}
			}

			return {
				text: linkText ?? linkStat.link,
				uri: linkStat.uri,
				bufferRange: bufferRange,
				type
			};
		}
		return undefined;
	}
}

export function getTerminalLinkType(
	uri: URI,
	isDirectory: boolean,
	uriIdentityService: IUriIdentityService,
	workspaceContextService: IWorkspaceContextService
): TerminalBuiltinLinkType {
	if (isDirectory) {
		const folders = workspaceContextService.getWorkspace().folders;
		for (let i = 0; i < folders.length; i++) {
			if (uriIdentityService.extUri.isEqualOrParent(uri, folders[i].uri)) {
				return TerminalBuiltinLinkType.LocalFolderInWorkspace;
			}
		}
		return TerminalBuiltinLinkType.LocalFolderOutsideWorkspace;
	} else {
		return TerminalBuiltinLinkType.LocalFile;
	}
}
