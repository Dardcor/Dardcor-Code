/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { ExtraKnownMarketplacesConfigDict, IExtraKnownMarketplaceConfigValue } from '../../../../../base/common/managedSettings.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ChatConfiguration } from '../constants.js';

export { extraKnownMarketplacesToConfigDict } from '../../../../../base/common/managedSettings.js';

export const enum MarketplaceReferenceKind {
	GitHubShorthand = 'githubShorthand',
	GitUri = 'gitUri',
	LocalFileUri = 'localFileUri',
}

export interface IMarketplaceReference {
	readonly rawValue: string;
	readonly displayLabel: string;
	readonly cloneUrl: string;
	readonly canonicalId: string;
	readonly cacheSegments: readonly string[];
	readonly kind: MarketplaceReferenceKind;
	readonly ref?: string;
	readonly githubRepo?: string;
	readonly localRepositoryUri?: URI;
	readonly autoUpdate?: boolean;
}

export interface IConfiguredMarketplaces {
	readonly userValues: readonly unknown[];
	readonly extraValues: readonly unknown[];
	readonly effectiveValues: readonly unknown[];
}

const _githubShorthandRe = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#.+)?$/;

export function readConfiguredMarketplaces(configurationService: IConfigurationService): IConfiguredMarketplaces {
	const userValues = configurationService.getValue<(string | object)[]>(ChatConfiguration.PluginMarketplaces) ?? [];

	const extraObj = configurationService.getValue<ExtraKnownMarketplacesConfigDict>(ChatConfiguration.ExtraMarketplaces) ?? {};
	const extraValues: IExtraMarketplaceObjectEntry[] = Object.entries(extraObj).flatMap(([name, value]) => {
		if (typeof value !== 'string') {
			return [];
		}
		const encoded = parseExtraMarketplaceConfigValue(value);
		const src = encoded?.source ?? value;
		const autoUpdate = encoded?.autoUpdate;
		const isGithubShorthand = _githubShorthandRe.test(src);
		return [isGithubShorthand
			? { name, autoUpdate, source: { source: 'github' as const, repo: src } }
			: { name, autoUpdate, source: { source: 'git' as const, url: src } }];
	});

	return {
		userValues,
		extraValues,
		effectiveValues: [...userValues, ...extraValues],
	};
}

function parseExtraMarketplaceConfigValue(value: string): IExtraKnownMarketplaceConfigValue | undefined {
	try {
		const parsed = JSON.parse(value);
		return parsed
			&& typeof parsed === 'object'
			&& typeof parsed.source === 'string'
			&& typeof parsed.autoUpdate === 'boolean'
			? parsed
			: undefined;
	} catch {
		return undefined;
	}
}

export function parseMarketplaceReferences(values: readonly unknown[]): IMarketplaceReference[] {
	const byCanonicalId = new Map<string, IMarketplaceReference>();

	for (const value of values) {
		let parsed: IMarketplaceReference | undefined;
		if (typeof value === 'string') {
			parsed = parseMarketplaceReference(value);
		} else if (value && typeof value === 'object') {
			parsed = parseMarketplaceObjectEntry(value as IExtraMarketplaceObjectEntry);
		}
		if (parsed) {
			const existing = byCanonicalId.get(parsed.canonicalId);
			if (!existing) {
				byCanonicalId.set(parsed.canonicalId, parsed);
			} else if (parsed.autoUpdate !== undefined) {
				byCanonicalId.set(parsed.canonicalId, { ...existing, autoUpdate: parsed.autoUpdate });
			}
		}
	}

	return [...byCanonicalId.values()];
}

export interface IExtraMarketplaceObjectEntry {
	readonly name?: string;
	readonly source?: string | { readonly source?: string; readonly repo?: string; readonly url?: string; readonly ref?: string };
	readonly repo?: string;
	readonly url?: string;
	readonly ref?: string;
	readonly autoUpdate?: boolean;
}

export function parseMarketplaceObjectEntry(entry: IExtraMarketplaceObjectEntry): IMarketplaceReference | undefined {
	let sourceType: string | undefined;
	let repo: string | undefined;
	let url: string | undefined;
	let ref: string | undefined;

	if (entry.source && typeof entry.source === 'object') {
		const nested = entry.source;
		sourceType = nested.source;
		repo = nested.repo;
		url = nested.url;
		ref = nested.ref;
	} else {
		sourceType = entry.source;
		repo = entry.repo;
		url = entry.url;
		ref = entry.ref;
	}

	let parsed: IMarketplaceReference | undefined;
	if (sourceType === 'github' && typeof repo === 'string') {
		parsed = parseMarketplaceReference(appendMarketplaceRef(repo, ref));
	} else if (sourceType === 'git' && typeof url === 'string') {
		parsed = parseMarketplaceReference(appendMarketplaceRef(url, ref));
	}

	if (parsed && typeof entry.name === 'string' && entry.name.length > 0) {
		parsed = { ...parsed, displayLabel: entry.name };
	}
	if (parsed && typeof entry.autoUpdate === 'boolean') {
		parsed = { ...parsed, autoUpdate: entry.autoUpdate };
	}
	return parsed;
}

function appendMarketplaceRef(value: string, ref: string | undefined): string {
	if (!ref) {
		return value;
	}
	const fragmentIndex = value.indexOf('#');
	const base = fragmentIndex === -1 ? value : value.slice(0, fragmentIndex);
	return `${base}#${ref}`;
}

export function deduplicateMarketplaceReferences(primary: readonly IMarketplaceReference[], secondary: readonly IMarketplaceReference[]): IMarketplaceReference[] {
	const byCanonicalId = new Map<string, IMarketplaceReference>();
	for (const ref of primary) {
		byCanonicalId.set(ref.canonicalId, ref);
	}
	for (const ref of secondary) {
		if (!byCanonicalId.has(ref.canonicalId)) {
			byCanonicalId.set(ref.canonicalId, ref);
		}
	}
	return [...byCanonicalId.values()];
}

export function parseMarketplaceReference(value: string): IMarketplaceReference | undefined {
	const rawValue = value.trim();
	if (!rawValue) {
		return undefined;
	}

	const uriReference = parseUriMarketplaceReference(rawValue);
	if (uriReference) {
		return uriReference;
	}

	const scpReference = parseScpMarketplaceReference(rawValue);
	if (scpReference) {
		return scpReference;
	}

	const shorthandMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:#(.+))?$/.exec(rawValue);
	if (shorthandMatch) {
		const owner = shorthandMatch[1];
		const repo = shorthandMatch[2];
		const ref = shorthandMatch[3];
		return {
			rawValue,
			displayLabel: rawValue,
			cloneUrl: `https://github.com/${owner}/${repo}.git`,
			canonicalId: getGitHubCanonicalId(owner, repo, ref),
			cacheSegments: ['github.com', owner, repo, ...getRefCacheSegments(ref)],
			kind: MarketplaceReferenceKind.GitHubShorthand,
			ref,
			githubRepo: `${owner}/${repo}`,
		};
	}

	return undefined;
}

function parseUriMarketplaceReference(rawValue: string): IMarketplaceReference | undefined {
	let uri: URI;
	try {
		uri = URI.parse(rawValue);
	} catch {
		return undefined;
	}

	const scheme = uri.scheme.toLowerCase();
	if (scheme === 'file' && /^file:\/\//i.test(rawValue)) {
		if (uri.fragment) {
			return undefined;
		}
		const localRepositoryUri = URI.file(uri.fsPath);
		return {
			rawValue,
			displayLabel: localRepositoryUri.fsPath,
			cloneUrl: rawValue,
			canonicalId: `file:${localRepositoryUri.toString().toLowerCase()}`,
			cacheSegments: [],
			kind: MarketplaceReferenceKind.LocalFileUri,
			localRepositoryUri,
		};
	}

	if (scheme !== 'http' && scheme !== 'https' && scheme !== 'ssh') {
		return undefined;
	}

	if (!uri.authority) {
		return undefined;
	}

	const ref = uri.fragment || undefined;
	const cloneUri = uri.fragment ? uri.with({ fragment: '' }) : uri;
	const sanitizedAuthority = sanitizePathSegment(uri.authority.toLowerCase());
	const trimmedPath = uri.path.replace(/\/+/g, '/').replace(/\/+$/g, '').replace(/^\/+/, '');

	if (!trimmedPath) {
		return {
			rawValue,
			displayLabel: rawValue,
			cloneUrl: cloneUri.toString(),
			canonicalId: appendRefSuffix(`git:${uri.authority.toLowerCase()}/`, ref),
			cacheSegments: [sanitizedAuthority, ...getRefCacheSegments(ref)],
			kind: MarketplaceReferenceKind.GitUri,
			ref,
		};
	}

	const gitSuffix = '.git';
	const pathHasGitSuffix = trimmedPath.toLowerCase().endsWith(gitSuffix);
	const pathWithoutGit = pathHasGitSuffix ? trimmedPath.slice(0, trimmedPath.length - gitSuffix.length) : trimmedPath;
	const pathSegments = pathWithoutGit.split('/').map(sanitizePathSegment);
	const canonicalPath = pathHasGitSuffix ? trimmedPath.toLowerCase() : `${trimmedPath.toLowerCase()}${gitSuffix}`;

	const githubRepo = extractGitHubRepo(uri.authority, pathWithoutGit);

	let canonicalId: string;
	if (githubRepo) {
		const [owner, repo] = githubRepo.split('/');
		canonicalId = getGitHubCanonicalId(owner, repo, ref);
	} else {
		canonicalId = appendRefSuffix(`git:${uri.authority.toLowerCase()}/${canonicalPath}`, ref);
	}

	return {
		rawValue,
		displayLabel: rawValue,
		cloneUrl: cloneUri.toString(),
		canonicalId,
		cacheSegments: [sanitizedAuthority, ...pathSegments, ...getRefCacheSegments(ref)],
		kind: MarketplaceReferenceKind.GitUri,
		ref,
		githubRepo,
	};
}

function parseScpMarketplaceReference(rawValue: string): IMarketplaceReference | undefined {
	const match = /^([^@\s]+)@([^:\s]+):(.+?\.git)(?:#(.+))?$/i.exec(rawValue);
	if (!match) {
		return undefined;
	}

	const gitSuffix = '.git';
	const authority = match[2];
	const pathWithGit = match[3].replace(/^\/+/, '');
	const ref = match[4];
	if (!pathWithGit.toLowerCase().endsWith(gitSuffix)) {
		return undefined;
	}

	const pathWithoutGit = pathWithGit.slice(0, -gitSuffix.length);
	const pathSegments = pathWithoutGit.split('/').map(sanitizePathSegment);
	const githubRepo = extractGitHubRepo(authority, pathWithoutGit);

	let canonicalId: string;
	if (githubRepo) {
		const [owner, repo] = githubRepo.split('/');
		canonicalId = getGitHubCanonicalId(owner, repo, ref);
	} else {
		canonicalId = appendRefSuffix(`git:${authority.toLowerCase()}/${pathWithGit.toLowerCase()}`, ref);
	}

	return {
		rawValue,
		displayLabel: rawValue,
		cloneUrl: `${match[1]}@${authority}:${pathWithGit}`,
		canonicalId,
		cacheSegments: [sanitizePathSegment(authority.toLowerCase()), ...pathSegments, ...getRefCacheSegments(ref)],
		kind: MarketplaceReferenceKind.GitUri,
		ref,
		githubRepo,
	};
}

function extractGitHubRepo(authority: string, pathWithoutGit: string): string | undefined {
	if (authority.toLowerCase() !== 'github.com') {
		return undefined;
	}
	const parts = pathWithoutGit.split('/');
	if (parts.length >= 2 && parts[0] && parts[1]) {
		return `${parts[0]}/${parts[1]}`;
	}
	return undefined;
}

function getGitHubCanonicalId(owner: string, repo: string, ref?: string): string {
	return appendRefSuffix(`github:${owner.toLowerCase()}/${repo.toLowerCase()}`, ref);
}

function appendRefSuffix(canonicalId: string, ref: string | undefined): string {
	return ref ? `${canonicalId}#${encodeURIComponent(ref)}` : canonicalId;
}

function getRefCacheSegments(ref: string | undefined): string[] {
	return ref ? [`ref_${encodeURIComponent(ref)}`] : [];
}

function sanitizePathSegment(value: string): string {
	return value.replace(/[\\/:*?"<>|]/g, '_');
}
