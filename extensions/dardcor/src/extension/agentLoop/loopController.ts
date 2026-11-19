/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../util/dardcor/base/common/lifecycle';
import { ContextCompactor } from './contextCompactor';
import { SnapshotTracker } from './snapshotTracker';
import { TodoManager } from './todoManager';

export interface ToolCallSignature {
	readonly toolName: string;
	readonly argumentsJson: string;
}

export interface LoopControllerOptions {
	readonly maxSteps?: number;
	readonly doomLoopThreshold?: number;
}

export const DOOM_LOOP_THRESHOLD = 3;
export const DEFAULT_MAX_STEPS = 50;

export const MAX_STEPS_PROMPT =
	'You have reached the maximum step limit for this interaction. Do not invoke further tools. Summarize your progress, what was completed, and what remains to be done.';

export const DOOM_LOOP_WARNING =
	'Repetitive tool invocation detected. You have called this tool with identical arguments multiple times without progressing. Please inspect previous outputs, alter your approach, or summarize your findings.';

export class AutonomousLoopController extends Disposable {
	public readonly maxSteps: number;
	public readonly doomLoopThreshold: number;
	public readonly snapshotTracker = new SnapshotTracker();
	public readonly todoManager = this._register(new TodoManager());

	private _step = 0;
	private readonly _recentToolCalls: ToolCallSignature[] = [];

	constructor(options?: LoopControllerOptions) {
		super();
		this.maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;
		this.doomLoopThreshold = options?.doomLoopThreshold ?? DOOM_LOOP_THRESHOLD;
	}

	get currentStep(): number {
		return this._step;
	}

	incrementStep(): number {
		this._step++;
		return this._step;
	}

	isMaxStepsReached(): boolean {
		return this._step >= this.maxSteps;
	}

	recordToolCall(toolName: string, args: unknown): boolean {
		let argsJson = '';
		try {
			argsJson = typeof args === 'string' ? args : JSON.stringify(args ?? {});
		} catch {
			argsJson = String(args);
		}

		this._recentToolCalls.push({ toolName, argumentsJson: argsJson });
		if (this._recentToolCalls.length > this.doomLoopThreshold * 2) {
			this._recentToolCalls.shift();
		}

		return this.checkDoomLoop(toolName, argsJson);
	}

	checkDoomLoop(toolName: string, argsJson: string): boolean {
		if (this._recentToolCalls.length < this.doomLoopThreshold) {
			return false;
		}

		const recent = this._recentToolCalls.slice(-this.doomLoopThreshold);
		return recent.every(call => call.toolName === toolName && call.argumentsJson === argsJson);
	}

	truncateOutput(content: string, maxChars?: number, maxLines?: number): string {
		return ContextCompactor.truncateToolOutput(content, maxChars, maxLines).text;
	}

	reset(): void {
		this._step = 0;
		this._recentToolCalls.length = 0;
		this.snapshotTracker.clear();
		this.todoManager.clear();
	}
}
