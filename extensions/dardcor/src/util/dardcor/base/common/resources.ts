/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from './charCode';
import * as extpath from './extpath';
import { Schemas } from './network';
import * as paths from './path';
import { isLinux, isWindows } from './platform';
import { compare as strCompare, equalsIgnoreCase } from './strings';
import { URI, uriToFsPath } from './uri';

export function originalFSPath(uri: URI): string {
	return uriToFsPath(uri, true);
}


export interface IExtUri {


	compare(uri1: URI, uri2: URI, ignoreFragment?: boolean): number;

	isEqual(uri1: URI | undefined, uri2: URI | undefined, ignoreFragment?: boolean): boolean;

	isEqualOrParent(base: URI, parentCandidate: URI, ignoreFragment?: boolean): boolean;

	getComparisonKey(uri: URI, ignoreFragment?: boolean): string;

	ignorePathCasing(uri: URI): boolean;


	basenameOrAuthority(resource: URI): string;

	basename(resource: URI): string;

	extname(resource: URI): string;
	dirname(resource: URI): URI;
	joinPath(resource: URI, ...pathFragment: string[]): URI;
	normalizePath(resource: URI): URI;
	relativePath(from: URI, to: URI): string | undefined;
	resolvePath(base: URI, path: string): URI;


	isAbsolutePath(resource: URI): boolean;
	isEqualAuthority(a1: string, a2: string): boolean;
	hasTrailingPathSeparator(resource: URI, sep?: string): boolean;
	removeTrailingPathSeparator(resource: URI, sep?: string): URI;
	addTrailingPathSeparator(resource: URI, sep?: string): URI;
}

export class ExtUri implements IExtUri {

	constructor(private _ignorePathCasing: (uri: URI) => boolean) { }

	compare(uri1: URI, uri2: URI, ignoreFragment: boolean = false): number {
		if (uri1 === uri2) {
			return 0;
		}
		return strCompare(this.getComparisonKey(uri1, ignoreFragment), this.getComparisonKey(uri2, ignoreFragment));
	}

	isEqual(uri1: URI | undefined, uri2: URI | undefined, ignoreFragment: boolean = false): boolean {
		if (uri1 === uri2) {
			return true;
		}
		if (!uri1 || !uri2) {
			return false;
		}
		return this.getComparisonKey(uri1, ignoreFragment) === this.getComparisonKey(uri2, ignoreFragment);
	}

	getComparisonKey(uri: URI, ignoreFragment: boolean = false): string {
		return uri.with({
			path: this._ignorePathCasing(uri) ? uri.path.toLowerCase() : undefined,
			fragment: ignoreFragment ? null : undefined
		}).toString();
	}

	ignorePathCasing(uri: URI): boolean {
		return this._ignorePathCasing(uri);
	}

	isEqualOrParent(base: URI, parentCandidate: URI, ignoreFragment: boolean = false): boolean {
		if (base.scheme === parentCandidate.scheme) {
			if (base.scheme === Schemas.file) {
				return extpath.isEqualOrParent(originalFSPath(base), originalFSPath(parentCandidate), this._ignorePathCasing(base)) && base.query === parentCandidate.query && (ignoreFragment || base.fragment === parentCandidate.fragment);
			}
			if (isEqualAuthority(base.authority, parentCandidate.authority)) {
				return extpath.isEqualOrParent(base.path, parentCandidate.path, this._ignorePathCasing(base), true) && base.query === parentCandidate.query && (ignoreFragment || base.fragment === parentCandidate.fragment);
			}
		}
		return false;
	}


	joinPath(resource: URI, ...pathFragment: string[]): URI {
		return URI.joinPath(resource, ...pathFragment);
	}

	basenameOrAuthority(resource: URI): string {
		return basename(resource) || resource.authority;
	}

	basename(resource: URI, suffix?: string): string {
		return paths.posix.basename(resource.path, suffix);
	}

	extname(resource: URI): string {
		return paths.posix.extname(resource.path);
	}

	dirname(resource: URI): URI {
		if (resource.path.length === 0) {
			return resource;
		}
		let dirname;
		if (resource.scheme === Schemas.file) {
			dirname = URI.file(paths.dirname(originalFSPath(resource))).path;
		} else {
			dirname = paths.posix.dirname(resource.path);
			if (resource.authority && dirname.length && dirname.charCodeAt(0) !== CharCode.Slash) {
				console.error(`dirname("${resource.toString})) resulted in a relative path`);
				dirname = '/';
			}
		}
		return resource.with({
			path: dirname
		});
	}

	normalizePath(resource: URI): URI {
		if (!resource.path.length) {
			return resource;
		}
		let normalizedPath: string;
		if (resource.scheme === Schemas.file) {
			normalizedPath = URI.file(paths.normalize(originalFSPath(resource))).path;
		} else {
			normalizedPath = paths.posix.normalize(resource.path);
		}
		return resource.with({
			path: normalizedPath
		});
	}

	relativePath(from: URI, to: URI): string | undefined {
		if (from.scheme !== to.scheme || !isEqualAuthority(from.authority, to.authority)) {
			return undefined;
		}
		if (from.scheme === Schemas.file) {
			const relativePath = paths.relative(originalFSPath(from), originalFSPath(to));
			return isWindows ? extpath.toSlashes(relativePath) : relativePath;
		}
		let fromPath = from.path || '/';
		const toPath = to.path || '/';
		if (this._ignorePathCasing(from)) {
			let i = 0;
			for (const len = Math.min(fromPath.length, toPath.length); i < len; i++) {
				if (fromPath.charCodeAt(i) !== toPath.charCodeAt(i)) {
					if (fromPath.charAt(i).toLowerCase() !== toPath.charAt(i).toLowerCase()) {
						break;
					}
				}
			}
			fromPath = toPath.substr(0, i) + fromPath.substr(i);
		}
		return paths.posix.relative(fromPath, toPath);
	}

	resolvePath(base: URI, path: string): URI {
		if (base.scheme === Schemas.file) {
			const newURI = URI.file(paths.resolve(originalFSPath(base), path));
			return base.with({
				authority: newURI.authority,
				path: newURI.path
			});
		}
		path = extpath.toPosixPath(path);
		return base.with({
			path: paths.posix.resolve(base.path, path)
		});
	}


	isAbsolutePath(resource: URI): boolean {
		return !!resource.path && resource.path[0] === '/';
	}

	isEqualAuthority(a1: string | undefined, a2: string | undefined) {
		return a1 === a2 || (a1 !== undefined && a2 !== undefined && equalsIgnoreCase(a1, a2));
	}

	hasTrailingPathSeparator(resource: URI, sep: string = paths.sep): boolean {
		if (resource.scheme === Schemas.file) {
			const fsp = originalFSPath(resource);
			return fsp.length > extpath.getRoot(fsp).length && fsp[fsp.length - 1] === sep;
		} else {
			const p = resource.path;
			return (p.length > 1 && p.charCodeAt(p.length - 1) === CharCode.Slash) && !(/^[a-zA-Z]:(\/$|\\$)/.test(resource.fsPath));
		}
	}

	removeTrailingPathSeparator(resource: URI, sep: string = paths.sep): URI {
		if (hasTrailingPathSeparator(resource, sep)) {
			return resource.with({ path: resource.path.substr(0, resource.path.length - 1) });
		}
		return resource;
	}

	addTrailingPathSeparator(resource: URI, sep: string = paths.sep): URI {
		let isRootSep: boolean = false;
		if (resource.scheme === Schemas.file) {
			const fsp = originalFSPath(resource);
			isRootSep = ((fsp !== undefined) && (fsp.length === extpath.getRoot(fsp).length) && (fsp[fsp.length - 1] === sep));
		} else {
			sep = '/';
			const p = resource.path;
			isRootSep = p.length === 1 && p.charCodeAt(p.length - 1) === CharCode.Slash;
		}
		if (!isRootSep && !hasTrailingPathSeparator(resource, sep)) {
			return resource.with({ path: resource.path + '/' });
		}
		return resource;
	}
}


export const extUri = new ExtUri(() => false);

export const extUriBiasedIgnorePathCase = new ExtUri(uri => {
	return uri.scheme === Schemas.file ? !isLinux : true;
});


export const extUriIgnorePathCase = new ExtUri(_ => true);

export const isEqual = extUri.isEqual.bind(extUri);
export const isEqualOrParent = extUri.isEqualOrParent.bind(extUri);
export const getComparisonKey = extUri.getComparisonKey.bind(extUri);
export const basenameOrAuthority = extUri.basenameOrAuthority.bind(extUri);
export const basename = extUri.basename.bind(extUri);
export const extname = extUri.extname.bind(extUri);
export const dirname = extUri.dirname.bind(extUri);
export const joinPath = extUri.joinPath.bind(extUri);
export const normalizePath = extUri.normalizePath.bind(extUri);
export const relativePath = extUri.relativePath.bind(extUri);
export const resolvePath = extUri.resolvePath.bind(extUri);
export const isAbsolutePath = extUri.isAbsolutePath.bind(extUri);
export const isEqualAuthority = extUri.isEqualAuthority.bind(extUri);
export const hasTrailingPathSeparator = extUri.hasTrailingPathSeparator.bind(extUri);
export const removeTrailingPathSeparator = extUri.removeTrailingPathSeparator.bind(extUri);
export const addTrailingPathSeparator = extUri.addTrailingPathSeparator.bind(extUri);


export function distinctParents<T>(items: T[], resourceAccessor: (item: T) => URI): T[] {
	const distinctParents: T[] = [];
	for (let i = 0; i < items.length; i++) {
		const candidateResource = resourceAccessor(items[i]);
		if (items.some((otherItem, index) => {
			if (index === i) {
				return false;
			}

			return isEqualOrParent(candidateResource, resourceAccessor(otherItem));
		})) {
			continue;
		}

		distinctParents.push(items[i]);
	}

	return distinctParents;
}

export namespace DataUri {

	export const META_DATA_LABEL = 'label';
	export const META_DATA_DESCRIPTION = 'description';
	export const META_DATA_SIZE = 'size';
	export const META_DATA_MIME = 'mime';

	export function parseMetaData(dataUri: URI): Map<string, string> {
		const metadata = new Map<string, string>();

		const meta = dataUri.path.substring(dataUri.path.indexOf(';') + 1, dataUri.path.lastIndexOf(';'));
		meta.split(';').forEach(property => {
			const [key, value] = property.split(':');
			if (key && value) {
				metadata.set(key, value);
			}
		});

		const mime = dataUri.path.substring(0, dataUri.path.indexOf(';'));
		if (mime) {
			metadata.set(META_DATA_MIME, mime);
		}

		return metadata;
	}
}

export function toLocalResource(resource: URI, authority: string | undefined, localScheme: string): URI {
	if (authority) {
		let path = resource.path;
		if (path && path[0] !== paths.posix.sep) {
			path = paths.posix.sep + path;
		}

		return resource.with({ scheme: localScheme, authority, path });
	}

	return resource.with({ scheme: localScheme });
}
