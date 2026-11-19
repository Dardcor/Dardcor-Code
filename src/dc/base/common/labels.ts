/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hasDriveLetter, toSlashes } from './extpath.js';
import { posix, sep, win32 } from './path.js';
import { isMacintosh, isWindows, OperatingSystem, OS } from './platform.js';
import { extUri, extUriIgnorePathCase } from './resources.js';
import { rtrim, startsWithIgnoreCase } from './strings.js';
import { URI } from './uri.js';

export interface IPathLabelFormatting {

	readonly os: OperatingSystem;

	readonly tildify?: IUserHomeProvider;

	readonly relative?: IRelativePathProvider;
}

export interface IRelativePathProvider {

	readonly noPrefix?: boolean;

	getWorkspace(): { folders: { uri: URI; name?: string }[] };
	getWorkspaceFolder(resource: URI): { uri: URI; name?: string } | null;
}

export interface IUserHomeProvider {
	userHome: URI;
}

export function getPathLabel(resource: URI, formatting: IPathLabelFormatting): string {
	const { os, tildify: tildifier, relative: relatifier } = formatting;

	if (relatifier) {
		const relativePath = getRelativePathLabel(resource, relatifier, os);
		if (typeof relativePath === 'string') {
			return relativePath;
		}
	}

	let absolutePath = resource.fsPath;
	if (os === OperatingSystem.Windows && !isWindows) {
		absolutePath = absolutePath.replace(/\//g, '\\');
	} else if (os !== OperatingSystem.Windows && isWindows) {
		absolutePath = absolutePath.replace(/\\/g, '/');
	}

	if (os !== OperatingSystem.Windows && tildifier?.userHome) {
		const userHome = tildifier.userHome.fsPath;

		let userHomeCandidate: string;
		if (resource.scheme !== tildifier.userHome.scheme && resource.path[0] === posix.sep && resource.path[1] !== posix.sep) {
			userHomeCandidate = tildifier.userHome.with({ path: resource.path }).fsPath;
		} else {
			userHomeCandidate = absolutePath;
		}

		absolutePath = tildify(userHomeCandidate, userHome, os);
	}

	const pathLib = os === OperatingSystem.Windows ? win32 : posix;
	return pathLib.normalize(normalizeDriveLetter(absolutePath, os === OperatingSystem.Windows));
}

function getRelativePathLabel(resource: URI, relativePathProvider: IRelativePathProvider, os: OperatingSystem): string | undefined {
	const pathLib = os === OperatingSystem.Windows ? win32 : posix;
	const extUriLib = os === OperatingSystem.Linux ? extUri : extUriIgnorePathCase;

	const workspace = relativePathProvider.getWorkspace();
	const firstFolder = workspace.folders.at(0);
	if (!firstFolder) {
		return undefined;
	}

	if (resource.scheme !== firstFolder.uri.scheme && resource.path[0] === posix.sep && resource.path[1] !== posix.sep) {
		resource = firstFolder.uri.with({ path: resource.path });
	}

	const folder = relativePathProvider.getWorkspaceFolder(resource);
	if (!folder) {
		return undefined;
	}

	let relativePathLabel: string | undefined = undefined;
	if (extUriLib.isEqual(folder.uri, resource)) {
		relativePathLabel = '';
	} else {
		relativePathLabel = extUriLib.relativePath(folder.uri, resource) ?? '';
	}

	if (relativePathLabel) {
		relativePathLabel = pathLib.normalize(relativePathLabel);
	}

	if (workspace.folders.length > 1 && !relativePathProvider.noPrefix) {
		const rootName = folder.name ? folder.name : extUriLib.basenameOrAuthority(folder.uri);
		relativePathLabel = relativePathLabel ? `${rootName} • ${relativePathLabel}` : rootName;
	}

	return relativePathLabel;
}

export function normalizeDriveLetter(path: string, isWindowsOS: boolean = isWindows): string {
	if (hasDriveLetter(path, isWindowsOS)) {
		return path.charAt(0).toUpperCase() + path.slice(1);
	}

	return path;
}

let normalizedUserHomeCached: { original: string; normalized: string } = Object.create(null);
export function tildify(path: string, userHome: string, os = OS): string {
	if (os === OperatingSystem.Windows || !path || !userHome) {
		return path;
	}

	let normalizedUserHome = normalizedUserHomeCached.original === userHome ? normalizedUserHomeCached.normalized : undefined;
	if (!normalizedUserHome) {
		normalizedUserHome = userHome;
		if (isWindows) {
			normalizedUserHome = toSlashes(normalizedUserHome);
		}
		normalizedUserHome = `${rtrim(normalizedUserHome, posix.sep)}${posix.sep}`;
		normalizedUserHomeCached = { original: userHome, normalized: normalizedUserHome };
	}

	let normalizedPath = path;
	if (isWindows) {
		normalizedPath = toSlashes(normalizedPath);
	}

	if (os === OperatingSystem.Linux ? normalizedPath.startsWith(normalizedUserHome) : startsWithIgnoreCase(normalizedPath, normalizedUserHome)) {
		return `~/${normalizedPath.substr(normalizedUserHome.length)}`;
	}

	return path;
}

export function untildify(path: string, userHome: string): string {
	return path.replace(/^~($|\/|\\)/, `${userHome}$1`);
}

const ellipsis = '\u2026';
const unc = '\\\\';
const urlSchemaRegexp = /^[^:/\\?#]+?:\/\//;
const home = '~';
export function shorten(paths: string[], defaultPathSeparator: string = sep): string[] {
	const shortenedPaths: string[] = new Array(paths.length);

	let match = false;
	for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
		let pathSeparator = defaultPathSeparator;
		const originalPath = paths[pathIndex];

		if (originalPath === '') {
			shortenedPaths[pathIndex] = `.${pathSeparator}`;
			continue;
		}

		if (!originalPath) {
			shortenedPaths[pathIndex] = originalPath;
			continue;
		}

		match = true;

		let prefix = '';
		let trimmedPath = originalPath;
		if (urlSchemaRegexp.test(trimmedPath)) {
			prefix = trimmedPath.substr(0, trimmedPath.indexOf('//') + 2);
			trimmedPath = trimmedPath.substr(trimmedPath.indexOf('//') + 2);
			pathSeparator = '/';
		} else if (trimmedPath.indexOf(unc) === 0) {
			prefix = trimmedPath.substr(0, trimmedPath.indexOf(unc) + unc.length);
			trimmedPath = trimmedPath.substr(trimmedPath.indexOf(unc) + unc.length);
		} else if (trimmedPath.indexOf(pathSeparator) === 0) {
			prefix = trimmedPath.substr(0, trimmedPath.indexOf(pathSeparator) + pathSeparator.length);
			trimmedPath = trimmedPath.substr(trimmedPath.indexOf(pathSeparator) + pathSeparator.length);
		} else if (trimmedPath.indexOf(home) === 0) {
			prefix = trimmedPath.substr(0, trimmedPath.indexOf(home) + home.length);
			trimmedPath = trimmedPath.substr(trimmedPath.indexOf(home) + home.length);
		}

		const segments: string[] = trimmedPath.split(pathSeparator);
		for (let subpathLength = 1; match && subpathLength <= segments.length; subpathLength++) {
			for (let start = segments.length - subpathLength; match && start >= 0; start--) {
				match = false;
				let subpath = segments.slice(start, start + subpathLength).join(pathSeparator);

				for (let otherPathIndex = 0; !match && otherPathIndex < paths.length; otherPathIndex++) {

					if (otherPathIndex !== pathIndex && paths[otherPathIndex] && paths[otherPathIndex].indexOf(subpath) > -1) {
						const isSubpathEnding: boolean = (start + subpathLength === segments.length);

						const subpathWithSep: string = (start > 0 && paths[otherPathIndex].indexOf(pathSeparator) > -1) ? pathSeparator + subpath : subpath;
						const isOtherPathEnding: boolean = paths[otherPathIndex].endsWith(subpathWithSep);

						match = !isSubpathEnding || isOtherPathEnding;
					}
				}

				if (!match) {
					let result = '';

					if (segments[0].endsWith(':') || prefix !== '') {
						if (start === 1) {
							start = 0;
							subpathLength++;
							subpath = segments[0] + pathSeparator + subpath;
						}

						if (start > 0) {
							result = segments[0] + pathSeparator;
						}

						result = prefix + result;
					}

					if (start > 0) {
						result = result + ellipsis + pathSeparator;
					}

					result = result + subpath;

					if (start + subpathLength < segments.length) {
						if (start + subpathLength === segments.length - 1 && segments[segments.length - 1] === '') {
							result = result + pathSeparator;
						} else {
							result = result + pathSeparator + ellipsis;
						}
					}

					shortenedPaths[pathIndex] = result;
				}
			}
		}

		if (match) {
			shortenedPaths[pathIndex] = originalPath;
		}
	}

	return shortenedPaths;
}

export interface ISeparator {
	label: string;
}

enum Type {
	TEXT,
	VARIABLE,
	SEPARATOR
}

interface ISegment {
	value: string;
	type: Type;
}

export function template(template: string, values: { [key: string]: string | ISeparator | undefined | null } = Object.create(null)): string {
	const segments: ISegment[] = [];

	let inVariable = false;
	let curVal = '';
	for (const char of template) {
		if (char === '$' || (inVariable && char === '{')) {
			if (curVal) {
				segments.push({ value: curVal, type: Type.TEXT });
			}

			curVal = '';
			inVariable = true;
		}

		else if (char === '}' && inVariable) {
			const resolved = values[curVal];

			if (typeof resolved === 'string') {
				if (resolved.length) {
					segments.push({ value: resolved, type: Type.VARIABLE });
				}
			}

			else if (resolved) {
				const prevSegment = segments[segments.length - 1];
				if (!prevSegment || prevSegment.type !== Type.SEPARATOR) {
					segments.push({ value: resolved.label, type: Type.SEPARATOR });
				}
			}

			curVal = '';
			inVariable = false;
		}

		else {
			curVal += char;
		}
	}

	if (curVal && !inVariable) {
		segments.push({ value: curVal, type: Type.TEXT });
	}

	return segments.filter((segment, index) => {

		if (segment.type === Type.SEPARATOR) {
			const left = segments[index - 1];
			const right = segments[index + 1];

			return [left, right].every(segment => segment && (segment.type === Type.VARIABLE || segment.type === Type.TEXT) && segment.value.length > 0);
		}

		return true;
	}).map(segment => segment.value).join('');
}

export function mnemonicMenuLabel(label: string, forceDisableMnemonics?: boolean): string {
	if (isMacintosh || forceDisableMnemonics) {
		return label.replace(/\(&&\w\)|&&/g, '').replace(/&/g, isMacintosh ? '&' : '&&');
	}

	return label.replace(/&&|&/g, m => m === '&' ? '&&' : '&');
}

export function mnemonicButtonLabel(label: string, forceDisableMnemonics: true): string;
export function mnemonicButtonLabel(label: string, forceDisableMnemonics?: false): { readonly withMnemonic: string; readonly withoutMnemonic: string };
export function mnemonicButtonLabel(label: string, forceDisableMnemonics?: boolean): { readonly withMnemonic: string; readonly withoutMnemonic: string } | string {
	const withoutMnemonic = label.replace(/\(&&\w\)|&&/g, '');

	if (forceDisableMnemonics) {
		return withoutMnemonic;
	}
	if (isMacintosh) {
		return { withMnemonic: withoutMnemonic, withoutMnemonic };
	}

	let withMnemonic: string;
	if (isWindows) {
		withMnemonic = label.replace(/&&|&/g, m => m === '&' ? '&&' : '&');
	} else {
		withMnemonic = label.replace(/&&/g, '_');
	}
	return { withMnemonic, withoutMnemonic };
}

export function unmnemonicLabel(label: string): string {
	return label.replace(/&/g, '&&');
}

export function splitRecentLabel(recentLabel: string): { name: string; parentPath: string } {
	if (recentLabel.endsWith(']')) {
		const lastIndexOfSquareBracket = recentLabel.lastIndexOf(' [', recentLabel.length - 2);
		if (lastIndexOfSquareBracket !== -1) {
			const split = splitName(recentLabel.substring(0, lastIndexOfSquareBracket));
			const remoteNameWithSpace = recentLabel.substring(lastIndexOfSquareBracket);
			return { name: split.name + remoteNameWithSpace, parentPath: split.parentPath };
		}
	}
	return splitName(recentLabel);
}

function splitName(fullPath: string): { name: string; parentPath: string } {
	const p = fullPath.indexOf('/') !== -1 ? posix : win32;
	const name = p.basename(fullPath);
	const parentPath = p.dirname(fullPath);
	if (name.length) {
		return { name, parentPath };
	}
	return { name: parentPath, parentPath: '' };
}
