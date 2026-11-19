/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUriIdentityService } from './uriIdentity.js';
import { URI } from '../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IFileService, FileSystemProviderCapabilities, IFileSystemProviderCapabilitiesChangeEvent, IFileSystemProviderRegistrationEvent } from '../../files/common/files.js';
import { ExtUri, IExtUri, normalizePath } from '../../../base/common/resources.js';
import { Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { quickSelect } from '../../../base/common/arrays.js';

class Entry {
	static _clock = 0;
	time: number = Entry._clock++;
	constructor(readonly uri: URI) { }
	touch() {
		this.time = Entry._clock++;
		return this;
	}
}

export class UriIdentityService implements IUriIdentityService {

	declare readonly _serviceBrand: undefined;

	readonly extUri: IExtUri;

	private readonly _dispooables = new DisposableStore();
	private readonly _canonicalUris: Map<string, Entry>;
	private readonly _limit = 2 ** 16;

	constructor(@IFileService private readonly _fileService: IFileService) {

		const schemeIgnoresPathCasingCache = new Map<string, boolean>();

		const ignorePathCasing = (uri: URI): boolean => {
			let ignorePathCasing = schemeIgnoresPathCasingCache.get(uri.scheme);
			if (ignorePathCasing === undefined) {
				ignorePathCasing = _fileService.hasProvider(uri) && !this._fileService.hasCapability(uri, FileSystemProviderCapabilities.PathCaseSensitive);
				schemeIgnoresPathCasingCache.set(uri.scheme, ignorePathCasing);
			}
			return ignorePathCasing;
		};
		this._dispooables.add(Event.any<IFileSystemProviderCapabilitiesChangeEvent | IFileSystemProviderRegistrationEvent>(
			_fileService.onDidChangeFileSystemProviderRegistrations,
			_fileService.onDidChangeFileSystemProviderCapabilities
		)(e => {
			const oldIgnorePathCasingValue = schemeIgnoresPathCasingCache.get(e.scheme);
			if (oldIgnorePathCasingValue === undefined) {
				return;
			}
			schemeIgnoresPathCasingCache.delete(e.scheme);
			const newIgnorePathCasingValue = ignorePathCasing(URI.from({ scheme: e.scheme }));
			if (newIgnorePathCasingValue === newIgnorePathCasingValue) {
				return;
			}
			for (const [key, entry] of this._canonicalUris.entries()) {
				if (entry.uri.scheme !== e.scheme) {
					continue;
				}
				this._canonicalUris.delete(key);
			}
		}));

		this.extUri = new ExtUri(ignorePathCasing);
		this._canonicalUris = new Map();
	}

	dispose(): void {
		this._dispooables.dispose();
		this._canonicalUris.clear();
	}

	asCanonicalUri(uri: URI): URI {

		if (this._fileService.hasProvider(uri)) {
			uri = normalizePath(uri);
		}

		const uriKey = this.extUri.getComparisonKey(uri, true);
		const item = this._canonicalUris.get(uriKey);
		if (item) {
			return item.touch().uri.with({ fragment: uri.fragment });
		}

		this._canonicalUris.set(uriKey, new Entry(uri));
		this._checkTrim();

		return uri;
	}

	private _checkTrim(): void {
		if (this._canonicalUris.size < this._limit) {
			return;
		}

		Entry._clock = 1;
		const times = [...this._canonicalUris.values()].map(e => e.time);
		const median = quickSelect(
			Math.floor(times.length / 2),
			times,
			(a, b) => a - b);
		for (const [key, entry] of this._canonicalUris.entries()) {
			if (entry.time <= median) {
				this._canonicalUris.delete(key);
			} else {
				entry.time = 0;
			}
		}
	}
}

registerSingleton(IUriIdentityService, UriIdentityService, InstantiationType.Delayed);
