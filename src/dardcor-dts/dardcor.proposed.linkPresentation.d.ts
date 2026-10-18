/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export type LinkPresentationKind =
		| 'resource'
		| 'issue'
		| 'pullRequest'
		| 'commit'
		| 'file'
		| 'folder'
		| 'session'
		| 'chat'
		| 'repository'
		| 'branch';

	export type LinkPresentationStatusKind =
		| 'neutral'
		| 'pending'
		| 'success'
		| 'warning'
		| 'error'
		| 'open'
		| 'closed'
		| 'merged'
		| 'draft'
		| 'notPlanned';

	export interface LinkPresentationStatus {
		readonly kind: LinkPresentationStatusKind;
		readonly label: string;
	}

	export interface LinkPresentationData {
		readonly kind: LinkPresentationKind;
		readonly title?: string;
		readonly detail?: string;
		readonly reference?: string;
		readonly status?: LinkPresentationStatus;
		readonly secondaryStatus?: LinkPresentationStatus;
		readonly changes?: {
			readonly insertions: number;
			readonly deletions: number;
		};
		readonly tooltip?: string;
		readonly ariaLabel?: string;
		readonly isLoading?: boolean;
	}

	export interface LinkPresentationRule {
		readonly id: string;

		readonly uriPattern: RegExp;

		readonly kind: LinkPresentationKind;
	}

	export interface LinkPresentationWatcher extends Disposable {
		readonly presentation: LinkPresentationData;

		readonly onDidChangePresentation: Event<void>;
	}

	export interface LinkPresentationProvider {
		provideLinkPresentationWatcher(resource: Uri, token: CancellationToken): LinkPresentationWatcher;
	}

	export namespace window {
		export const linkPresentationRules: readonly LinkPresentationRule[];

		export const onDidChangeLinkPresentationRules: Event<void>;

		export function createLinkPresentationWatcher(id: string, resource: Uri): LinkPresentationWatcher;

		export function registerLinkPresentationProvider(id: string, provider: LinkPresentationProvider): Disposable;
	}
}
