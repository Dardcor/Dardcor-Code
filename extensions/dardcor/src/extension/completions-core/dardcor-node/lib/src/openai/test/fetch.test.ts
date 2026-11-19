/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Completions, ICompletionsFetchService } from '../../../../../../../platform/nesFetch/common/completionsFetchService';
import { ResponseStream } from '../../../../../../../platform/nesFetch/common/responseStream';
import { HeadersImpl } from '../../../../../../../platform/networking/common/fetcherService';
import { TestingServiceCollection } from '../../../../../../../platform/test/node/services';
import { Result } from '../../../../../../../util/common/result';
import { CancellationToken } from '../../../../../../../util/dardcor/base/common/cancellation';
import { generateUuid } from '../../../../../../../util/dardcor/base/common/uuid';
import { SyncDescriptor } from '../../../../../../../util/dardcor/platform/instantiation/common/descriptors';
import { IInstantiationService, ServicesAccessor } from '../../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { CancellationTokenSource } from '../../../../types/src';
import { ICompletionsStatusReporter, StatusChangedEvent, StatusReporter } from '../../progress';
import { TelemetryWithExp } from '../../telemetry';
import { createLibTestingContext } from '../../test/context';
import { withInMemoryTelemetry } from '../../test/telemetry';
import {
	CompletionParams,
	DardcorInlineUiKind,
	ICompletionsOpenAIFetcherService,
	LiveOpenAIFetcher, sanitizeRequestOptionTelemetry
} from '../fetch';
import { SyntheticCompletions } from '../fetch.fake';

suite('"Fetch" unit tests', function () {
	let accessor: ServicesAccessor;
	let serviceCollection: TestingServiceCollection;
	let mockFetchService: MockCompletionsFetchService;

	setup(function () {
		serviceCollection = createLibTestingContext();
		mockFetchService = new MockCompletionsFetchService();
		serviceCollection.define(ICompletionsFetchService, mockFetchService);
		serviceCollection.define(ICompletionsOpenAIFetcherService, new SyncDescriptor(LiveOpenAIFetcher));
		accessor = serviceCollection.createTestingAccessor();
	});

	test('Empty/whitespace completions are stripped', async function () {
		const fetcher = new SyntheticCompletions(['', ' ', '\n']);
		const params: CompletionParams = {
			prompt: {
				prefix: '',
				suffix: '',
				isFimEnabled: false,
			},
			languageId: '',
			repoInfo: undefined,
			engineModelId: '',
			count: 1,
			uiKind: DardcorInlineUiKind.GhostText,
			ourRequestId: generateUuid(),
			extra: {},
		};
		const cancellationToken = new CancellationTokenSource().token;
		const res = await fetcher.fetchAndStreamCompletions(
			params,
			TelemetryWithExp.createEmptyConfigForTesting(),
			() => undefined,
			cancellationToken
		);
		assert.deepStrictEqual(res.type, 'success');
		if (res.type !== 'success') {
			throw new Error(`internal error: res.type is not 'success'`);
		}
		const stream = res.choices;
		const results = [];
		for await (const result of stream) {
			results.push(result);
		}
		assert.strictEqual(results.length, 0);
	});

	test('If in the split context experiment, send the context field as part of the request', async function () {
		const recordingFetchService = new MockCompletionsFetchService();
		const params: CompletionParams = {
			prompt: {
				context: ['# Language: Python'],
				prefix: 'prefix without context',
				suffix: '\ndef sum(a, b):\n    return a + b',
				isFimEnabled: true,
			},
			languageId: 'python',
			repoInfo: undefined,
			engineModelId: 'dardcor-codex',
			count: 1,
			uiKind: DardcorInlineUiKind.GhostText,
			postOptions: {},
			ourRequestId: generateUuid(),
			extra: {},
		};

		const serviceCollectionClone = serviceCollection.clone();
		serviceCollectionClone.define(ICompletionsFetchService, recordingFetchService);
		const accessor = serviceCollectionClone.createTestingAccessor();

		const telemetryWithExp = TelemetryWithExp.createEmptyConfigForTesting();
		telemetryWithExp.filtersAndExp.exp.variables.dardcorenablepromptcontextproxyfield = true;

		const openAIFetcher = accessor.get(IInstantiationService).createInstance(LiveOpenAIFetcher);
		await openAIFetcher.fetchAndStreamCompletions(params, telemetryWithExp, () => undefined);

		const lastParams = recordingFetchService.lastParams;
		assert.strictEqual(lastParams?.prompt, params.prompt.prefix);
		assert.deepStrictEqual(lastParams?.extra?.context, params.prompt.context);
	});

	test('reports HTTP 466 as a Router client error', async function () {
		const statusReporter = new TestStatusReporter();
		const result = await assertResponseWithStatus(466, statusReporter);

		assert.deepStrictEqual(result, { type: 'failed', reason: 'unhandled status from server: 466 response-text' });
		assert.deepStrictEqual(statusReporter.kind, 'Warning');
		assert.deepStrictEqual(statusReporter.message, 'Dardcor Router returned an HTTP 466 error: response-text');
		assert.deepStrictEqual(statusReporter.eventCount, 1);
	});

	test('has fallback for unknown http response codes from proxy', async function () {
		const statusReporter = new TestStatusReporter();
		const result = await assertResponseWithStatus(518, statusReporter);

		assert.deepStrictEqual(result, { type: 'failed', reason: 'unhandled status from server: 518 response-text' });
		assert.deepStrictEqual(statusReporter.kind, 'Warning');
		assert.deepStrictEqual(statusReporter.message, 'Last response was a 518 error');
	});

	test('reports Router client errors without GitHub-specific diagnostics', async function () {
		const statusReporter = new TestStatusReporter();
		const result = await assertResponseWithStatus(418, statusReporter);

		assert.deepStrictEqual(result, { type: 'failed', reason: 'unhandled status from server: 418 response-text' });
		assert.deepStrictEqual(statusReporter.kind, 'Warning');
		assert.deepStrictEqual(statusReporter.message, 'Dardcor Router returned an HTTP 418 error: response-text');
	});

	test('HTTP `Unauthorized` reports a Router API key error without refreshing credentials', async function () {
		const result = await assertResponseWithContext(accessor, 401);

		assert.deepStrictEqual(result, { type: 'failed', reason: 'Dardcor Router rejected the configured API key (HTTP 401).' });
	});

	test('HTTP `Forbidden` reports a Router API key error without refreshing credentials', async function () {
		const result = await assertResponseWithContext(accessor, 403);

		assert.deepStrictEqual(result, { type: 'failed', reason: 'Dardcor Router rejected the configured API key (HTTP 403).' });
	});

	test('HTTP `Too many requests` enforces rate limiting locally', async function () {
		const mockFetch = new MockCompletionsFetchService();
		const serviceCollection = createLibTestingContext();
		serviceCollection.define(ICompletionsFetchService, mockFetch);
		serviceCollection.define(ICompletionsOpenAIFetcherService, new SyncDescriptor(LiveOpenAIFetcher));
		const accessor = serviceCollection.createTestingAccessor();
		const result = await assertResponseWithContext(accessor, 429);
		const fetcherService = accessor.get(ICompletionsOpenAIFetcherService);

		assert.deepStrictEqual(result, { type: 'failed', reason: 'rate limited' });
		const limited = await fetcherService.fetchAndStreamCompletions(
			{} as CompletionParams,
			TelemetryWithExp.createEmptyConfigForTesting(),
			() => Promise.reject(new Error()),
			new CancellationTokenSource().token
		);
		assert.deepStrictEqual(limited, { type: 'canceled', reason: 'rate limited' });
	});

	test.skip('reports HTTP 402 from Router without assuming a GitHub quota', async function () {
		const statusReporter = new TestStatusReporter();

		const serviceCollectionClone = serviceCollection.clone();
		serviceCollectionClone.define(ICompletionsStatusReporter, statusReporter);
		const accessorClone = serviceCollectionClone.createTestingAccessor();
		const result = await assertResponseWithContext(accessorClone, 402);

		assert.deepStrictEqual(result, { type: 'failed', reason: 'response-text' });
		assert.deepStrictEqual(statusReporter.kind, 'Warning');
		assert.deepStrictEqual(statusReporter.message, 'response-text');
	});

	test('additional headers are included in the request', async function () {
		const recordingFetchService = new MockCompletionsFetchService();
		const params: CompletionParams = {
			prompt: {
				prefix: '',
				suffix: '',
				isFimEnabled: false,
			},
			languageId: '',
			repoInfo: undefined,
			engineModelId: 'dardcor-codex',
			count: 1,
			uiKind: DardcorInlineUiKind.GhostText,
			ourRequestId: generateUuid(),
			headers: { Host: 'bla' },
			extra: {},
		};
		const serviceCollectionClone = serviceCollection.clone();
		serviceCollectionClone.define(ICompletionsFetchService, recordingFetchService);
		const accessor = serviceCollectionClone.createTestingAccessor();

		const openAIFetcher = accessor.get(IInstantiationService).createInstance(LiveOpenAIFetcher);
		await openAIFetcher.fetchAndStreamCompletions(
			params,
			TelemetryWithExp.createEmptyConfigForTesting(),
			() => undefined
		);

		assert.strictEqual(recordingFetchService.lastHeaders?.['Host'], 'bla');
	});

});

suite('Telemetry sent on fetch', function () {
	let accessor: ServicesAccessor;

	setup(function () {
		const serviceCollection = createLibTestingContext();
		serviceCollection.define(ICompletionsFetchService, new MockCompletionsFetchService());
		accessor = serviceCollection.createTestingAccessor();
	});

	test('sanitizeRequestOptionTelemetry properly excludes top-level keys', function () {
		const request = {
			prompt: 'prompt prefix',
			suffix: 'prompt suffix',
			stream: true as const,
			count: 1,
			extra: {
				language: 'python',
			},
		};

		const telemetryWithExp = TelemetryWithExp.createEmptyConfigForTesting();

		sanitizeRequestOptionTelemetry(request, telemetryWithExp, ['prompt', 'suffix']);

		assert.deepStrictEqual(telemetryWithExp.properties, {
			'request.option.stream': 'true',
			'request.option.count': '1',
			'request.option.extra': '{"language":"python"}',
		});
	});

	test('sanitizeRequestOptionTelemetry properly excludes `extra` keys', function () {
		const request = {
			prompt: 'prefix without context',
			suffix: 'prompt suffix',
			stream: true as const,
			count: 1,
			extra: {
				language: 'python',
				context: ['# Language: Python'],
			},
		};

		const telemetryWithExp = TelemetryWithExp.createEmptyConfigForTesting();

		sanitizeRequestOptionTelemetry(request, telemetryWithExp, ['prompt', 'suffix'], ['context']);

		assert.deepStrictEqual(telemetryWithExp.properties, {
			'request.option.stream': 'true',
			'request.option.count': '1',
			'request.option.extra': '{"language":"python"}',
		});
	});

	test('If context is provided while in the split context experiment, only send it in restricted telemetry events', async function () {
		const params: CompletionParams = {
			prompt: {
				context: ['# Language: Python'],
				prefix: 'prefix without context',
				suffix: '\ndef sum(a, b):\n    return a + b',
				isFimEnabled: true,
			},
			languageId: 'python',
			repoInfo: undefined,
			engineModelId: 'dardcor-codex',
			count: 1,
			uiKind: DardcorInlineUiKind.GhostText,
			postOptions: {},
			ourRequestId: generateUuid(),
			extra: {},
		};

		const openAIFetcher = accessor.get(IInstantiationService).createInstance(LiveOpenAIFetcher);
		const telemetryWithExp = TelemetryWithExp.createEmptyConfigForTesting();
		telemetryWithExp.filtersAndExp.exp.variables.dardcorenablepromptcontextproxyfield = true;

		const { reporter } = await withInMemoryTelemetry(accessor, async () => {
			await openAIFetcher.fetchAndStreamCompletions(params, telemetryWithExp, () => undefined);
		});

		const standardEvents = reporter.events;
		const hasContext = standardEvents.some(event => event.properties['request_option_extra']?.includes('context'));
		assert.strictEqual(hasContext, false, 'Standard telemetry event should not include context');

	});

	test('If context is provided, include it in `engine.prompt` telemetry events', function () { });
});

class TestStatusReporter extends StatusReporter {
	eventCount = 0;
	kind = 'Normal';
	message = '';
	command: string | undefined;

	override didChange(event: StatusChangedEvent): void {
		this.eventCount++;
		this.kind = event.kind;
		this.message = event.message || '';
		this.command = event.command?.command;
	}
}

async function assertResponseWithStatus(
	statusCode: number,
	statusReporter: ICompletionsStatusReporter,
	headers?: Record<string, string>
) {
	const serviceCollection = createLibTestingContext();
	serviceCollection.define(ICompletionsStatusReporter, statusReporter);
	const mockFetch = new MockCompletionsFetchService();
	serviceCollection.define(ICompletionsFetchService, mockFetch);
	serviceCollection.define(ICompletionsOpenAIFetcherService, new SyncDescriptor(LiveOpenAIFetcher));
	const accessor = serviceCollection.createTestingAccessor();
	return assertResponseWithContext(accessor, statusCode, headers);
}

async function assertResponseWithContext(accessor: ServicesAccessor, statusCode: number, headers?: Record<string, string>) {
	const fakeHeaders = new HeadersImpl({
		'x-request-id': '1',
		...headers,
	});
	const mockFetch = (() => {
		try {
			return accessor.get(ICompletionsFetchService) as MockCompletionsFetchService;
		} catch {
			const mock = new MockCompletionsFetchService();
			return mock;
		}
	})();
	mockFetch.nextResult = Result.error(new Completions.UnsuccessfulResponse(
		statusCode,
		'status text',
		fakeHeaders,
		() => Promise.resolve('response-text')
	));
	const fetcher = (() => {
		try {
			return accessor.get(ICompletionsOpenAIFetcherService);
		} catch {
			return accessor.get(IInstantiationService).createInstance(LiveOpenAIFetcher);
		}
	})();
	const completionParams: CompletionParams = fakeCompletionParams();
	const result = await fetcher.fetchAndStreamCompletions(
		completionParams,
		TelemetryWithExp.createEmptyConfigForTesting(),
		() => Promise.reject(new Error()),
		new CancellationTokenSource().token
	);
	return result;
}

function fakeCompletionParams(): CompletionParams {
	return {
		prompt: {
			prefix: 'xxx',
			suffix: '',
			isFimEnabled: false,
		},
		languageId: '',
		repoInfo: undefined,
		ourRequestId: generateUuid(),
		engineModelId: 'foo/bar',
		count: 1,
		uiKind: DardcorInlineUiKind.GhostText,
		postOptions: {},
		extra: {},
	};
}

class MockCompletionsFetchService implements ICompletionsFetchService {
	declare _serviceBrand: undefined;

	nextResult: Result<ResponseStream, Completions.CompletionsFetchFailure> | undefined;
	lastParams: Completions.ModelParams | undefined;
	lastHeaders: Record<string, string> | undefined;

	async fetch(
		_url: string,
		_secretKey: string,
		params: Completions.ModelParams,
		_requestId: string,
		_ct: CancellationToken,
		headerOverrides?: Record<string, string>
	): Promise<Result<ResponseStream, Completions.CompletionsFetchFailure>> {
		this.lastParams = params;
		this.lastHeaders = headerOverrides;
		if (this.nextResult) {
			const result = this.nextResult;
			this.nextResult = undefined;
			return result;
		}
		return Result.error(new Completions.RequestCancelled());
	}

	async disconnectAll() { }
}
