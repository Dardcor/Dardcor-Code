/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export enum ChatInputNotificationSeverity {
		Info = 0,

		Warning = 1,

		Error = 2,
	}

	export interface ChatInputNotificationAction {
		label: string;

		commandId: string;

		commandArgs?: unknown[];
	}

	export interface ChatInputNotification {
		readonly id: string;

		severity: ChatInputNotificationSeverity;

		message: string;

		description: string | undefined;

		actions: ChatInputNotificationAction[];

		dismissible: boolean;

		autoDismissOnMessage: boolean;

		sessionTypes: readonly string[] | undefined;

		show(): void;

		hide(): void;

		dispose(): void;
	}

	namespace chat {
		export function createInputNotification(id: string): ChatInputNotification;
	}
}
