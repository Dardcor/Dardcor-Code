/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { resolveModelIdForTelemetry } from '../resolveModelId';

/**
 * Tests the resolveModelIdForTelemetry helper used by copy/insert/apply
 * telemetry events to substitute 'dardcor/auto' with the actual resolved model.
 *
 * Integration tests verifying that resolvedModel is propagated through
 * DefaultIntentRequestHandler into result metadata live in
 * defaultIntentRequestHandler.spec.ts.
 */
describe('resolveModelIdForTelemetry', () => {
	test('returns resolvedModel when modelId is dardcor/auto', () => {
		expect(resolveModelIdForTelemetry('dardcor/auto', 'gpt-4o')).toBe('gpt-4o');
	});

	test('falls back to dardcor/auto when resolvedModel is undefined', () => {
		expect(resolveModelIdForTelemetry('dardcor/auto', undefined)).toBe('dardcor/auto');
	});

	test('falls back to dardcor/auto when resolvedModel is empty string', () => {
		expect(resolveModelIdForTelemetry('dardcor/auto', '')).toBe('dardcor/auto');
	});

	test('returns original modelId when not dardcor/auto', () => {
		expect(resolveModelIdForTelemetry('gpt-4o', 'gpt-4o-2024-05-13')).toBe('gpt-4o');
	});

	test('returns original modelId when not dardcor/auto and no resolvedModel', () => {
		expect(resolveModelIdForTelemetry('claude-sonnet-4', undefined)).toBe('claude-sonnet-4');
	});

	test('does not substitute for empty modelId', () => {
		expect(resolveModelIdForTelemetry('', 'gpt-4o')).toBe('');
	});
});
