/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { ChatQuotaService } from '../../common/chatQuotaServiceImpl';

describe('ChatQuotaService', () => {
	function create() {
		return new ChatQuotaService();
	}

	const TURN_A = 'turn-a';
	const TURN_B = 'turn-b';

	describe('setLastDardcorUsage', () => {
		test('converts nano-AIUs to AIC credits', () => {
			const svc = create();
			svc.setLastDardcorUsage(1_000_000_000, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBe(1);
		});

		test('handles fractional AIC values', () => {
			const svc = create();
			svc.setLastDardcorUsage(500_000_000, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBe(0.5);
		});

		test('accumulates across multiple calls', () => {
			const svc = create();
			svc.setLastDardcorUsage(300_000_000, TURN_A);
			svc.setLastDardcorUsage(200_000_000, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBeCloseTo(0.5);
		});

		test('accumulates many small calls correctly', () => {
			const svc = create();
			for (let i = 0; i < 5; i++) {
				svc.setLastDardcorUsage(16_470_000, TURN_A);
			}
			svc.setLastDardcorUsage(24_782_500_000, TURN_A);
			svc.setLastDardcorUsage(25_580_500_000, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBeCloseTo(50.45);
		});

		test('records zero nano-AIU values as zero credits', () => {
			const svc = create();
			svc.setLastDardcorUsage(0, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBe(0);
		});

		test('ignores negative nano-AIU values', () => {
			const svc = create();
			svc.setLastDardcorUsage(-100, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBeUndefined();
		});

		test('does not accumulate zero after valid value', () => {
			const svc = create();
			svc.setLastDardcorUsage(1_000_000_000, TURN_A);
			svc.setLastDardcorUsage(0, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBe(1);
		});
	});

	describe('resetTurnCredits', () => {
		test('resets accumulated credits to undefined', () => {
			const svc = create();
			svc.setLastDardcorUsage(1_000_000_000, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBe(1);
			svc.resetTurnCredits(TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBeUndefined();
		});

		test('allows fresh accumulation after reset', () => {
			const svc = create();
			svc.setLastDardcorUsage(1_000_000_000, TURN_A);
			svc.resetTurnCredits(TURN_A);
			svc.setLastDardcorUsage(500_000_000, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBe(0.5);
		});

		test('is idempotent when already undefined', () => {
			const svc = create();
			svc.resetTurnCredits(TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBeUndefined();
		});
	});

	describe('concurrent turn isolation', () => {
		test('credits for different turns are independent', () => {
			const svc = create();
			svc.setLastDardcorUsage(1_000_000_000, TURN_A);
			svc.setLastDardcorUsage(2_000_000_000, TURN_B);
			expect(svc.getCreditsForTurn(TURN_A)).toBe(1);
			expect(svc.getCreditsForTurn(TURN_B)).toBe(2);
		});

		test('resetting one turn does not affect another', () => {
			const svc = create();
			svc.setLastDardcorUsage(1_000_000_000, TURN_A);
			svc.setLastDardcorUsage(2_000_000_000, TURN_B);
			svc.resetTurnCredits(TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBeUndefined();
			expect(svc.getCreditsForTurn(TURN_B)).toBe(2);
		});

		test('subagent credits accumulate into the parent turn', () => {
			const svc = create();
			svc.setLastDardcorUsage(1_000_000_000, TURN_A);
			svc.setLastDardcorUsage(500_000_000, TURN_A);
			expect(svc.getCreditsForTurn(TURN_A)).toBe(1.5);
		});
	});

	describe('realistic turn lifecycle simulation', () => {
		async function simulateApiCall(
			svc: ChatQuotaService,
			turnId: string,
			nanoAiu: number,
			delayMs: number = 0
		): Promise<void> {
			if (delayMs > 0) {
				await new Promise(resolve => setTimeout(resolve, delayMs));
			}
			svc.setLastDardcorUsage(nanoAiu, turnId);
		}

		async function simulateTurn(
			svc: ChatQuotaService,
			turnId: string,
			calls: { nanoAiu: number; delayMs: number }[]
		): Promise<number | undefined> {
			svc.resetTurnCredits(turnId);
			for (const call of calls) {
				await simulateApiCall(svc, turnId, call.nanoAiu, call.delayMs);
			}
			return svc.getCreditsForTurn(turnId);
		}

		test('simple single-turn with tool loop (3 iterations)', async () => {
			const svc = create();
			const result = await simulateTurn(svc, 'turn-1', [
				{ nanoAiu: 500_000_000, delayMs: 0 },
				{ nanoAiu: 300_000_000, delayMs: 0 },
				{ nanoAiu: 200_000_000, delayMs: 0 },
			]);
			expect(result).toBe(1.0);
		});

		test('agentic turn with subagents and helper calls', async () => {
			const svc = create();
			const turnId = 'turn-agentic';
			svc.resetTurnCredits(turnId);

			svc.setLastDardcorUsage(8_640_000, turnId);
			svc.setLastDardcorUsage(56_160_000, turnId);
			svc.setLastDardcorUsage(16_470_000, turnId);
			svc.setLastDardcorUsage(16_350_000, turnId);
			svc.setLastDardcorUsage(24_782_500_000, turnId);
			svc.setLastDardcorUsage(25_580_500_000, turnId);
			svc.setLastDardcorUsage(61_741_750_000, turnId);
			svc.setLastDardcorUsage(63_180_000, turnId);

			const result = svc.getCreditsForTurn(turnId);
			expect(result).toBeCloseTo(112.27, 1);
		});

		test('two parallel turns in different chat windows — fully isolated', async () => {
			const svc = create();

			const [resultA, resultB] = await Promise.all([
				simulateTurn(svc, 'window-1-turn', [
					{ nanoAiu: 56_160_000, delayMs: 0 },
					{ nanoAiu: 24_782_500_000, delayMs: 10 },
					{ nanoAiu: 25_580_500_000, delayMs: 10 },
				]),
				simulateTurn(svc, 'window-2-turn', [
					{ nanoAiu: 56_160_000, delayMs: 0 },
					{ nanoAiu: 8_640_000, delayMs: 5 },
				]),
			]);

			expect(resultA).toBeCloseTo(50.42, 1);
			expect(resultB).toBeCloseTo(0.06, 1);
		});

		test('interleaved API responses from parallel turns', async () => {
			const svc = create();
			const turnX = 'panel-turn-x';
			const turnY = 'panel-turn-y';

			svc.resetTurnCredits(turnX);
			svc.resetTurnCredits(turnY);

			svc.setLastDardcorUsage(1_000_000_000, turnX);
			svc.setLastDardcorUsage(2_000_000_000, turnY);
			svc.setLastDardcorUsage(3_000_000_000, turnX);
			svc.setLastDardcorUsage(4_000_000_000, turnY);
			svc.setLastDardcorUsage(500_000_000, turnX);

			expect(svc.getCreditsForTurn(turnX)).toBe(4.5);
			expect(svc.getCreditsForTurn(turnY)).toBe(6);
		});

		test('turn reset during a concurrent turn does not affect the other', async () => {
			const svc = create();
			const turnA = 'turn-a-multi';
			const turnB = 'turn-b-multi';

			svc.setLastDardcorUsage(5_000_000_000, turnA);
			svc.setLastDardcorUsage(3_000_000_000, turnB);

			svc.resetTurnCredits(turnA);

			svc.setLastDardcorUsage(2_000_000_000, turnB);

			svc.setLastDardcorUsage(1_000_000_000, turnA);

			expect(svc.getCreditsForTurn(turnA)).toBe(1);
			expect(svc.getCreditsForTurn(turnB)).toBe(5);
		});

		test('many concurrent turns (stress test)', () => {
			const svc = create();
			const turnCount = 20;
			const callsPerTurn = 10;

			for (let t = 0; t < turnCount; t++) {
				const turnId = `stress-turn-${t}`;
				svc.resetTurnCredits(turnId);
				for (let c = 0; c < callsPerTurn; c++) {
					svc.setLastDardcorUsage(100_000_000, turnId);
				}
			}

			for (let t = 0; t < turnCount; t++) {
				const turnId = `stress-turn-${t}`;
				expect(svc.getCreditsForTurn(turnId)).toBeCloseTo(1.0);
			}
		});

		test('completed turns are cleaned up on reset', () => {
			const svc = create();
			svc.setLastDardcorUsage(1_000_000_000, 'old-turn');
			expect(svc.getCreditsForTurn('old-turn')).toBe(1);

			svc.resetTurnCredits('old-turn');
			expect(svc.getCreditsForTurn('old-turn')).toBeUndefined();
		});

		test('querying a non-existent turn returns undefined', () => {
			const svc = create();
			expect(svc.getCreditsForTurn('never-existed')).toBeUndefined();
		});
	});

	describe('runSubagent dual-key aggregation', () => {

		function getTotalCredits(svc: ChatQuotaService, requestId: string, turnId: string): number | undefined {
			const ownCredits = svc.getCreditsForTurn(requestId);
			const subagentCredits = svc.getCreditsForTurn(turnId);
			return ownCredits !== undefined || subagentCredits !== undefined
				? (ownCredits ?? 0) + (subagentCredits ?? 0)
				: undefined;
		}

		test('parent-only turn (no subagents) uses request.id key', () => {
			const svc = create();
			const requestId = 'request_abc-123';
			const turnId = 'turn-xyz-456';

			svc.resetTurnCredits(requestId);
			svc.resetTurnCredits(turnId);

			svc.setLastDardcorUsage(24_000_000_000, requestId);
			svc.setLastDardcorUsage(2_000_000_000, requestId);

			expect(getTotalCredits(svc, requestId, turnId)).toBe(26);
		});

		test('subagent credits accumulate under parent turn.id', () => {
			const svc = create();
			const parentRequestId = 'request_parent-111';
			const parentTurnId = 'turn-parent-222';

			svc.resetTurnCredits(parentRequestId);
			svc.resetTurnCredits(parentTurnId);

			svc.setLastDardcorUsage(24_000_000_000, parentRequestId);

			svc.setLastDardcorUsage(33_000_000_000, parentTurnId);
			svc.setLastDardcorUsage(33_000_000_000, parentTurnId);

			expect(getTotalCredits(svc, parentRequestId, parentTurnId)).toBe(90);
		});

		test('two subagent turns do not interfere', () => {
			const svc = create();
			const reqA = 'request_a';
			const turnA = 'turn-a';
			const reqB = 'request_b';
			const turnB = 'turn-b';

			svc.resetTurnCredits(reqA);
			svc.resetTurnCredits(turnA);
			svc.resetTurnCredits(reqB);
			svc.resetTurnCredits(turnB);

			svc.setLastDardcorUsage(24_000_000_000, reqA);
			svc.setLastDardcorUsage(33_000_000_000, turnA);
			svc.setLastDardcorUsage(33_000_000_000, turnA);

			svc.setLastDardcorUsage(25_000_000_000, reqB);
			for (let i = 0; i < 5; i++) {
				svc.setLastDardcorUsage(33_000_000_000, turnB);
			}

			expect(getTotalCredits(svc, reqA, turnA)).toBe(90);
			expect(getTotalCredits(svc, reqB, turnB)).toBe(190);
		});

		test('subagent handler does not corrupt parent credits', () => {
			const svc = create();
			const parentReqId = 'request_parent';
			const parentTurnId = 'turn-parent';
			const subagentReqId = 'subagent-call-id';
			const subagentTurnId = 'turn-subagent';

			svc.resetTurnCredits(parentReqId);
			svc.resetTurnCredits(parentTurnId);
			svc.setLastDardcorUsage(24_000_000_000, parentReqId);

			svc.resetTurnCredits(subagentReqId);
			svc.resetTurnCredits(subagentTurnId);

			svc.setLastDardcorUsage(33_000_000_000, parentTurnId);

			expect(svc.getCreditsForTurn(subagentReqId)).toBeUndefined();

			expect(getTotalCredits(svc, parentReqId, parentTurnId)).toBe(57);
		});

		test('overhead calls (title, categorization) are separate from turn credits', () => {
			const svc = create();
			const parentReqId = 'request_main';
			const parentTurnId = 'turn-main';
			const titleTurnId = 'title-turn';
			const categorizationTurnId = 'categorization-turn';

			svc.resetTurnCredits(parentReqId);
			svc.resetTurnCredits(parentTurnId);

			svc.setLastDardcorUsage(8_000_000, titleTurnId);
			svc.setLastDardcorUsage(56_000_000, categorizationTurnId);

			svc.setLastDardcorUsage(24_000_000_000, parentReqId);

			svc.setLastDardcorUsage(33_000_000_000, parentTurnId);

			expect(getTotalCredits(svc, parentReqId, parentTurnId)).toBe(57);
		});
	});

});
