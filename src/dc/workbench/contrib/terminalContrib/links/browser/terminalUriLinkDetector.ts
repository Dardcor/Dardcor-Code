/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILinkComputerTarget, LinkComputer } from '../../../../../editor/common/languages/linkComputer.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ITerminalLinkDetector, ITerminalLinkResolver, ITerminalSimpleLink, TerminalBuiltinLinkType } from './links.js';
import { convertLinkRangeToBuffer, getXtermLineContent } from './terminalLinkHelpers.js';
import { getTerminalLinkType } from './terminalLocalLinkDetector.js';
import { ITerminalProcessManager } from '../../../terminal/common/terminal.js';
import type { IBufferLine, Terminal } from '@xterm/xterm';
import { ITerminalBackend, ITerminalLogService } from '../../../../../platform/terminal/common/terminal.js';
import { isString } from '../../../../../base/common/types.js';

const enum Constants {
	MaxResolvedLinksInLine = 10
}

export class TerminalUriLinkDetector implements ITerminalLinkDetector {
	static id = 'uri';

	readonly maxLinkLength = 2048;

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

		const linkComputerTarget = new TerminalLinkAdapter(this.xterm, startLine, endLine);
		const computedLinks = LinkComputer.computeLinks(linkComputerTarget);

		let resolvedLinkCount = 0;
		this._logService.trace('terminalUriLinkDetector#detect computedLinks', computedLinks);
		for (const computedLink of computedLinks) {
			const bufferRange = convertLinkRangeToBuffer(lines, this.xterm.cols, computedLink.range, startLine);

			const uri = computedLink.url
				? (isString(computedLink.url) ? URI.parse(this._excludeLineAndColSuffix(computedLink.url)) : computedLink.url)
				: undefined;

			if (!uri) {
				continue;
			}

			const text = computedLink.url?.toString() || '';

			if (text.length > this.maxLinkLength) {
				continue;
			}

			if (uri.scheme !== Schemas.file) {
				links.push({
					text,
					uri,
					bufferRange,
					type: TerminalBuiltinLinkType.Url
				});
				continue;
			}

			if (uri.authority.length !== 2 && uri.authority.endsWith(':')) {
				continue;
			}

			const uriCandidates: URI[] = [uri];
			if (uri.authority.length > 0) {
				uriCandidates.push(URI.from({ ...uri, authority: undefined }));
			}

			this._logService.trace('terminalUriLinkDetector#detect uriCandidates', uriCandidates);
			for (const uriCandidate of uriCandidates) {
				const linkStat = await this._linkResolver.resolveLink(this._processManager, text, uriCandidate);

				if (linkStat) {
					const type = getTerminalLinkType(uriCandidate, linkStat.isDirectory, this._uriIdentityService, this._workspaceContextService);
					const simpleLink: ITerminalSimpleLink = {
						text: isString(computedLink.url) ? computedLink.url : linkStat.link,
						uri: uriCandidate,
						bufferRange,
						type
					};
					this._logService.trace('terminalUriLinkDetector#detect verified link', simpleLink);
					links.push(simpleLink);
					resolvedLinkCount++;
					break;
				}
			}

			if (++resolvedLinkCount >= Constants.MaxResolvedLinksInLine) {
				break;
			}
		}

		return links;
	}

	private _excludeLineAndColSuffix(path: string): string {
		return path.replace(/:\d+(:\d+)?$/, '');
	}
}

class TerminalLinkAdapter implements ILinkComputerTarget {
	constructor(
		private _xterm: Terminal,
		private _lineStart: number,
		private _lineEnd: number
	) { }

	getLineCount(): number {
		return 1;
	}

	getLineContent(): string {
		return getXtermLineContent(this._xterm.buffer.active, this._lineStart, this._lineEnd, this._xterm.cols);
	}
}
