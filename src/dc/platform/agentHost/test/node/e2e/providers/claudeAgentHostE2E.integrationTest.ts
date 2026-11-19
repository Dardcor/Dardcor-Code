/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { existsSync } from 'fs';
import { join } from '../../../../../../base/common/path.js';
import { type IAgentHostE2EProviderConfig } from '../harness/agentHostE2ETestHarness.js';
import { defineAgentHostE2ETests } from '../suites/agentHostE2ESuites.js';

function resolveClaudeSdkRoot(): string | undefined {
	const sdkPackageDir = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
	return existsSync(sdkPackageDir) ? process.cwd() : undefined;
}

const CLAUDE_SDK_ROOT = resolveClaudeSdkRoot();

const CLAUDE_CONFIG: IAgentHostE2EProviderConfig = {
	suiteTitle: 'Agent Host E2E — Claude',
	provider: 'claude',
	scheme: 'claude',
	shellToolName: 'Bash',
	fileOperationStrategy: 'fileTools',
	subagentToolNames: ['Task', 'Agent'],
	exitPlanModeToolName: 'ExitPlanMode',
	streamingFileCreateToolName: 'Write',
	modelSwitchTarget: 'claude-sonnet-4.6',
	modelSwitchReturnTarget: 'claude-opus-5',
	interactiveInputPrompt: 'Use AskUserQuestion exactly once to ask "Which fruit?" with options "Apple" and "Banana". After the answer, reply with only the selected fruit.',
	cancelledInputPrompt: 'Use AskUserQuestion exactly once to ask "Continue?" with options "Yes" and "No". If the request is cancelled, reply exactly "cancelled".',
	multiSelectInputPrompt: 'Use AskUserQuestion exactly once to ask "Which colors?" with options "Red" and "Blue" and multiSelect true. After the answer, name the selected colors.',
	supportsRuntimeSlashCommandsE2E: true,
	supportsAttachmentsE2E: true,
	supportsWorktreeIncludeFilesE2E: true,
	enabled: !!CLAUDE_SDK_ROOT,
	claudeSdkRoot: CLAUDE_SDK_ROOT,
	supportsWorktreeIsolation: true,
	supportsHostTerminalTool: false,
	supportsSubagents: true,
	supportsSideChats: true,
	supportsSideChatsE2E: true,
	subagentReplayUnstableOnWindows: true,
	supportsMultipleChats: true,
	supportsChatFork: true,
	supportsChatForkE2E: false,
};

defineAgentHostE2ETests(CLAUDE_CONFIG);
