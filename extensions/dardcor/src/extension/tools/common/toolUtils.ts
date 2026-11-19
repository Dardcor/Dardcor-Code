/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../util/dardcor/base/common/uri';
import { Location } from '../../../dardcorTypes';

type FileUriMetadata = {
	vscodeLinkType: 'skill';
	linkText: string;
};

export function formatUriForFileWidget(uriOrLocation: URI | Location, metadata?: FileUriMetadata): string {
	const uri = URI.isUri(uriOrLocation) ? uriOrLocation : uriOrLocation.uri;
	const rangePart = URI.isUri(uriOrLocation) ?
		'' :
		`#${uriOrLocation.range.start.line + 1}-${uriOrLocation.range.end.line + 1}`;

	if (metadata) {
		const uriWithQuery = uri.with({ query: `vscodeLinkType=${metadata.vscodeLinkType}` });
		return `[${metadata.linkText}](${uriWithQuery.toString()}${rangePart})`;
	}

	return `[](${uri.toString()}${rangePart})`;
}

export function encodeUrlHostname(url: string): { encoded: string; isDifferent: boolean } {
	if (!URL.canParse(url)) {
		return { encoded: url, isDifferent: false };
	}

	const urlObj = new URL(url);
	let encodedUrl = urlObj.href;

	const hasNoPath = !url.includes('/', url.indexOf('://') + 3);
	if (hasNoPath) {
		encodedUrl = encodedUrl.replace(/\/(\?|#)/, '$1');
		if (encodedUrl.endsWith('/') && !url.endsWith('/')) {
			encodedUrl = encodedUrl.slice(0, -1);
		}
	}

	const isDifferent = url !== encodedUrl;

	return {
		encoded: encodedUrl,
		isDifferent
	};
}
