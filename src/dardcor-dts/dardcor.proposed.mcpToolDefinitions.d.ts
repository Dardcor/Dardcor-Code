/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export enum McpToolAvailability {
		Initial = 0,

		Dynamic = 1,
	}

	export interface McpServerLanguageModelToolDefinition {
		definition?: unknown;

		availability: McpToolAvailability;
	}

	export interface McpServerMetadata {
		tools?: McpServerLanguageModelToolDefinition[];

		instructions?: string;

		capabilities?: unknown;

		serverInfo?: unknown;
	}


	export class McpStdioServerDefinition2 extends McpStdioServerDefinition {
		metadata?: McpServerMetadata;
		constructor(label: string, command: string, args?: string[], env?: Record<string, string | number | null>, version?: string, metadata?: McpServerMetadata);
	}

	export class McpHttpServerDefinition2 extends McpHttpServerDefinition {
		metadata?: McpServerMetadata;

		authentication?: {
			providerId: string;
			scopes: string[];
		};

		constructor(label: string, uri: Uri, headers?: Record<string, string>, version?: string, metadata?: McpServerMetadata, authentication?: { providerId: string; scopes: string[] });
	}
}
