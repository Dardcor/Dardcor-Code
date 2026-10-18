/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface Extension<T> {

		readonly isFromDifferentExtensionHost: boolean;
	}

	export namespace extensions {

		export function getExtension<T = any>(extensionId: string, includeDifferentExtensionHosts: boolean): Extension<T> | undefined;
		export function getExtension<T = any>(extensionId: string, includeDifferentExtensionHosts: true): Extension<T | undefined> | undefined;

		export const allAcrossExtensionHosts: readonly Extension<void>[];

	}
}
