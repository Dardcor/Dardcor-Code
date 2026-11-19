/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface ResourceTrustRequestOptions {
		readonly uri: Uri;

		readonly message?: string;
	}

	export interface WorkspaceTrustRequestOptions {
		readonly message?: string;
	}

	export namespace workspace {
		export const onDidChangeWorkspaceTrustedFolders: Event<void>;

		export function isResourceTrusted(resource: Uri): Thenable<boolean>;

		export function requestResourceTrust(options: ResourceTrustRequestOptions): Thenable<boolean | undefined>;

		export function requestWorkspaceTrust(options?: WorkspaceTrustRequestOptions): Thenable<boolean | undefined>;
	}
}
