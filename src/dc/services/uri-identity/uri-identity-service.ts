/**
 * Dardcor Code - URI Case-Insensitivity Identity Normalizer (Task 135)
 */

import { createDecorator } from '../instantiation/annotations';
import { Disposable } from '../../core/lifecycle/disposable';
import { URI } from '../../core/types/uri';
import { isWindows } from '../../core/environment/platform';

export interface IUriIdentityService {
	readonly _serviceBrand: undefined;
	makeCanonicalUri(resource: URI): URI;
	extUriEquals(a: URI, b: URI): boolean;
	compare(a: URI, b: URI): number;
}

export const IUriIdentityService = createDecorator<IUriIdentityService>('uriIdentityService');

export class UriIdentityService extends Disposable implements IUriIdentityService {
	declare readonly _serviceBrand: undefined;

	private readonly _caseInsensitive: boolean;

	constructor(caseInsensitive: boolean = isWindows) {
		super();
		this._caseInsensitive = caseInsensitive;
	}

	public makeCanonicalUri(resource: URI): URI {
		const scheme = resource.scheme.toLowerCase();
		const authority = this._caseInsensitive ? resource.authority.toLowerCase() : resource.authority;
		let path = resource.path;
		if (this._caseInsensitive && scheme === 'file') {
			path = path.replace(/^\/?([a-z]):/, (_m: string, drive: string) => `/${drive.toUpperCase()}:`);
		}
		return URI.from({ scheme, authority, path, query: resource.query, fragment: resource.fragment });
	}

	public extUriEquals(a: URI, b: URI): boolean {
		return this._identityString(a) === this._identityString(b);
	}

	public compare(a: URI, b: URI): number {
		const aStr = this._identityString(a);
		const bStr = this._identityString(b);
		if (aStr < bStr) {
			return -1;
		}
		if (aStr > bStr) {
			return 1;
		}
		return 0;
	}

	private _identityString(uri: URI): string {
		const canonical = this.makeCanonicalUri(uri);
		let result = `${canonical.scheme}://${canonical.authority}${canonical.path}`;
		if (canonical.query) {
			result += `?${canonical.query}`;
		}
		if (canonical.fragment) {
			result += `#${canonical.fragment}`;
		}
		return result;
	}
}
