/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export enum ExternalUriOpenerPriority {
		None = 0,

		Option = 1,

		Default = 2,

		Preferred = 3,
	}

	export interface ExternalUriOpener {

		canOpenExternalUri(uri: Uri, token: CancellationToken): ExternalUriOpenerPriority | Thenable<ExternalUriOpenerPriority>;

		openExternalUri(resolvedUri: Uri, ctx: OpenExternalUriContext, token: CancellationToken): Thenable<void> | void;
	}

	export interface OpenExternalUriContext {
		readonly sourceUri: Uri;
	}

	export interface ExternalUriOpenerMetadata {

		readonly schemes: readonly string[];

		readonly label: string;
	}

	namespace window {
		export function registerExternalUriOpener(id: string, opener: ExternalUriOpener, metadata: ExternalUriOpenerMetadata): Disposable;
	}

	export interface OpenExternalOptions {
		readonly allowContributedOpeners?: boolean | string;
	}

	namespace env {
		export function openExternal(target: Uri, options?: OpenExternalOptions): Thenable<boolean>;
	}
}
