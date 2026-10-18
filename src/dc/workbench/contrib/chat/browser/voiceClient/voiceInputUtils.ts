/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function combineVoiceInput(existing: string, transcript: string): string {
	if (!existing) {
		return transcript;
	}
	if (!transcript) {
		return existing;
	}
	return /\s$/.test(existing) ? `${existing}${transcript}` : `${existing} ${transcript}`;
}
