/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ChatStatusItem {
		readonly id: string;

		title: string | { label: string; link: string; helpText?: string };

		description: string;

		detail: string | undefined;

		tooltip: string | undefined;

		show(): void;

		hide(): void;

		dispose(): void;
	}

	namespace window {
		export function createChatStatusItem(id: string): ChatStatusItem;
	}
}
