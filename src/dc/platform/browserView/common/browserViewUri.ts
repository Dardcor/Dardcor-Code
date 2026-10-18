/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';

export namespace BrowserViewUri {

	export const scheme = Schemas.vscodeBrowser;

	export function forId(id: string): URI {
		return URI.from({ scheme, path: `/${id}` });
	}

	export function parse(resource: URI): { id: string } | undefined {
		if (resource.scheme !== scheme) {
			return undefined;
		}

		const id = resource.path.startsWith('/') ? resource.path.substring(1) : resource.path;
		if (!id) {
			return undefined;
		}

		return { id };
	}

	export function getId(resource: URI): string | undefined {
		return parse(resource)?.id;
	}
}
