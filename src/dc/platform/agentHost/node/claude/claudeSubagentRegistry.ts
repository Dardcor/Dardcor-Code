/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	ResponsePartKind,
	ToolCallStatus,
	ToolResultContentType,
	type ResponsePart,
	type Turn,
} from '../../common/state/protocol/state.js';

export const SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set(['Task', 'Agent']);

export const SUBAGENT_ID_SUFFIX_REGEX = /^\s*agentId:\s+([a-z0-9]+)\b/im;

export class SubagentSpawn {
	background = false;
	subagentType: string | undefined;
	description: string | undefined;
	prompt: string | undefined;

	private _agentId: string | undefined;
	private _announced = false;
	private _completed = false;

	constructor(readonly toolUseId: string) { }

	get agentId(): string | undefined {
		return this._agentId;
	}

	setAgentId(agentId: string): void {
		if (this._agentId === undefined) {
			this._agentId = agentId;
		}
	}

	markAnnounced(): boolean {
		if (this._announced) {
			return false;
		}
		this._announced = true;
		return true;
	}

	markCompleted(): boolean {
		if (this._completed) {
			return false;
		}
		this._completed = true;
		return true;
	}
}

export interface ISubagentSpawnInit {
	readonly agentId?: string;
	readonly subagentType?: string;
	readonly description?: string;
	readonly prompt?: string;
}

export class SubagentRegistry extends Disposable {
	private readonly _spawns = new Map<string, SubagentSpawn>();
	private readonly _innerToParent = new Map<string, string>();

	override dispose(): void {
		this._spawns.clear();
		this._innerToParent.clear();
		super.dispose();
	}

	recordSpawn(toolUseId: string, init?: ISubagentSpawnInit): SubagentSpawn {
		let spawn = this._spawns.get(toolUseId);
		if (!spawn) {
			spawn = new SubagentSpawn(toolUseId);
			this._spawns.set(toolUseId, spawn);
		}
		if (init?.agentId !== undefined) {
			spawn.setAgentId(init.agentId);
		}
		if (init?.subagentType !== undefined && spawn.subagentType === undefined) {
			spawn.subagentType = init.subagentType;
		}
		if (init?.description !== undefined && spawn.description === undefined) {
			spawn.description = init.description;
		}
		if (init?.prompt !== undefined && spawn.prompt === undefined) {
			spawn.prompt = init.prompt;
		}
		return spawn;
	}

	getSpawn(toolUseId: string): SubagentSpawn | undefined {
		return this._spawns.get(toolUseId);
	}

	removeSpawn(toolUseId: string): void {
		this._spawns.delete(toolUseId);
		this._evictInnerEdgesFor(toolUseId);
	}

	noteInnerTool(innerToolUseId: string, parentToolUseId: string): void {
		this._innerToParent.set(innerToolUseId, parentToolUseId);
	}

	getParentSpawn(innerToolUseId: string): SubagentSpawn | undefined {
		const parentId = this._innerToParent.get(innerToolUseId);
		return parentId !== undefined ? this._spawns.get(parentId) : undefined;
	}

	drainForegroundSpawns(): readonly SubagentSpawn[] {
		const drained: SubagentSpawn[] = [];
		for (const spawn of this._spawns.values()) {
			if (!spawn.background) {
				drained.push(spawn);
			}
		}
		for (const spawn of drained) {
			this._spawns.delete(spawn.toolUseId);
			this._evictInnerEdgesFor(spawn.toolUseId);
		}
		return drained;
	}

	primeFromTranscript(transcript: readonly Turn[]): void {
		for (const [toolCallId, agentId] of scanTranscriptForAgentIds(transcript)) {
			this.recordSpawn(toolCallId, { agentId });
		}
	}

	private _evictInnerEdgesFor(parentToolUseId: string): void {
		for (const [innerId, parentId] of this._innerToParent) {
			if (parentId === parentToolUseId) {
				this._innerToParent.delete(innerId);
			}
		}
	}
}

export function scanTranscriptForAgentIds(transcript: readonly Turn[]): ReadonlyMap<string, string> {
	const out = new Map<string, string>();
	for (const turn of transcript) {
		for (const part of turn.responseParts) {
			const pair = extractAgentIdPair(part);
			if (pair) {
				out.set(pair.toolCallId, pair.agentId);
			}
		}
	}
	return out;
}

function extractAgentIdPair(part: ResponsePart): { toolCallId: string; agentId: string } | undefined {
	if (part.kind !== ResponsePartKind.ToolCall) {
		return undefined;
	}
	const state = part.toolCall;
	if (!SUBAGENT_TOOL_NAMES.has(state.toolName)) {
		return undefined;
	}
	if (state.status !== ToolCallStatus.Completed && state.status !== ToolCallStatus.PendingResultConfirmation) {
		return undefined;
	}
	const content = state.content;
	if (!content) {
		return undefined;
	}
	for (let i = content.length - 1; i >= 0; i--) {
		const block = content[i];
		if (block.type !== ToolResultContentType.Text) {
			continue;
		}
		const m = SUBAGENT_ID_SUFFIX_REGEX.exec(block.text);
		if (m) {
			return { toolCallId: state.toolCallId, agentId: m[1] };
		}
	}
	return undefined;
}
