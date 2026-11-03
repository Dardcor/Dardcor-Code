/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import type { DardcorSupportedLanguage } from './dardcorAgentRunPolicy.js';

export type DardcorCognitivePhase =
	| 'orienting'
	| 'hypothesizing'
	| 'executing'
	| 'self-healing'
	| 'verifying'
	| 'synthesizing';

export interface IDardcorHypothesis {
	readonly id: string;
	readonly statement: string;
	readonly status: 'untested' | 'confirmed' | 'refuted';
	readonly evidence?: string;
	readonly updatedAt: number;
}

export interface IDardcorActionTrace {
	readonly turn: number;
	readonly toolName: string;
	readonly target: string;
	readonly fingerprint: string;
	readonly succeeded: boolean;
	readonly timestamp: number;
}

export interface IDardcorThrashDetection {
	readonly isThrashing: boolean;
	readonly kind?: 'identical-failure-loop' | 'file-edit-oscillation' | 'excessive-unfocused-exploration';
	readonly target?: string;
	readonly repeatCount: number;
	readonly recommendation: string;
}

export interface IDardcorConsciousnessState {
	readonly sessionKey: string;
	phase: DardcorCognitivePhase;
	confidenceScore: number;
	readonly hypotheses: Map<string, IDardcorHypothesis>;
	readonly actionHistory: IDardcorActionTrace[];
	readonly fileStateHashes: Map<string, string[]>;
	readonly touchedFiles: Set<string>;
	thrashCount: number;
	successfulActionsCount: number;
	failedActionsCount: number;
	lastIntrospectionAt?: number;
}

const _sessionConsciousnessStates = new Map<string, IDardcorConsciousnessState>();

export function getOrCreateConsciousnessState(sessionKey: string): IDardcorConsciousnessState {
	let state = _sessionConsciousnessStates.get(sessionKey);
	if (!state) {
		state = {
			sessionKey,
			phase: 'orienting',
			confidenceScore: 0.85,
			hypotheses: new Map(),
			actionHistory: [],
			fileStateHashes: new Map(),
			touchedFiles: new Set(),
			thrashCount: 0,
			successfulActionsCount: 0,
			failedActionsCount: 0,
		};
		_sessionConsciousnessStates.set(sessionKey, state);
	}
	return state;
}

export function fastSemanticHash(input: string): string {
	const normalized = input.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
	let h1 = 0xdeadbeef ^ normalized.length;
	let h2 = 0x41c6ce57 ^ normalized.length;
	for (let i = 0; i < normalized.length; i++) {
		const ch = normalized.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function recordConsciousToolAction(
	sessionKey: string,
	turn: number,
	toolName: string,
	args: Record<string, any> | undefined,
	succeeded: boolean,
	newFileContent?: string,
): IDardcorThrashDetection {
	const state = getOrCreateConsciousnessState(sessionKey);
	const target = String(
		args?.filePath ?? args?.path ?? args?.command ?? args?.commandLine ?? args?.pattern ?? args?.query ?? args?.url ?? toolName
	).trim().slice(0, 240);

	const payloadForHash = `${toolName}:${target}:${JSON.stringify(args ?? {})}`;
	const fingerprint = fastSemanticHash(payloadForHash);

	if (succeeded) {
		state.successfulActionsCount++;
	} else {
		state.failedActionsCount++;
	}

	const isWriteOrEdit = ['write_file', 'edit_file', 'multi_edit_file', 'batch_edit_files', 'delete_file', 'rename_file'].includes(toolName);
	const isVerification = ['get_diagnostics', 'run_command', 'run_in_terminal', 'run_task', 'create_and_run_task', 'audit_page_visual_and_network', 'read_browser_page'].includes(toolName);
	if (isWriteOrEdit) {
		state.phase = succeeded ? 'executing' : 'self-healing';
		if (target) {
			state.touchedFiles.add(target);
		}
	} else if (isVerification) {
		state.phase = succeeded ? 'verifying' : 'self-healing';
	} else if (toolName === 'task_completed') {
		state.phase = 'synthesizing';
	}

	state.actionHistory.push({
		turn,
		toolName,
		target,
		fingerprint,
		succeeded,
		timestamp: Date.now(),
	});
	if (state.actionHistory.length > 80) {
		state.actionHistory.splice(0, state.actionHistory.length - 80);
	}

	// Track file content hashes to detect ABAB / ABA edit oscillation
	let fileOscillating = false;
	if (isWriteOrEdit && target && typeof newFileContent === 'string') {
		const contentHash = fastSemanticHash(newFileContent);
		const history = state.fileStateHashes.get(target) ?? [];
		if (history.length >= 2 && history.slice(0, -1).includes(contentHash) && history[history.length - 1] !== contentHash) {
			fileOscillating = true;
		}
		history.push(contentHash);
		if (history.length > 12) {
			history.shift();
		}
		state.fileStateHashes.set(target, history);
	}

	// 1. Check identical failing tool call loop
	const recent = state.actionHistory.slice(-6);
	const identicalRecentFailures = recent.filter(a => !a.succeeded && a.fingerprint === fingerprint).length;
	if (!succeeded && identicalRecentFailures >= 2) {
		state.thrashCount++;
		recalculateConfidence(state);
		return {
			isThrashing: true,
			kind: 'identical-failure-loop',
			target,
			repeatCount: identicalRecentFailures,
			recommendation: `Tool '${toolName}' on '${target}' has failed ${identicalRecentFailures} times with identical parameters. Do NOT repeat the same call. Inspect the target state first (e.g. read_file with exact line range, find_symbol_references, or introspect_self) and switch to an alternative tool such as multi_edit_file or write_file.`,
		};
	}

	// 2. Check repeated edit failures on the same file or ABA content oscillation
	const recentFileFailures = recent.filter(a => !a.succeeded && a.target === target && isWriteOrEdit).length;
	if (fileOscillating || recentFileFailures >= 2) {
		state.thrashCount++;
		recalculateConfidence(state);
		return {
			isThrashing: true,
			kind: 'file-edit-oscillation',
			target,
			repeatCount: Math.max(2, recentFileFailures),
			recommendation: fileOscillating
				? `Metacognitive alert: File '${target}' is oscillating between previously tried states (ABA thrashing). Pause direct trial-and-error edits, create a checkpoint with create_checkpoint, verify caller contracts via find_symbol_references or get_call_hierarchy, and apply a holistic fix.`
				: `Multiple edit attempts on '${target}' failed. Read the exact target lines with read_file before using multi_edit_file, or use write_file if replacing the entire module.`,
		};
	}

	// 3. Check unfocused exploration loop (>10 consecutive read/search tools without hypothesis or action)
	const recent10 = state.actionHistory.slice(-10);
	const allReadOnly = recent10.length === 10 && recent10.every(a =>
		['read_file', 'list_directory', 'find_files', 'search_code', 'grep_search'].includes(a.toolName)
	);
	const uniqueTargets = new Set(recent10.map(a => a.fingerprint)).size;
	if (allReadOnly && uniqueTargets <= 5) {
		state.thrashCount++;
		recalculateConfidence(state);
		return {
			isThrashing: true,
			kind: 'excessive-unfocused-exploration',
			target,
			repeatCount: 10,
			recommendation: `Metacognitive alert: You have executed 10 repetitive read/search calls across the same targets. Synthesize your findings now and proceed to concrete implementation or use go_to_definition / find_symbol_references for exact symbol navigation.`,
		};
	}

	recalculateConfidence(state);
	return {
		isThrashing: false,
		repeatCount: 0,
		recommendation: '',
	};
}

function recalculateConfidence(state: IDardcorConsciousnessState): void {
	const total = state.successfulActionsCount + state.failedActionsCount;
	if (total === 0) {
		state.confidenceScore = 0.85;
		return;
	}
	const successRatio = state.successfulActionsCount / total;
	const thrashPenalty = Math.min(0.45, state.thrashCount * 0.12);
	const raw = 0.35 + (successRatio * 0.65) - thrashPenalty;
	state.confidenceScore = Math.max(0.1, Math.min(0.99, Number(raw.toFixed(2))));
}

export function getMetacognitivePivotDirective(lang: DardcorSupportedLanguage, detection: IDardcorThrashDetection): string {
	if (!detection.isThrashing) {
		return '';
	}
	if (lang === 'id') {
		return `\n[KESADARAN METAKOGNITIF DARDCOR — DETEKSI SIKLUS (${detection.kind})]:\nSistem kesadaran internal mendeteksi pola pengulangan tidak efektif pada "${detection.target ?? 'aksi terakhir'}" (${detection.repeatCount}x). DILARANG mengulangi pemanggilan alat dengan argumen yang sama. Arahan strategis: ${detection.recommendation}`;
	}
	return `\n[DARDCOR METACOGNITIVE CONSCIOUSNESS — THRASH DETECTED (${detection.kind})]:\nInternal self-awareness detected an unproductive loop on "${detection.target ?? 'recent action'}" (${detection.repeatCount}x). Do NOT repeat the identical tool invocation. Strategic pivot: ${detection.recommendation}`;
}

export function upsertHypothesis(
	sessionKey: string,
	id: string,
	statement: string,
	status: 'untested' | 'confirmed' | 'refuted',
	evidence?: string,
): IDardcorHypothesis {
	const state = getOrCreateConsciousnessState(sessionKey);
	const hyp: IDardcorHypothesis = {
		id,
		statement,
		status,
		evidence,
		updatedAt: Date.now(),
	};
	state.hypotheses.set(id, hyp);
	return hyp;
}

export function formatConsciousnessTelemetry(
	sessionKey: string,
	extraContext: {
		activeModel?: string;
		activeStealthTerminals: ReadonlyArray<{ id: string; label: string; command: string }>;
		activeSkills: ReadonlyArray<string>;
		memorySummary?: string;
		checkpointsCount: number;
	}
): string {
	const state = getOrCreateConsciousnessState(sessionKey);
	state.lastIntrospectionAt = Date.now();
	const hypothesesList = Array.from(state.hypotheses.values());
	const recentActions = state.actionHistory.slice(-8).map(
		a => `  - [Turn ${a.turn}] ${a.toolName}(${a.target}) -> ${a.succeeded ? 'OK' : 'FAILED'}`
	);
	const stealthList = extraContext.activeStealthTerminals.map(
		t => `  - [${t.id}] ${t.label}: \`${t.command}\``
	);

	return [
		`### 🧠 Dardcor Omega Self-Awareness & Introspection Telemetry`,
		`- **Cognitive Phase**: \`${state.phase}\``,
		`- **Metacognitive Confidence Score**: \`${(state.confidenceScore * 100).toFixed(0)}%\` (${state.successfulActionsCount} succeeded / ${state.failedActionsCount} failed / ${state.thrashCount} thrash pivots)`,
		`- **Active Model Engine**: \`${extraContext.activeModel || 'Dardcor Cognitive Router Auto'}\``,
		`- **Touched Files in Session (${state.touchedFiles.size})**: ${state.touchedFiles.size > 0 ? Array.from(state.touchedFiles).slice(0, 12).map(f => `\`${f}\``).join(', ') : 'None yet'}`,
		`- **Saved Time-Machine Checkpoints**: ${extraContext.checkpointsCount}`,
		`- **Active Built-in & Synthesized Skills**: ${extraContext.activeSkills.map(s => `\`/${s}\``).join(', ') || 'None'}`,
		`- **Stealth Background Daemons (${stealthList.length})**:\n${stealthList.length > 0 ? stealthList.join('\n') : '  - None running'}`,
		`- **Tracked Hypotheses (${hypothesesList.length})**:\n${hypothesesList.length > 0 ? hypothesesList.map(h => `  - [${h.status.toUpperCase()}] (${h.id}) ${h.statement}${h.evidence ? ` — Evidence: ${h.evidence}` : ''}`).join('\n') : '  - No explicit hypotheses registered yet'}`,
		`- **Recent Action Trajectory**:\n${recentActions.length > 0 ? recentActions.join('\n') : '  - No actions recorded yet'}`,
		extraContext.memorySummary ? `\n${extraContext.memorySummary}` : '',
	].filter(Boolean).join('\n');
}

// ============================================================================
// 4-Tier Intelligent Fuzzy & Anchor-Aware Patch Engine
// ============================================================================

export interface IFuzzyEditResult {
	readonly matched: boolean;
	readonly tier?: 'exact' | 'eol-normalized' | 'indentation-normalized' | 'context-anchor-fuzzy';
	readonly updatedContent: string;
	readonly failureReason?: string;
}

export function applyIntelligentFuzzyEdit(
	originalContent: string,
	searchContent: string,
	replaceContent: string,
): IFuzzyEditResult {
	if (!searchContent) {
		return {
			matched: false,
			updatedContent: originalContent,
			failureReason: 'searchContent must be a non-empty string.',
		};
	}

	const usesCRLF = originalContent.includes('\r\n');
	const normalizeEOL = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const restoreEOL = (s: string) => usesCRLF ? s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : s;

	// Tier 1: Exact substring match
	const exactIdx = originalContent.indexOf(searchContent);
	if (exactIdx !== -1) {
		const updated = originalContent.slice(0, exactIdx)
			+ replaceContent
			+ originalContent.slice(exactIdx + searchContent.length);
		return { matched: true, tier: 'exact', updatedContent: updated };
	}

	// Tier 2: EOL-normalized exact match (\r\n <-> \n)
	const normOrig = normalizeEOL(originalContent);
	const normSearch = normalizeEOL(searchContent);
	const normReplace = normalizeEOL(replaceContent);

	const eolIdx = normOrig.indexOf(normSearch);
	if (eolIdx !== -1) {
		const updatedNorm = normOrig.slice(0, eolIdx)
			+ normReplace
			+ normOrig.slice(eolIdx + normSearch.length);
		return {
			matched: true,
			tier: 'eol-normalized',
			updatedContent: restoreEOL(updatedNorm),
		};
	}

	// Tier 3: Line-by-line trailing-whitespace & indentation-normalized match
	const origLines = normOrig.split('\n');
	const searchLines = normSearch.split('\n');
	while (searchLines.length > 0 && searchLines[0].trim() === '') {
		searchLines.shift();
	}
	while (searchLines.length > 0 && searchLines[searchLines.length - 1].trim() === '') {
		searchLines.pop();
	}

	if (searchLines.length > 0 && searchLines.length <= origLines.length) {
		const trimmedSearchLines = searchLines.map(l => l.trim());
		const matchIndices: number[] = [];

		for (let i = 0; i <= origLines.length - searchLines.length; i++) {
			let allMatch = true;
			for (let j = 0; j < searchLines.length; j++) {
				if (origLines[i + j].trim() !== trimmedSearchLines[j]) {
					allMatch = false;
					break;
				}
			}
			if (allMatch) {
				matchIndices.push(i);
			}
		}

		if (matchIndices.length === 1) {
			const startLineIdx = matchIndices[0];
			// Preserve indentation delta on replacement lines if consistent
			const origIndentMatch = origLines[startLineIdx].match(/^([ \t]*)/);
			const searchIndentMatch = searchLines[0].match(/^([ \t]*)/);
			const origLead = origIndentMatch ? origIndentMatch[1] : '';
			const searchLead = searchIndentMatch ? searchIndentMatch[1] : '';

			const replaceLines = normReplace.split('\n').map(line => {
				if (!line.trim()) {
					return '';
				}
				if (searchLead && line.startsWith(searchLead)) {
					return origLead + line.slice(searchLead.length);
				}
				return line;
			});

			const newOrigLines = [
				...origLines.slice(0, startLineIdx),
				...replaceLines,
				...origLines.slice(startLineIdx + searchLines.length),
			];
			return {
				matched: true,
				tier: 'indentation-normalized',
				updatedContent: restoreEOL(newOrigLines.join('\n')),
			};
		}
	}

	// Tier 4: Anchor-context fuzzy match (first & last non-empty lines + >= 80% middle similarity)
	if (searchLines.length >= 3 && searchLines.length <= origLines.length) {
		const firstTrimmed = searchLines[0].trim();
		const lastTrimmed = searchLines[searchLines.length - 1].trim();
		const candidateSpans: Array<{ start: number; end: number; score: number }> = [];

		for (let i = 0; i <= origLines.length - searchLines.length; i++) {
			if (origLines[i].trim() !== firstTrimmed) {
				continue;
			}
			// Allow slight line count drift (-2 to +2 lines)
			const minLen = Math.max(2, searchLines.length - 2);
			const maxLen = Math.min(origLines.length - i, searchLines.length + 2);
			for (let len = minLen; len <= maxLen; len++) {
				const endIdx = i + len - 1;
				if (origLines[endIdx].trim() !== lastTrimmed) {
					continue;
				}
				// Score internal line similarity
				let matches = 2;
				const sliceTrimmed = origLines.slice(i + 1, endIdx).map(l => l.trim()).filter(Boolean);
				const searchInner = searchLines.slice(1, -1).map(l => l.trim()).filter(Boolean);
				for (const sLine of searchInner) {
					if (sliceTrimmed.includes(sLine)) {
						matches++;
					}
				}
				const totalCompared = Math.max(1, searchInner.length + 2);
				const score = matches / totalCompared;
				if (score >= 0.8) {
					candidateSpans.push({ start: i, end: endIdx, score });
				}
			}
		}

		if (candidateSpans.length === 1) {
			const span = candidateSpans[0];
			const newOrigLines = [
				...origLines.slice(0, span.start),
				...normReplace.split('\n'),
				...origLines.slice(span.end + 1),
			];
			return {
				matched: true,
				tier: 'context-anchor-fuzzy',
				updatedContent: restoreEOL(newOrigLines.join('\n')),
			};
		}
	}

	return {
		matched: false,
		updatedContent: originalContent,
		failureReason: 'searchContent was not found in the file across all 4 matching tiers (Exact, EOL-Normalized, Indentation-Normalized, and Anchor-Fuzzy). Read the target section with read_file first to get the current lines.',
	};
}

// ============================================================================
// Shadow Time-Machine Checkpoint Manager
// ============================================================================

export interface IDardcorFileSnapshot {
	readonly uri: URI;
	readonly existed: boolean;
	readonly content?: Uint8Array;
}

export interface IDardcorWorkspaceCheckpoint {
	readonly id: string;
	readonly label: string;
	readonly createdAt: number;
	readonly files: Map<string, IDardcorFileSnapshot>;
}

const _workspaceCheckpoints = new Map<string, IDardcorWorkspaceCheckpoint>();

export async function createWorkspaceCheckpoint(
	label: string,
	targetUris: readonly URI[],
	fileService: IFileService,
): Promise<IDardcorWorkspaceCheckpoint> {
	const id = `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	const files = new Map<string, IDardcorFileSnapshot>();

	for (const uri of targetUris) {
		const key = uri.toString();
		if (files.has(key)) {
			continue;
		}
		try {
			const exists = await fileService.exists(uri);
			if (exists) {
				const raw = await fileService.readFile(uri);
				files.set(key, {
					uri,
					existed: true,
					content: new Uint8Array(raw.value.buffer),
				});
			} else {
				files.set(key, { uri, existed: false });
			}
		} catch {
			files.set(key, { uri, existed: false });
		}
	}

	const checkpoint: IDardcorWorkspaceCheckpoint = {
		id,
		label: label || 'Agent Checkpoint',
		createdAt: Date.now(),
		files,
	};
	_workspaceCheckpoints.set(id, checkpoint);

	// Keep max 25 checkpoints in memory
	if (_workspaceCheckpoints.size > 25) {
		const oldestKey = _workspaceCheckpoints.keys().next().value;
		if (oldestKey) {
			_workspaceCheckpoints.delete(oldestKey);
		}
	}
	return checkpoint;
}

export async function restoreWorkspaceCheckpoint(
	checkpointId: string,
	fileService: IFileService,
): Promise<{ restored: boolean; message: string; restoredFiles: string[] }> {
	const targetId = checkpointId.trim();
	let checkpoint = _workspaceCheckpoints.get(targetId);
	if (!checkpoint && !targetId) {
		const all = Array.from(_workspaceCheckpoints.values());
		checkpoint = all[all.length - 1];
	}
	if (!checkpoint) {
		const available = Array.from(_workspaceCheckpoints.values()).map(c => `${c.id} (${c.label})`).join(', ');
		return {
			restored: false,
			message: `Checkpoint '${targetId}' not found. Available checkpoints: ${available || 'none'}.`,
			restoredFiles: [],
		};
	}

	const restoredFiles: string[] = [];
	for (const snap of checkpoint.files.values()) {
		try {
			if (snap.existed && snap.content) {
				await fileService.writeFile(snap.uri, VSBuffer.wrap(snap.content));
				restoredFiles.push(snap.uri.fsPath);
			} else if (!snap.existed) {
				const existsNow = await fileService.exists(snap.uri);
				if (existsNow) {
					await fileService.del(snap.uri, { recursive: true });
					restoredFiles.push(`${snap.uri.fsPath} (removed)`);
				}
			}
		} catch {
		}
	}

	return {
		restored: true,
		message: `Restored checkpoint '${checkpoint.id}' (${checkpoint.label}) across ${restoredFiles.length} file(s).`,
		restoredFiles,
	};
}

export function listWorkspaceCheckpoints(): ReadonlyArray<{ id: string; label: string; fileCount: number; createdAt: number }> {
	return Array.from(_workspaceCheckpoints.values()).map(c => ({
		id: c.id,
		label: c.label,
		fileCount: c.files.size,
		createdAt: c.createdAt,
	}));
}
