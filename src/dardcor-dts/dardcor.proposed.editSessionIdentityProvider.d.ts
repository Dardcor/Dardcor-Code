/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export namespace workspace {
		export const onWillCreateEditSessionIdentity: Event<EditSessionIdentityWillCreateEvent>;

		export function registerEditSessionIdentityProvider(scheme: string, provider: EditSessionIdentityProvider): Disposable;
	}

	export interface EditSessionIdentityProvider {
		provideEditSessionIdentity(workspaceFolder: WorkspaceFolder, token: CancellationToken): ProviderResult<string>;

		provideEditSessionIdentityMatch(identity1: string, identity2: string, token: CancellationToken): ProviderResult<EditSessionIdentityMatch>;
	}

	export enum EditSessionIdentityMatch {
		Complete = 100,
		Partial = 50,
		None = 0
	}

	export interface EditSessionIdentityWillCreateEvent {

		readonly token: CancellationToken;

		readonly workspaceFolder: WorkspaceFolder;

		waitUntil(thenable: Thenable<any>): void;
	}
}
