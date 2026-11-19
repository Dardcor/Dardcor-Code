/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { IDardcorRouterModel } from '../../../common/dardcorRouterModel.js';
import type * as http from 'http';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../log/common/log.js';
import {
	DardcorRouterApiError,
	type IDardcorRouterService,
	type IDardcorRouterRequestOptions,
} from '../../../node/shared/dardcorRouterService.js';
import { CodexProxyService, remapCodexReviewerModel } from '../../../node/codex/codexProxyService.js';
import { extractForwardedErrorInfo } from '../../../node/shared/proxyChatError.js';


interface IResponsesCall {
	body: string;
	options: IDardcorRouterRequestOptions | undefined;
}

class FakeDardcorRouterService implements IDardcorRouterService {
	declare readonly _serviceBrand: undefined;

	readonly responsesCalls: IResponsesCall[] = [];
	readonly modelsCalls: { options: IDardcorRouterRequestOptions | undefined }[] = [];
	responsesError: Error | undefined;
	readonly modelsResult = [
		{ id: 'gpt-5.5', name: 'GPT-5.5', supported_endpoints: ['/responses'] },
		{ id: 'claude-sonnet', name: 'Claude Sonnet', supported_endpoints: ['/v1/messages'] },
	] as unknown as IDardcorRouterModel[];

	messages(): never {
		throw new Error('messages not used by Codex proxy tests');
	}

	async countTokens(): Promise<never> {
		throw new Error('countTokens not used by Codex proxy tests');
	}

	async models(options?: IDardcorRouterRequestOptions): Promise<IDardcorRouterModel[]> {
		this.modelsCalls.push({ options });
		return this.modelsResult;
	}

	async responses(body: string, options?: IDardcorRouterRequestOptions): Promise<Response> {
		this.responsesCalls.push({ body, options });
		if (this.responsesError) {
			throw this.responsesError;
		}
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('event: response.completed\ndata: {}\n\n'));
				controller.close();
			},
		});
		return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
	}

	async utilityChatCompletion(): Promise<never> {
		throw new Error('utilityChatCompletion not used by Codex proxy tests');
	}
}



let _httpModule: typeof http | undefined;
async function getHttp(): Promise<typeof http> {
	if (!_httpModule) {
		_httpModule = await import('http');
	}
	return _httpModule;
}

function postResponses(url: string, init: { headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
	return getHttp().then(httpMod => new Promise((resolve, reject) => {
		const u = new URL(url);
		const req = httpMod.request({
			hostname: u.hostname,
			port: u.port,
			path: u.pathname + u.search,
			method: 'POST',
			headers: init.headers,
		}, res => {
			const chunks: Buffer[] = [];
			res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
			res.on('error', reject);
		});
		req.on('error', reject);
		if (init.body !== undefined) {
			req.write(init.body);
		}
		req.end();
	}));
}

function get(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
	return getHttp().then(httpMod => new Promise((resolve, reject) => {
		const u = new URL(url);
		const req = httpMod.request({
			hostname: u.hostname,
			port: u.port,
			path: u.pathname + u.search,
			method: 'GET',
			headers,
		}, res => {
			const chunks: Buffer[] = [];
			res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
			res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
			res.on('error', reject);
		});
		req.on('error', reject);
		req.end();
	}));
}


suite('CodexProxyService', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	async function withProxy(fn: (handle: { baseUrl: string; nonce: string }, fake: FakeDardcorRouterService) => Promise<void>): Promise<void> {
		const fake = new FakeDardcorRouterService();
		const service = new CodexProxyService(new NullLogService(), fake);
		const handle = await service.start();
		try {
			await fn(handle, fake);
		} finally {
			handle.dispose();
			service.dispose();
		}
	}

	test('forwards transformed user-agent to Dardcor Router responses', async () => {
		await withProxy(async (handle, fake) => {
			await postResponses(`${handle.baseUrl}/v1/responses`, {
				headers: { 'Authorization': `Bearer ${handle.nonce}`, 'User-Agent': 'codex/1.2.3' },
				body: JSON.stringify({ model: 'gpt-5', stream: true, input: [] }),
			});
			assert.strictEqual(fake.responsesCalls.at(-1)?.options?.headers?.['User-Agent'], 'vscode_codex/1.2.3');
		});
	});

	test('preserves endpoint discovery authentication failures', async () => {
		await withProxy(async (handle, fake) => {
			fake.responsesError = new DardcorRouterApiError(401, {
				type: 'error',
				error: { type: 'api_error', message: '{"message":"Bad credentials"}' },
				request_id: null,
			}, 'Dardcor Router endpoint failed: 401 Unauthorized — {"message":"Bad credentials"}');

			const response = await postResponses(`${handle.baseUrl}/v1/responses`, {
				headers: { 'Authorization': `Bearer ${handle.nonce}` },
				body: JSON.stringify({ model: 'gpt-5', stream: true, input: [] }),
			});
			const error = JSON.parse(response.body).error as { type: string; message: string };

			assert.deepStrictEqual({
				status: response.status,
				type: error.type,
				error: extractForwardedErrorInfo(error.message),
			}, {
				status: 401,
				type: 'api_error',
				error: {
					message: 'Dardcor Router endpoint failed: 401 Unauthorized — {"message":"Bad credentials"}',
					_meta: {
						chatError: {
							fetchError: {
								type: 'agent_unauthorized',
								reason: '{"message":"Bad credentials"}',
								requestId: '',
								capiError: {
									code: 'api_error',
									message: '{"message":"Bad credentials"}',
								},
							},
						},
					},
				},
			});
		});
	});

	test('serves an empty Codex model catalog', async () => {
		await withProxy(async (handle, fake) => {
			const response = await get(`${handle.baseUrl}/v1/models?client_version=0.146.0`, {
				'Authorization': `Bearer ${handle.nonce}`,
				'User-Agent': 'codex/0.146.0',
			});
			assert.strictEqual(response.status, 200);
			assert.deepStrictEqual(JSON.parse(response.body), { models: [] });
			assert.deepStrictEqual(fake.modelsCalls, []);
		});
	});

	test('keeps the suffix when transforming a multi-segment user-agent', async () => {
		await withProxy(async (handle, fake) => {
			await postResponses(`${handle.baseUrl}/v1/responses`, {
				headers: { 'Authorization': `Bearer ${handle.nonce}`, 'User-Agent': 'OpenAI/Python/1.0' },
				body: JSON.stringify({ model: 'gpt-5', stream: true, input: [] }),
			});
			assert.strictEqual(fake.responsesCalls.at(-1)?.options?.headers?.['User-Agent'], 'vscode_codex/Python/1.0');
		});
	});

	test('omits User-Agent when the inbound request has none', async () => {
		await withProxy(async (handle, fake) => {
			await postResponses(`${handle.baseUrl}/v1/responses`, {
				headers: { 'Authorization': `Bearer ${handle.nonce}` },
				body: JSON.stringify({ model: 'gpt-5', stream: true, input: [] }),
			});
			assert.strictEqual(fake.responsesCalls.at(-1)?.options?.headers?.['User-Agent'], undefined);
		});
	});

	test('remaps the unsupported auto-review reviewer model onto the last primary model', async () => {
		await withProxy(async (handle, fake) => {
			const headers = { 'Authorization': `Bearer ${handle.nonce}`, 'User-Agent': 'codex/1.0' };
			await postResponses(`${handle.baseUrl}/v1/responses`, {
				headers,
				body: JSON.stringify({ model: 'gpt-5.5', stream: true, input: [] }),
			});
			await postResponses(`${handle.baseUrl}/v1/responses`, {
				headers,
				body: JSON.stringify({ model: 'codex-auto-review', stream: true, input: [] }),
			});
			assert.deepStrictEqual(fake.responsesCalls.map(call => JSON.parse(call.body).model), ['gpt-5.5', 'gpt-5.5']);
		});
	});

	test('forwards the auto-review reviewer model unchanged when no primary model has been seen', async () => {
		await withProxy(async (handle, fake) => {
			await postResponses(`${handle.baseUrl}/v1/responses`, {
				headers: { 'Authorization': `Bearer ${handle.nonce}`, 'User-Agent': 'codex/1.0' },
				body: JSON.stringify({ model: 'codex-auto-review', stream: true, input: [] }),
			});
			assert.strictEqual(JSON.parse(fake.responsesCalls.at(-1)!.body).model, 'codex-auto-review');
		});
	});

	test('remaps the reviewer model onto the most recent primary model', async () => {
		await withProxy(async (handle, fake) => {
			const headers = { 'Authorization': `Bearer ${handle.nonce}`, 'User-Agent': 'codex/1.0' };
			await postResponses(`${handle.baseUrl}/v1/responses`, { headers, body: JSON.stringify({ model: 'gpt-5.5', input: [] }) });
			await postResponses(`${handle.baseUrl}/v1/responses`, { headers, body: JSON.stringify({ model: 'gpt-5-codex', input: [] }) });
			await postResponses(`${handle.baseUrl}/v1/responses`, { headers, body: JSON.stringify({ model: 'codex-auto-review', input: [] }) });
			assert.strictEqual(JSON.parse(fake.responsesCalls.at(-1)!.body).model, 'gpt-5-codex');
		});
	});

	suite('remapCodexReviewerModel', () => {
		test('records the primary model and leaves the body untouched', () => {
			const state = { lastPrimaryModel: undefined as string | undefined };
			const result = remapCodexReviewerModel(JSON.stringify({ model: 'gpt-5.5', input: [] }), state);
			assert.deepStrictEqual({ remappedFrom: result.remappedFrom, lastPrimaryModel: state.lastPrimaryModel, model: JSON.parse(result.body).model }, { remappedFrom: undefined, lastPrimaryModel: 'gpt-5.5', model: 'gpt-5.5' });
		});

		test('remaps the reviewer model and reports the substitution', () => {
			const state = { lastPrimaryModel: 'gpt-5.5' as string | undefined };
			const result = remapCodexReviewerModel(JSON.stringify({ model: 'codex-auto-review', input: [] }), state);
			assert.deepStrictEqual({ remappedFrom: result.remappedFrom, remappedTo: result.remappedTo, model: JSON.parse(result.body).model }, { remappedFrom: 'codex-auto-review', remappedTo: 'gpt-5.5', model: 'gpt-5.5' });
		});

		test('returns the original body for unparseable or model-less payloads', () => {
			const state = { lastPrimaryModel: 'gpt-5.5' as string | undefined };
			assert.deepStrictEqual({
				unparseable: remapCodexReviewerModel('not json', state).body,
				modelless: remapCodexReviewerModel(JSON.stringify({ input: [] }), state).body,
			}, {
				unparseable: 'not json',
				modelless: JSON.stringify({ input: [] }),
			});
		});
	});
});
