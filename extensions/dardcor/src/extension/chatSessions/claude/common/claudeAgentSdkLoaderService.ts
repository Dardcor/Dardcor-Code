/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as AgentSdk from '@anthropic-ai/claude-agent-sdk';
import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../../util/common/services';

export const CLAUDE_SDK_EXTENSION_ID = 'ms-vscode.vscode-claude-sdk';

export interface IClaudeAgentSdkLoaderService {
	readonly _serviceBrand: undefined;

	readonly isAvailable: boolean;

	install(token: vscode.CancellationToken): Promise<boolean>;

	load(): Promise<typeof AgentSdk>;
}

export const IClaudeAgentSdkLoaderService = createServiceIdentifier<IClaudeAgentSdkLoaderService>('IClaudeAgentSdkLoaderService');
