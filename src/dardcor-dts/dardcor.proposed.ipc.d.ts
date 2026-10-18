/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface MessagePassingProtocol {

		readonly onDidReceiveMessage: Event<any>;

		postMessage(message: any, transfer?: ArrayBuffer[]): void;
	}

	export interface ExtensionContext {

		readonly messagePassingProtocol: MessagePassingProtocol | undefined;
	}
}
