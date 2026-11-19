/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';

interface ToolCallRecord {
	toolName: string;
	inputHash: string;
	timestamp: number;
}

export class DoomLoopDetector {
	private static instance: DoomLoopDetector | undefined;
	private history: ToolCallRecord[] = [];
	private maxConsecutiveIdentical = 3;

	public static getInstance(): DoomLoopDetector {
		if (!DoomLoopDetector.instance) {
			DoomLoopDetector.instance = new DoomLoopDetector();
		}
		return DoomLoopDetector.instance;
	}

	public recordAndCheck(toolName: string, input: any): { isDoomLoop: boolean; message?: string } {
		const serialized = typeof input === 'string' ? input : JSON.stringify(input || {});
		const inputHash = crypto.createHash('sha256').update(serialized).digest('hex').substring(0, 16);
		const record: ToolCallRecord = {
			toolName,
			inputHash,
			timestamp: Date.now(),
		};

		this.history.push(record);
		if (this.history.length > 20) {
			this.history.shift();
		}

		if (this.history.length >= this.maxConsecutiveIdentical) {
			const recent = this.history.slice(-this.maxConsecutiveIdentical);
			const allIdentical = recent.every(
				(r) => r.toolName === toolName && r.inputHash === inputHash
			);

			if (allIdentical) {
				return {
					isDoomLoop: true,
					message: `Doom loop detected: The tool '${toolName}' was invoked with identical arguments ${this.maxConsecutiveIdentical} times consecutively without making progress. Execution halted to protect workspace and conserve token budget.`,
				};
			}
		}

		return { isDoomLoop: false };
	}

	public reset(): void {
		this.history = [];
	}
}
