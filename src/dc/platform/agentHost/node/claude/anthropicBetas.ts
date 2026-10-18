/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


const SUPPORTED_ANTHROPIC_BETAS: readonly string[] = [
	'interleaved-thinking',
	'context-management',
	'advanced-tool-use',
];

export function filterSupportedBetas(headerValue: string): string | undefined {
	const filtered = headerValue
		.split(',')
		.map(b => b.trim())
		.filter(b => b && SUPPORTED_ANTHROPIC_BETAS.some(supported => b.startsWith(supported + '-')));

	return filtered.length > 0 ? filtered.join(',') : undefined;
}
