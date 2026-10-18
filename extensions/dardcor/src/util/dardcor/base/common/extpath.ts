
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from './charCode';
import { isAbsolute, join, normalize, posix, sep } from './path';
import { isWindows } from './platform';
import { equalsIgnoreCase, rtrim, startsWithIgnoreCase } from './strings';
import { isNumber } from './types';

export function isPathSeparator(code: number) {
	return code === CharCode.Slash || code === CharCode.Backslash;
}

export function toSlashes(osPath: string) {
	return osPath.replace(/[\\/]/g, posix.sep);
}

export function toPosixPath(osPath: string) {
	if (osPath.indexOf('/') === -1) {
		osPath = toSlashes(osPath);
	}
	if (/^[a-zA-Z]:(\/|$)/.test(osPath)) {
		osPath = '/' + osPath;
	}
	return osPath;
}

export function getRoot(path: string, sep: string = posix.sep): string {
	if (!path) {
		return '';
	}

	const len = path.length;
	const firstLetter = path.charCodeAt(0);
	if (isPathSeparator(firstLetter)) {
		if (isPathSeparator(path.charCodeAt(1))) {
			if (!isPathSeparator(path.charCodeAt(2))) {
				let pos = 3;
				const start = pos;
				for (; pos < len; pos++) {
					if (isPathSeparator(path.charCodeAt(pos))) {
						break;
					}
				}
				if (start !== pos && !isPathSeparator(path.charCodeAt(pos + 1))) {
					pos += 1;
					for (; pos < len; pos++) {
						if (isPathSeparator(path.charCodeAt(pos))) {
							return path.slice(0, pos + 1)
								.replace(/[\\/]/g, sep);
						}
					}
				}
			}
		}

		return sep;

	} else if (isWindowsDriveLetter(firstLetter)) {

		if (path.charCodeAt(1) === CharCode.Colon) {
			if (isPathSeparator(path.charCodeAt(2))) {
				return path.slice(0, 2) + sep;
			} else {
				return path.slice(0, 2);
			}
		}
	}

	let pos = path.indexOf('://');
	if (pos !== -1) {
		pos += 3;
		for (; pos < len; pos++) {
			if (isPathSeparator(path.charCodeAt(pos))) {
				return path.slice(0, pos + 1);
			}
		}
	}

	return '';
}

export function isUNC(path: string): boolean {
	if (!isWindows) {
		return false;
	}

	if (!path || path.length < 5) {
		return false;
	}

	let code = path.charCodeAt(0);
	if (code !== CharCode.Backslash) {
		return false;
	}

	code = path.charCodeAt(1);

	if (code !== CharCode.Backslash) {
		return false;
	}

	let pos = 2;
	const start = pos;
	for (; pos < path.length; pos++) {
		code = path.charCodeAt(pos);
		if (code === CharCode.Backslash) {
			break;
		}
	}

	if (start === pos) {
		return false;
	}

	code = path.charCodeAt(pos + 1);

	if (isNaN(code) || code === CharCode.Backslash) {
		return false;
	}

	return true;
}

const WINDOWS_INVALID_FILE_CHARS = /[\\/:\*\?"<>\|]/g;
const UNIX_INVALID_FILE_CHARS = /[/]/g;
const WINDOWS_FORBIDDEN_NAMES = /^(con|prn|aux|clock\$|nul|lpt[0-9]|com[0-9])(\.(.*?))?$/i;
export function isValidBasename(name: string | null | undefined, isWindowsOS: boolean = isWindows): boolean {
	const invalidFileChars = isWindowsOS ? WINDOWS_INVALID_FILE_CHARS : UNIX_INVALID_FILE_CHARS;

	if (!name || name.length === 0 || /^\s+$/.test(name)) {
		return false;
	}

	invalidFileChars.lastIndex = 0;
	if (invalidFileChars.test(name)) {
		return false;
	}

	if (isWindowsOS && WINDOWS_FORBIDDEN_NAMES.test(name)) {
		return false;
	}

	if (name === '.' || name === '..') {
		return false;
	}

	if (isWindowsOS && name[name.length - 1] === '.') {
		return false;
	}

	if (isWindowsOS && name.length !== name.trim().length) {
		return false;
	}

	if (name.length > 255) {
		return false;
	}

	return true;
}

export function isEqual(pathA: string, pathB: string, ignoreCase?: boolean): boolean {
	const identityEquals = (pathA === pathB);
	if (!ignoreCase || identityEquals) {
		return identityEquals;
	}

	if (!pathA || !pathB) {
		return false;
	}

	return equalsIgnoreCase(pathA, pathB);
}

export function isEqualOrParent(base: string, parentCandidate: string, ignoreCase?: boolean, forcePosixSemantics = false): boolean {
	const separator = forcePosixSemantics ? posix.sep : sep;

	if (base === parentCandidate) {
		return true;
	}

	if (!base || !parentCandidate) {
		return false;
	}

	if (
		base.indexOf('..') >= 0 ||
		parentCandidate.indexOf('..') >= 0
	) {
		base = forcePosixSemantics ? posix.normalize(base) : normalize(base);
		parentCandidate = forcePosixSemantics ? posix.normalize(parentCandidate) : normalize(parentCandidate);
	}

	if (parentCandidate.length > base.length) {
		return false;
	}

	if (ignoreCase) {
		const beginsWith = startsWithIgnoreCase(base, parentCandidate);
		if (!beginsWith) {
			return false;
		}

		if (parentCandidate.length === base.length) {
			return true;
		}

		let sepOffset = parentCandidate.length;
		if (parentCandidate.charAt(parentCandidate.length - 1) === separator) {
			sepOffset--;
		}

		return base.charAt(sepOffset) === separator;
	}

	if (parentCandidate.charAt(parentCandidate.length - 1) !== separator) {
		parentCandidate += separator;
	}

	return base.indexOf(parentCandidate) === 0;
}

export function isWindowsDriveLetter(char0: number): boolean {
	return char0 >= CharCode.A && char0 <= CharCode.Z || char0 >= CharCode.a && char0 <= CharCode.z;
}

export function sanitizeFilePath(candidate: string, cwd: string): string {

	if (isWindows && candidate.endsWith(':')) {
		candidate += sep;
	}

	if (!isAbsolute(candidate)) {
		candidate = join(cwd, candidate);
	}

	candidate = normalize(candidate);

	return removeTrailingPathSeparator(candidate);
}

export function removeTrailingPathSeparator(candidate: string): string {
	if (isWindows) {
		candidate = rtrim(candidate, sep);

		if (candidate.endsWith(':')) {
			candidate += sep;
		}

	} else {
		candidate = rtrim(candidate, sep);

		if (!candidate) {
			candidate = sep;
		}
	}

	return candidate;
}

export function isRootOrDriveLetter(path: string): boolean {
	const pathNormalized = normalize(path);

	if (isWindows) {
		if (path.length > 3) {
			return false;
		}

		return hasDriveLetter(pathNormalized) &&
			(path.length === 2 || pathNormalized.charCodeAt(2) === CharCode.Backslash);
	}

	return pathNormalized === posix.sep;
}

export function hasDriveLetter(path: string, isWindowsOS: boolean = isWindows): boolean {
	if (isWindowsOS) {
		return isWindowsDriveLetter(path.charCodeAt(0)) && path.charCodeAt(1) === CharCode.Colon;
	}

	return false;
}

export function getDriveLetter(path: string, isWindowsOS: boolean = isWindows): string | undefined {
	return hasDriveLetter(path, isWindowsOS) ? path[0] : undefined;
}

export function indexOfPath(path: string, candidate: string, ignoreCase?: boolean): number {
	if (candidate.length > path.length) {
		return -1;
	}

	if (path === candidate) {
		return 0;
	}

	if (ignoreCase) {
		path = path.toLowerCase();
		candidate = candidate.toLowerCase();
	}

	return path.indexOf(candidate);
}

export interface IPathWithLineAndColumn {
	path: string;
	line?: number;
	column?: number;
}

export function parseLineAndColumnAware(rawPath: string): IPathWithLineAndColumn {
	const segments = rawPath.split(':');

	let path: string | undefined;
	let line: number | undefined;
	let column: number | undefined;

	for (const segment of segments) {
		const segmentAsNumber = Number(segment);
		if (!isNumber(segmentAsNumber)) {
			path = path ? [path, segment].join(':') : segment;
		} else if (line === undefined) {
			line = segmentAsNumber;
		} else if (column === undefined) {
			column = segmentAsNumber;
		}
	}

	if (!path) {
		throw new Error('Format for `--goto` should be: `FILE:LINE(:COLUMN)`');
	}

	return {
		path,
		line: line !== undefined ? line : undefined,
		column: column !== undefined ? column : line !== undefined ? 1 : undefined
	};
}

const pathChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const windowsSafePathFirstChars = 'BDEFGHIJKMOQRSTUVWXYZbdefghijkmoqrstuvwxyz0123456789';

export function randomPath(parent?: string, prefix?: string, randomLength = 8): string {
	let suffix = '';
	for (let i = 0; i < randomLength; i++) {
		let pathCharsTouse: string;
		if (i === 0 && isWindows && !prefix && (randomLength === 3 || randomLength === 4)) {


			pathCharsTouse = windowsSafePathFirstChars;
		} else {
			pathCharsTouse = pathChars;
		}

		suffix += pathCharsTouse.charAt(Math.floor(Math.random() * pathCharsTouse.length));
	}

	let randomFileName: string;
	if (prefix) {
		randomFileName = `${prefix}-${suffix}`;
	} else {
		randomFileName = suffix;
	}

	if (parent) {
		return join(parent, randomFileName);
	}

	return randomFileName;
}
