/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ToolResultDataOutput {
		mime: string;

		value: Uint8Array;
	}

	export interface ExtendedLanguageModelToolResult2 extends ExtendedLanguageModelToolResult {
		toolResultDetails2?: Array<Uri | Location> | ToolResultDataOutput;
	}

	export interface ChatOutputDataItem {
		readonly mime: string;

		readonly value: Uint8Array;
	}

	export interface ChatOutputWebview {
		readonly webview: Webview;

		readonly onDidDispose: Event<void>;
	}

	export interface ChatOutputRenderContext {
		readonly codeBlockContext?: {
			readonly languageIdentifier: string;
		};
	}

	export interface ChatOutputRenderer {
		renderChatOutput(data: ChatOutputDataItem, webview: ChatOutputWebview, ctx: ChatOutputRenderContext, token: CancellationToken): Thenable<void>;
	}

	export namespace chat {
		export function registerChatOutputRenderer(viewType: string, renderer: ChatOutputRenderer): Disposable;
	}
}
