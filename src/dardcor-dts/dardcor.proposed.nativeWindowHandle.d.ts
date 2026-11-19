/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare module 'vscode' {

	export namespace window {
		export const nativeHandle: Uint8Array | undefined;
	}
}
