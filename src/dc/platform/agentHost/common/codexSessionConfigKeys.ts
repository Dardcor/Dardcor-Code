/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum CodexSessionConfigKey {
	PermissionsPreset = 'codex.permissionsPreset',
	ApprovalPolicy = 'codex.approvalPolicy',
	SandboxMode = 'codex.sandboxMode',
	AdditionalDirectories = 'codex.additionalDirectories',
	NetworkAccessEnabled = 'codex.networkAccessEnabled',
	WebSearchMode = 'codex.webSearchMode',
	ModelReasoningEffort = 'codex.modelReasoningEffort',
	Personality = 'codex.personality',
	ReasoningSummary = 'codex.reasoningSummary',
}

export type CodexApprovalPolicy = 'never' | 'on-request' | 'untrusted';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type CodexApprovalsReviewer = 'user' | 'auto_review' | 'guardian_subagent';

export type CodexPermissionsPreset = 'default' | 'auto-review' | 'full-access';

export const CODEX_PERMISSIONS_PRESETS: readonly CodexPermissionsPreset[] = ['default', 'auto-review', 'full-access'];

export const CODEX_DEFAULT_PERMISSIONS_PRESET: CodexPermissionsPreset = 'default';

export function getCodexAutonomousSessionConfig(policyRestricted: boolean): Record<string, unknown> | undefined {
	return policyRestricted ? undefined : { [CodexSessionConfigKey.PermissionsPreset]: 'auto-review' satisfies CodexPermissionsPreset };
}

export function narrowCodexPermissionsPreset(raw: unknown): CodexPermissionsPreset | undefined {
	switch (raw) {
		case 'default':
		case 'auto-review':
		case 'full-access':
			return raw;
		default:
			return undefined;
	}
}

export interface ICodexResolvedPermissions {
	readonly approvalPolicy: CodexApprovalPolicy;
	readonly sandboxMode: CodexSandboxMode;
	readonly approvalsReviewer: CodexApprovalsReviewer;
}

export function resolveCodexPermissionsPreset(preset: CodexPermissionsPreset): ICodexResolvedPermissions {
	switch (preset) {
		case 'auto-review':
			return { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalsReviewer: 'auto_review' };
		case 'full-access':
			return { approvalPolicy: 'never', sandboxMode: 'danger-full-access', approvalsReviewer: 'user' };
		case 'default':
		default:
			return { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalsReviewer: 'user' };
	}
}

export function presetForResolvedPermissions(resolved: ICodexResolvedPermissions): CodexPermissionsPreset | undefined {
	for (const preset of CODEX_PERMISSIONS_PRESETS) {
		const axes = resolveCodexPermissionsPreset(preset);
		if (axes.approvalPolicy === resolved.approvalPolicy && axes.sandboxMode === resolved.sandboxMode && axes.approvalsReviewer === resolved.approvalsReviewer) {
			return preset;
		}
	}
	return undefined;
}
