/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptsType } from '../../common/promptSyntax/promptTypes.js';

export function truncateToFirstLine(text: string): string {
	const newlineIndex = text.search(/[\r\n]/);
	if (newlineIndex !== -1) {
		return text.substring(0, newlineIndex);
	}
	return text;
}

export function getCustomizationSecondaryText(description: string | undefined, filename: string, promptType: PromptsType): string {
	if (!description) {
		return filename;
	}

	return promptType === PromptsType.hook ? description : truncateToFirstLine(description);
}

export function extractExtensionIdFromPath(uriPath: string): string | undefined {
	const segments = uriPath.split('/');

	const globalStorageIdx = segments.lastIndexOf('globalStorage');
	if (
		globalStorageIdx > 0
		&& segments[globalStorageIdx - 1] === 'User'
		&& globalStorageIdx + 2 < segments.length
	) {
		const candidate = segments[globalStorageIdx + 1];
		if (/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i.test(candidate)) {
			return candidate;
		}
	}

	const extensionsIdx = segments.lastIndexOf('extensions');
	if (extensionsIdx < 0 || extensionsIdx + 1 >= segments.length) {
		return undefined;
	}
	const folderName = segments[extensionsIdx + 1];
	const versionMatch = folderName.match(/^(.+)-\d+\./);
	return versionMatch ? versionMatch[1] : undefined;
}
