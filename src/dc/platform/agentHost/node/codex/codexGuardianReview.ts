/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GuardianApprovalReviewAction } from './protocol/generated/v2/GuardianApprovalReviewAction.js';
import type { ItemGuardianApprovalReviewCompletedNotification } from './protocol/generated/v2/ItemGuardianApprovalReviewCompletedNotification.js';
import type { RequestPermissionProfile } from './protocol/generated/v2/RequestPermissionProfile.js';
import type { JsonValue } from './protocol/generated/serde_json/JsonValue.js';
import { localize } from '../../../../nls.js';
import { unwrapShellInvocation } from './codexShellCommand.js';


function guardianStatusToEvent(status: string): string {
	switch (status) {
		case 'inProgress': return 'in_progress';
		case 'timedOut': return 'timed_out';
		default: return status;
	}
}

function commandSourceToEvent(source: string): string {
	return source === 'unifiedExec' ? 'unified_exec' : source;
}

function networkProtocolToEvent(protocol: string): string {
	switch (protocol) {
		case 'socks5Tcp': return 'socks5_tcp';
		case 'socks5Udp': return 'socks5_udp';
		default: return protocol;
	}
}

function requestPermissionProfileToEvent(profile: RequestPermissionProfile): JsonValue {
	const fs = profile.fileSystem;
	let fileSystem: JsonValue = null;
	if (fs) {
		const mapped: Record<string, JsonValue> = { read: fs.read, write: fs.write };
		if (fs.globScanMaxDepth !== undefined) {
			mapped.glob_scan_max_depth = fs.globScanMaxDepth;
		}
		if (fs.entries !== undefined) {
			mapped.entries = fs.entries as JsonValue;
		}
		fileSystem = mapped;
	}
	return { network: profile.network as JsonValue, file_system: fileSystem };
}

export function guardianReviewActionToEventAction(action: GuardianApprovalReviewAction): JsonValue {
	switch (action.type) {
		case 'command':
			return { type: 'command', source: commandSourceToEvent(action.source), command: action.command, cwd: action.cwd };
		case 'execve':
			return { type: 'execve', source: commandSourceToEvent(action.source), program: action.program, argv: action.argv, cwd: action.cwd };
		case 'applyPatch':
			return { type: 'apply_patch', cwd: action.cwd, files: action.files };
		case 'networkAccess':
			return { type: 'network_access', target: action.target, host: action.host, protocol: networkProtocolToEvent(action.protocol), port: action.port };
		case 'mcpToolCall':
			return { type: 'mcp_tool_call', server: action.server, tool_name: action.toolName, connector_id: action.connectorId, connector_name: action.connectorName, tool_title: action.toolTitle };
		case 'requestPermissions':
			return { type: 'request_permissions', reason: action.reason, permissions: requestPermissionProfileToEvent(action.permissions) };
	}
}

export function toGuardianAssessmentEventJson(notification: ItemGuardianApprovalReviewCompletedNotification): JsonValue {
	const event: Record<string, JsonValue> = {
		id: notification.reviewId,
		turn_id: notification.turnId,
		started_at_ms: notification.startedAtMs,
		status: guardianStatusToEvent(notification.review.status),
		action: guardianReviewActionToEventAction(notification.action),
	};
	if (notification.targetItemId !== null) {
		event.target_item_id = notification.targetItemId;
	}
	if (notification.completedAtMs !== null && notification.completedAtMs !== undefined) {
		event.completed_at_ms = notification.completedAtMs;
	}
	if (notification.review.riskLevel !== null) {
		event.risk_level = notification.review.riskLevel;
	}
	if (notification.review.userAuthorization !== null) {
		event.user_authorization = notification.review.userAuthorization;
	}
	if (notification.review.rationale !== null) {
		event.rationale = notification.review.rationale;
	}
	if (notification.decisionSource !== null && notification.decisionSource !== undefined) {
		event.decision_source = notification.decisionSource;
	}
	return event;
}

export interface IGuardianActionSummary {
	readonly title: string;
	readonly detail: string;
	readonly toolKind?: 'terminal' | 'search';
}

export function summarizeGuardianReviewAction(action: GuardianApprovalReviewAction): IGuardianActionSummary {
	switch (action.type) {
		case 'command':
			return { title: 'Run command', detail: unwrapShellInvocation(action.command), toolKind: 'terminal' };
		case 'execve':
			return { title: 'Run program', detail: unwrapShellInvocation([action.program, ...action.argv].join(' ')), toolKind: 'terminal' };
		case 'applyPatch':
			return { title: 'Apply file changes', detail: action.files.join(', ') };
		case 'networkAccess':
			return { title: 'Network access', detail: action.target || `${action.protocol}://${action.host}:${action.port}`, toolKind: 'search' };
		case 'mcpToolCall':
			return { title: 'MCP tool call', detail: `${action.server}/${action.toolName}` };
		case 'requestPermissions':
			return { title: 'Elevated permissions', detail: action.reason ?? 'Requested additional permissions' };
	}
}

function inlineCode(text: string): string {
	const longestRun = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
	const fence = '`'.repeat(longestRun + 1);
	const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
	return `${fence}${padding}${text}${padding}${fence}`;
}

export function formatGuardianDenialNotification(summary: IGuardianActionSummary, rationale: string | null): string {
	const detail = summary.detail?.trim();
	const header = '**Auto-review denied**';
	const lines: string[] = [
		detail
			? `⚠️ ${header} — ${summary.title}: ${inlineCode(detail)}`
			: `⚠️ ${header} — ${summary.title}`,
	];
	const reason = rationale?.trim();
	if (reason) {
		lines.push('', ...reason.split('\n'));
	}
	const quoted = lines.map(line => (line ? `> ${line}` : '>')).join('\n');
	return `\n\n${quoted}\n`;
}

export function formatGuardianReviewStatusNotification(summary: IGuardianActionSummary, status: 'timedOut' | 'aborted', rationale: string | null): string {
	const title = status === 'timedOut'
		? localize('codex.guardianReview.timedOut', "Auto-review timed out")
		: localize('codex.guardianReview.aborted', "Auto-review stopped");
	const detail = summary.detail?.trim();
	const action = detail ? `${summary.title} ${inlineCode(detail)}` : summary.title;
	const lines = [
		title,
		localize('codex.guardianReview.requestedAction', "Requested action: {0}", action),
	];
	const reason = rationale?.trim();
	if (reason) {
		lines.push('', reason);
	}
	return lines.join('\n');
}
