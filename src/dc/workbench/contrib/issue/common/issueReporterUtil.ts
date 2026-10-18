/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { rtrim } from '../../../../base/common/strings.js';

export function normalizeGitHubUrl(url: string): string {
	if (url.endsWith('.git')) {
		url = url.substr(0, url.length - 4);
	}

	url = rtrim(url, '/');

	if (url.endsWith('/new')) {
		url = rtrim(url, '/new');
	}

	if (url.endsWith('/issues')) {
		url = rtrim(url, '/issues');
	}

	return url;
}
