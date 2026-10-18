/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type IExtraKnownMarketplaceEntry =
	| { readonly name: string; readonly autoUpdate?: boolean; readonly source: { readonly source: 'github'; readonly repo: string; readonly ref?: string } }
	| { readonly name: string; readonly autoUpdate?: boolean; readonly source: { readonly source: 'git'; readonly url: string; readonly ref?: string } };

export interface IExtraKnownMarketplaceConfigValue {
	readonly source: string;
	readonly autoUpdate: boolean;
}

export type ExtraKnownMarketplacesConfigDict = Record<string, string>;

export interface IStrictMarketplaceSource {
	readonly source: 'github' | 'git' | 'url' | 'npm' | 'file' | 'directory' | 'hostPattern' | 'pathPattern';
	readonly repo?: string;
	readonly url?: string;
	readonly ref?: string;
	readonly path?: string;
	readonly package?: string;
	readonly hostPattern?: string;
	readonly pathPattern?: string;
	readonly headers?: Readonly<Record<string, string>>;
}

export function extraKnownMarketplacesToConfigDict(entries: readonly (string | IExtraKnownMarketplaceEntry)[] | undefined): ExtraKnownMarketplacesConfigDict | undefined {
	if (!entries?.length) {
		return undefined;
	}
	const obj: ExtraKnownMarketplacesConfigDict = {};
	for (const entry of entries) {
		if (typeof entry === 'string') {
			if (isUnsafeMarketplaceKey(entry)) {
				continue;
			}
			obj[entry] = entry;
		} else {
			if (isUnsafeMarketplaceKey(entry.name)) {
				continue;
			}
			const s = entry.source;
			const base = s.source === 'github' ? s.repo : s.url;
			const source = s.ref ? `${base}#${s.ref}` : base;
			obj[entry.name] = entry.autoUpdate === undefined ? source : JSON.stringify({ source, autoUpdate: entry.autoUpdate } satisfies IExtraKnownMarketplaceConfigValue);
		}
	}
	return obj;
}

function isUnsafeMarketplaceKey(key: string): boolean {
	return key === '__proto__' || key === 'constructor' || key === 'prototype';
}
