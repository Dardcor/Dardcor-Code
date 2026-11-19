/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export namespace workspace {
		export function registerCanonicalUriProvider(scheme: string, provider: CanonicalUriProvider): Disposable;

		export function getCanonicalUri(uri: Uri, options: CanonicalUriRequestOptions, token: CancellationToken): ProviderResult<Uri>;
	}

	export interface CanonicalUriProvider {
		provideCanonicalUri(uri: Uri, options: CanonicalUriRequestOptions, token: CancellationToken): ProviderResult<Uri>;
	}

	export interface CanonicalUriRequestOptions {
		targetScheme: string;
	}
}
