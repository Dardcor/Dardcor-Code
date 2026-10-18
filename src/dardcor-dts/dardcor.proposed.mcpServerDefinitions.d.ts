/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface McpGatewayServer {
		readonly label: string;

		readonly address: Uri;
	}

	export interface McpGateway extends Disposable {
		readonly servers: readonly McpGatewayServer[];

		readonly onDidChangeServers: Event<readonly McpGatewayServer[]>;
	}

	export namespace lm {
		export const mcpServerDefinitions: readonly McpServerDefinition[];

		export const onDidChangeMcpServerDefinitions: Event<void>;

		export function startMcpGateway(chatSessionResource?: Uri): Thenable<McpGateway | undefined>;
	}
}
