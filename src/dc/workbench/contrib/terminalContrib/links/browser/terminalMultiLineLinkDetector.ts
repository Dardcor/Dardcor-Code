/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ITerminalLinkDetector, ITerminalLinkResolver, ITerminalSimpleLink } from './links.js';
import { convertLinkRangeToBuffer, getXtermLineContent } from './terminalLinkHelpers.js';
import { getTerminalLinkType } from './terminalLocalLinkDetector.js';
import type { IBufferLine, Terminal } from '@xterm/xterm';
import { ITerminalProcessManager } from '../../../terminal/common/terminal.js';
import { ITerminalBackend, ITerminalLogService } from '../../../../../platform/terminal/common/terminal.js';

const enum Constants {
	MaxLineLength = 2000,

	MaxResolvedLinkLength = 1024,
}

const lineNumberPrefixMatchers = [
	/^ *(?<link>(?<line>\d+):(?<col>\d+)?)/
];

const gitDiffMatchers = [
	/^(?<link>@@ .+ \+(?<toFileLine>\d+),(?<toFileCount>\d+) @@)/
];

export class TerminalMultiLineLinkDetector implements ITerminalLinkDetector {
	static id = 'multiline';

	readonly maxLinkLength = 500;

	constructor(
		readonly xterm: Terminal,
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

		this._logService.trace('terminalMultiLineLinkDetector#detect text', text);

		for (const matcher of lineNumberPrefixMatchers) {
			const match = text.match(matcher);
			const group = match?.groups;
			if (!group) {
				continue;
			}
			const link = group?.link;
			const line = group?.line;
			const col = group?.col;
			if (!link || line === undefined) {
				continue;
			}

			if (link.length > Constants.MaxResolvedLinkLength) {
				continue;
			}

			this._logService.trace('terminalMultiLineLinkDetector#detect candidate', link);

			let possiblePath: string | undefined;
			for (let index = startLine - 1; index >= 0; index--) {
				if (this.xterm.buffer.active.getLine(index)!.isWrapped) {
					continue;
				}
				const text = getXtermLineContent(this.xterm.buffer.active, index, index, this.xterm.cols);
				if (!text.match(/^\s*\d/)) {
					possiblePath = text;
					break;
				}
			}
			if (!possiblePath) {
				continue;
			}

			const linkStat = await this._linkResolver.resolveLink(this._processManager, possiblePath);
			if (linkStat) {
				const type = getTerminalLinkType(linkStat.uri, linkStat.isDirectory, this._uriIdentityService, this._workspaceContextService);

				const bufferRange = convertLinkRangeToBuffer(lines, this.xterm.cols, {
					startColumn: 1,
					startLineNumber: 1,
					endColumn: 1 + text.length,
					endLineNumber: 1
				}, startLine);

				const simpleLink: ITerminalSimpleLink = {
					text: link,
					uri: linkStat.uri,
					selection: {
						startLineNumber: parseInt(line),
						startColumn: col ? parseInt(col) : 1
					},
					disableTrimColon: true,
					bufferRange: bufferRange,
					type
				};
				this._logService.trace('terminalMultiLineLinkDetector#detect verified link', simpleLink);
				links.push(simpleLink);

				break;
			}
		}

		if (links.length === 0) {
			for (const matcher of gitDiffMatchers) {
				const match = text.match(matcher);
				const group = match?.groups;
				if (!group) {
					continue;
				}
				const link = group?.link;
				const toFileLine = group?.toFileLine;
				const toFileCount = group?.toFileCount;
				if (!link || toFileLine === undefined) {
					continue;
				}

				if (link.length > Constants.MaxResolvedLinkLength) {
					continue;
				}

				this._logService.trace('terminalMultiLineLinkDetector#detect candidate', link);


				let possiblePath: string | undefined;
				for (let index = startLine - 1; index >= 0; index--) {
					if (this.xterm.buffer.active.getLine(index)!.isWrapped) {
						continue;
					}
					const text = getXtermLineContent(this.xterm.buffer.active, index, index, this.xterm.cols);
					const match = text.match(/\+\+\+ b\/(?<path>.+)/);
					if (match) {
						possiblePath = match.groups?.path;
						break;
					}
				}
				if (!possiblePath) {
					continue;
				}

				const linkStat = await this._linkResolver.resolveLink(this._processManager, possiblePath);
				if (linkStat) {
					const type = getTerminalLinkType(linkStat.uri, linkStat.isDirectory, this._uriIdentityService, this._workspaceContextService);

					const bufferRange = convertLinkRangeToBuffer(lines, this.xterm.cols, {
						startColumn: 1,
						startLineNumber: 1,
						endColumn: 1 + link.length,
						endLineNumber: 1
					}, startLine);

					const simpleLink: ITerminalSimpleLink = {
						text: link,
						uri: linkStat.uri,
						selection: {
							startLineNumber: parseInt(toFileLine),
							startColumn: 1,
							endLineNumber: parseInt(toFileLine) + parseInt(toFileCount)
						},
						bufferRange: bufferRange,
						type
					};
					this._logService.trace('terminalMultiLineLinkDetector#detect verified link', simpleLink);
					links.push(simpleLink);

					break;
				}
			}
		}

		return links;
	}
}
