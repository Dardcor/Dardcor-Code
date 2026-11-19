/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStrictMarketplaceSource } from '../../../../../base/common/managedSettings.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IMarketplaceReference, MarketplaceReferenceKind, parseMarketplaceReference } from './marketplaceReference.js';

export type { IStrictMarketplaceSource };

export type StrictKnownMarketplaces = readonly IStrictMarketplaceSource[];

export function getStrictKnownMarketplaces(value: unknown): StrictKnownMarketplaces | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value.filter((entry): entry is IStrictMarketplaceSource =>
		typeof entry === 'object' && entry !== null && typeof entry.source === 'string');
}

export function isMarketplaceReferenceAllowed(allowlist: StrictKnownMarketplaces | undefined, ref: IMarketplaceReference): boolean {
	if (allowlist === undefined) {
		return true;
	}
	if (allowlist.length === 0) {
		return false;
	}
	return allowlist.some(entry => matchesAllowlistEntry(entry, ref));
}

function matchesAllowlistEntry(entry: IStrictMarketplaceSource, ref: IMarketplaceReference): boolean {
	switch (entry.source) {
		case 'github': {
			if (typeof entry.repo !== 'string' || entry.path !== undefined) {
				return false;
			}
			const candidate = parseMarketplaceReference(appendRef(entry.repo, entry.ref));
			return !!candidate && candidate.canonicalId === ref.canonicalId;
		}
		case 'git': {
			if (typeof entry.url !== 'string' || entry.path !== undefined) {
				return false;
			}
			const candidate = parseMarketplaceReference(appendRef(entry.url, entry.ref));
			return !!candidate && candidate.canonicalId === ref.canonicalId;
		}
		case 'url': {
			if (typeof entry.url !== 'string') {
				return false;
			}
			const candidate = parseMarketplaceReference(appendRef(entry.url, entry.ref));
			return !!candidate && candidate.canonicalId === ref.canonicalId;
		}
		case 'npm': {
			return false;
		}
		case 'file':
		case 'directory': {
			if (ref.kind !== MarketplaceReferenceKind.LocalFileUri || !ref.localRepositoryUri || typeof entry.path !== 'string') {
				return false;
			}
			return isEqual(ref.localRepositoryUri, URI.file(entry.path));
		}
		case 'hostPattern': {
			if (typeof entry.hostPattern !== 'string') {
				return false;
			}
			const host = extractHost(ref);
			return !!host && testPattern(entry.hostPattern, host);
		}
		case 'pathPattern': {
			if (typeof entry.pathPattern !== 'string' || ref.kind !== MarketplaceReferenceKind.LocalFileUri || !ref.localRepositoryUri) {
				return false;
			}
			return testPattern(entry.pathPattern, ref.localRepositoryUri.fsPath);
		}
		default:
			return false;
	}
}

function appendRef(value: string, ref: string | undefined): string {
	if (!ref) {
		return value;
	}
	const fragmentIndex = value.indexOf('#');
	const base = fragmentIndex === -1 ? value : value.slice(0, fragmentIndex);
	return `${base}#${ref}`;
}

function extractHost(ref: IMarketplaceReference): string | undefined {
	if (ref.kind === MarketplaceReferenceKind.GitHubShorthand) {
		return 'github.com';
	}
	if (ref.kind !== MarketplaceReferenceKind.GitUri) {
		return undefined;
	}
	const scpMatch = /^[\w._-]+@([\w.-]+):/.exec(ref.cloneUrl);
	if (scpMatch) {
		return scpMatch[1].toLowerCase();
	}
	try {
		let authority = URI.parse(ref.cloneUrl).authority.toLowerCase();
		const at = authority.lastIndexOf('@');
		if (at !== -1) {
			authority = authority.slice(at + 1);
		}
		const colon = authority.indexOf(':');
		if (colon !== -1) {
			authority = authority.slice(0, colon);
		}
		return authority || undefined;
	} catch {
		return undefined;
	}
}

function testPattern(pattern: string, value: string): boolean {
	try {
		return new RegExp(pattern).test(value);
	} catch {
		return false;
	}
}
