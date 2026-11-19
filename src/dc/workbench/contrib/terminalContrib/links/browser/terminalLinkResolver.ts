/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalLinkResolver, ResolvedLink } from './links.js';
import { removeLinkSuffix, removeLinkQueryString, winDrivePrefix } from './terminalLinkParsing.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITerminalProcessManager } from '../../../terminal/common/terminal.js';
import { Schemas } from '../../../../../base/common/network.js';
import { isWindows, OperatingSystem, OS } from '../../../../../base/common/platform.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IPath, posix, win32 } from '../../../../../base/common/path.js';
import { ITerminalBackend } from '../../../../../platform/terminal/common/terminal.js';
import { mainWindow } from '../../../../../base/browser/window.js';

export class TerminalLinkResolver implements ITerminalLinkResolver {
	private readonly _resolvedLinkCaches: Map<string, LinkCache> = new Map();

	constructor(
		@IFileService private readonly _fileService: IFileService,
	) {
	}

	async resolveLink(processManager: Pick<ITerminalProcessManager, 'initialCwd' | 'os' | 'remoteAuthority' | 'userHome'> & { backend?: Pick<ITerminalBackend, 'getWslPath'> }, link: string, uri?: URI): Promise<ResolvedLink> {
		if (uri && uri.scheme === Schemas.file && processManager.remoteAuthority) {
			uri = uri.with({
				scheme: Schemas.vscodeRemote,
				authority: processManager.remoteAuthority
			});
		}

		let cache = this._resolvedLinkCaches.get(processManager.remoteAuthority ?? '');
		if (!cache) {
			cache = new LinkCache();
			this._resolvedLinkCaches.set(processManager.remoteAuthority ?? '', cache);
		}

		const cached = cache.get(uri || link);
		if (cached !== undefined) {
			return cached;
		}

		if (uri) {
			try {
				const stat = await this._fileService.stat(uri);
				const result = { uri, link, isDirectory: stat.isDirectory };
				cache.set(uri, result);
				return result;
			}
			catch (e) {
				cache.set(uri, null);
				return null;
			}
		}

		let linkUrl = removeLinkSuffix(link);

		linkUrl = removeLinkQueryString(linkUrl);

		if (linkUrl.length === 0) {
			cache.set(link, null);
			return null;
		}

		if (isWindows && link.match(/^\/mnt\/[a-z]/i) && processManager.backend) {
			linkUrl = await processManager.backend.getWslPath(linkUrl, 'unix-to-win');
		}
		else if (isWindows && link.match(/^(?:\/\/|\\\\)wsl(?:\$|\.localhost)(\/|\\)/)) {
		}
		else {
			const preprocessedLink = this._preprocessPath(linkUrl, processManager.initialCwd, processManager.os, processManager.userHome);
			if (!preprocessedLink) {
				cache.set(link, null);
				return null;
			}
			linkUrl = preprocessedLink;
		}

		try {
			let uri: URI;
			if (processManager.remoteAuthority) {
				uri = URI.from({
					scheme: Schemas.vscodeRemote,
					authority: processManager.remoteAuthority,
					path: linkUrl
				});
			} else {
				uri = URI.file(linkUrl);
			}

			try {
				const stat = await this._fileService.stat(uri);
				const result = { uri, link, isDirectory: stat.isDirectory };
				cache.set(link, result);
				return result;
			}
			catch (e) {
				cache.set(link, null);
				return null;
			}
		} catch {
			cache.set(link, null);
			return null;
		}
	}

	protected _preprocessPath(link: string, initialCwd: string, os: OperatingSystem | undefined, userHome: string | undefined): string | null {
		const osPath = this._getOsPath(os);
		if (link.charAt(0) === '~') {
			if (!userHome) {
				return null;
			}
			link = osPath.join(userHome, link.substring(1));
		} else if (link.charAt(0) !== '/' && link.charAt(0) !== '~') {
			if (os === OperatingSystem.Windows) {
				if (!link.match('^' + winDrivePrefix) && !link.startsWith('\\\\?\\')) {
					if (!initialCwd) {
						return null;
					}
					link = osPath.join(initialCwd, link);
				} else {
					link = link.replace(/^\\\\\?\\/, '');
				}
			} else {
				if (!initialCwd) {
					return null;
				}
				link = osPath.join(initialCwd, link);
			}
		}
		link = osPath.normalize(link);

		return link;
	}

	private _getOsPath(os: OperatingSystem | undefined): IPath {
		return (os ?? OS) === OperatingSystem.Windows ? win32 : posix;
	}
}

const enum LinkCacheConstants {
	TTL = 10000
}

class LinkCache {
	private readonly _cache = new Map<string, ResolvedLink>();
	private _cacheTilTimeout = 0;

	set(link: string | URI, value: ResolvedLink) {
		if (this._cacheTilTimeout) {
			mainWindow.clearTimeout(this._cacheTilTimeout);
		}
		this._cacheTilTimeout = mainWindow.setTimeout(() => this._cache.clear(), LinkCacheConstants.TTL);
		this._cache.set(this._getKey(link), value);
	}

	get(link: string | URI): ResolvedLink | undefined {
		return this._cache.get(this._getKey(link));
	}

	private _getKey(link: string | URI): string {
		if (URI.isUri(link)) {
			return link.toString();
		}
		return link;
	}
}
