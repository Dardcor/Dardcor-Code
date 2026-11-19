/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface BrowserTab {
		readonly url: string;

		readonly title: string;

		readonly icon: IconPath;

		startCDPSession(): Thenable<BrowserCDPSession>;

		close(): Thenable<void>;
	}

	export interface BrowserCDPSession {
		readonly onDidReceiveMessage: Event<unknown>;

		readonly onDidClose: Event<void>;

		sendMessage(message: unknown): Thenable<void>;

		close(): Thenable<void>;
	}

	export interface BrowserTabShowOptions {
		viewColumn?: ViewColumn;

		preserveFocus?: boolean;

		background?: boolean;
	}

	export namespace window {
		export const browserTabs: readonly BrowserTab[];

		export const onDidOpenBrowserTab: Event<BrowserTab>;

		export const onDidCloseBrowserTab: Event<BrowserTab>;

		export const activeBrowserTab: BrowserTab | undefined;

		export const onDidChangeActiveBrowserTab: Event<BrowserTab | undefined>;

		export const onDidChangeBrowserTabState: Event<BrowserTab>;

		export function openBrowserTab(url: string, options?: BrowserTabShowOptions): Thenable<BrowserTab>;
	}
}
