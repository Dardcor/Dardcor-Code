/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export class DardcorPromptLoadFailure extends Error {
	readonly code = 'DardcorPromptLoadFailure';
	constructor(message: string, cause?: unknown) {
		super(message, { cause });
	}
}
