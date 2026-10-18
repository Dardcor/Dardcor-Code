/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const ChatAIDisabledSettingId = 'chat.disableAIFeatures';

export const ChatMicrosoftAuthenticationEnabledSettingId = 'chat.microsoftAuthentication.enabled';

export const ChatEditAutoApproveSettingId = 'chat.tools.edits.autoApprove';

export type ChatEditAutoApprovePatterns = Readonly<Record<string, boolean>>;

export const enum ChatExternalSessionsMode {
	Recent = 'recent',
	None = 'none',
	Last24Hours = 'last24Hours',
	Last7Days = 'last7Days',
	Last30Days = 'last30Days',
}

export const ALWAYS_CHECKED_EDIT_PATTERNS: ChatEditAutoApprovePatterns = {
	'**/.mcp.json': false,
	'**/.npmrc': false,
	'**/.dardcor-code/*.json': false,
	'**/.vscode/*.json': false,
	'**/.github/agents/**': false,
	'**/.github/hooks/**': false,
	'**/.claude/agents/**': false,
	'**/.claude/settings.json': false,
	'**/.claude/settings.local.json': false,
};

export const DEFAULT_EDIT_AUTO_APPROVE_PATTERNS: ChatEditAutoApprovePatterns = {
	'**/*': true,
	'**/.git/**': false,
	'**/{package.json,server.xml,build.rs,web.config,.gitattributes,.env,Cargo.toml}': false,
	'**/{.npmrc,.yarnrc,.yarnrc.yml,.pnpmfile.js,.pnpmfile.cjs,.pnpmfile.mjs,pnpm-workspace.yaml}': false,
	'**/*.{code-workspace,csproj,fsproj,vbproj,vcxproj,proj,targets,props,gradle,gradle.kts}': false,
	'**/gradle.properties': false,
	'**/ruby_lsp/*/addon': false,
	'**/*.lock': false,
	'**/*-lock.{yaml,json}': false,
	...ALWAYS_CHECKED_EDIT_PATTERNS,
};

export function mergeChatEditAutoApprovePatterns(value: unknown): ChatEditAutoApprovePatterns {
	const patterns: Record<string, boolean> = { ...DEFAULT_EDIT_AUTO_APPROVE_PATTERNS };
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return patterns;
	}
	for (const [pattern, isApproved] of Object.entries(value)) {
		delete patterns[pattern];
		patterns[pattern] = isApproved === true;
	}
	return patterns;
}
