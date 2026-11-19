/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DardcorAgentToolRuntime, formatAgentToolError, validateAgentToolArguments } from '../../common/agentToolRuntime.js';

suite('AgentToolRuntime', () => {
	test('validates nested objects, arrays, enums, and additional properties', () => {
		const schema = {
			type: 'object',
			properties: {
				request: {
					type: 'object',
					properties: {
						mode: { type: 'string', enum: ['safe', 'write'] },
						paths: { type: 'array', items: { type: 'string', minLength: 1 } },
					},
					required: ['mode', 'paths'],
					additionalProperties: false,
				},
			},
			required: ['request'],
			additionalProperties: false,
		};
		assert.deepStrictEqual(validateAgentToolArguments(schema, { request: { mode: 'safe', paths: ['src'] } }), []);
		assert.match(validateAgentToolArguments(schema, { request: { mode: 'unsafe', paths: [''] }, unexpected: true }).join('; '), /not an allowed property|allowed values|at least 1 character/);
		assert.match(validateAgentToolArguments(schema, { request: { mode: 'safe', paths: [3] } }).join('; '), /request\.paths\[0\].*must be string/);
	});

	test('dispatches a validated alias through one local driver exactly once', async () => {
		const runtime = new DardcorAgentToolRuntime();
		let calls = 0;
		runtime.register({
			name: 'read_asset',
			aliases: ['read_file_legacy'],
			inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
			source: 'builtin',
			risk: 'read',
			driver: 'workspaceFileService',
		}, async args => {
			calls++;
			return { output: `Read ${args.path}`, evidence: ['file snapshot'] };
		});

		const request = { version: 1 as const, callId: 'call-1', toolName: 'read_file_legacy', arguments: { path: 'README.md' } };
		const result = await runtime.execute(request);
		const duplicate = await runtime.execute(request);
		assert.strictEqual(calls, 1);
		assert.strictEqual(result.toolName, 'read_asset');
		assert.strictEqual(result.status, 'succeeded');
		assert.deepStrictEqual(result.evidence, ['file snapshot']);
		assert.strictEqual(duplicate.status, 'rejected');
		assert.match(duplicate.output, /Duplicate tool call ID/);
	});

	test('rejects malformed and unknown calls without invoking a driver', async () => {
		const runtime = new DardcorAgentToolRuntime();
		let calls = 0;
		runtime.register({ name: 'write_asset', inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }, source: 'router', risk: 'write', driver: 'workspaceFileService' }, async () => {
			calls++;
			return 'written';
		});

		const malformed = await runtime.execute({ version: 1, callId: 'call-2', toolName: 'write_asset', arguments: '{"content":' });
		const missing = await runtime.execute({ version: 1, callId: 'call-3', toolName: 'write_asset', arguments: {} });
		const unknown = await runtime.execute({ version: 1, callId: 'call-4', toolName: 'unknown_asset', arguments: {} });
		const nonObject = await runtime.execute({ version: 1, callId: 'call-8', toolName: 'write_asset', arguments: [] });
		const unsupportedVersion = await runtime.execute({ version: 2, callId: 'call-9', toolName: 'write_asset', arguments: { content: 'ignored' } } as never);
		assert.strictEqual(malformed.status, 'rejected');
		assert.strictEqual(missing.status, 'rejected');
		assert.strictEqual(unknown.status, 'rejected');
		assert.strictEqual(nonObject.status, 'rejected');
		assert.strictEqual(unsupportedVersion.status, 'rejected');
		assert.strictEqual(calls, 0);
	});

	test('rejects duplicate aliases before adding a catalog entry', () => {
		const runtime = new DardcorAgentToolRuntime();
		assert.throws(() => runtime.register({
			name: 'read_asset',
			aliases: ['legacy_read', 'legacy_read'],
			inputSchema: { type: 'object' },
			source: 'builtin',
			risk: 'read',
			driver: 'workspaceFileService',
		}, () => 'read'), /Duplicate or empty agent tool alias/);
		assert.strictEqual(runtime.catalog.list().length, 0);
	});

	test('keeps a command without a final exit status inconclusive', async () => {
		const runtime = new DardcorAgentToolRuntime();
		let output = 'Task "build" is still running.';
		let exitCode: number | undefined;
		runtime.register({ name: 'run_task', inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] }, source: 'router', risk: 'command', driver: 'taskService' }, async () => ({ output, exitCode }));
		const result = await runtime.execute({ version: 1, callId: 'call-5', toolName: 'run_task', arguments: { label: 'build' } });
		assert.strictEqual(result.status, 'unknown');
		assert.strictEqual(result.retrySafe, false);

		output = '[Command result: exit code 0] Build completed with a non-blocking warning.';
		exitCode = 0;
		const warningWithSuccess = await runtime.execute({ version: 1, callId: 'call-6', toolName: 'run_task', arguments: { label: 'build' } });
		assert.strictEqual(warningWithSuccess.status, 'succeeded');

		exitCode = 1;
		const failed = await runtime.execute({ version: 1, callId: 'call-7', toolName: 'run_task', arguments: { label: 'build' } });
		assert.strictEqual(failed.status, 'failed');
	});

	test('preserves structured driver errors instead of reducing them to object strings', async () => {
		const runtime = new DardcorAgentToolRuntime();
		runtime.register({ name: 'inspect_page', inputSchema: { type: 'object' }, source: 'router', risk: 'browser', driver: 'browserEditor' }, async () => {
			throw { code: 'PAGE_DETACHED', message: 'The browser page detached before inspection.', cause: { reason: 'Target closed' } };
		});

		const result = await runtime.execute({ version: 1, callId: 'call-10', toolName: 'inspect_page', arguments: {} });
		assert.strictEqual(result.status, 'failed');
		assert.match(result.output, /PAGE_DETACHED/);
		assert.match(result.output, /page detached before inspection/);
		assert.match(result.output, /Target closed/);
		assert.doesNotMatch(result.output, /\[object Object\]/);

		const cyclic: Record<string, unknown> = { message: 'Circular browser error' };
		cyclic.cause = cyclic;
		const formatted = formatAgentToolError(cyclic);
		assert.match(formatted, /Circular browser error/);
		assert.match(formatted, /circular error detail/);
		assert.doesNotMatch(formatted, /\[object Object\]/);
	});
});
