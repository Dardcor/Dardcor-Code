/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cross-vendor convention env var that announces which AI agent is driving a
 * process. Child processes inherit it; `gh` in particular reads it and reports
 * the value in its `User-Agent`, which lets downstream activity be attributed to
 * the originating AI experience without touching the user's global environment.
 */
export const AiAgentEnvVar = 'AI_AGENT';

export const AiAgentEnvValue = 'github_copilot_vscode_agent';
