/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { TelemetryCorrelationId } from '../../../util/common/telemetryCorrelationId';
import { Limiter } from '../../../util/dardcor/base/common/async';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { IEndpointProvider } from '../../endpoint/common/endpointProvider';
import { logExecTime } from '../../log/common/logExecTime';
import { ILogService } from '../../log/common/logService';
import { IEmbeddingsEndpoint, postRequest } from '../../networking/common/networking';
import { GenAiAttr, GenAiOperationName, GenAiProviderName } from '../../otel/common/genAiAttributes';
import { IOTelService, SpanKind, SpanStatusCode } from '../../otel/common/otelService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { ComputeEmbeddingsOptions, Embedding, EmbeddingType, EmbeddingTypeInfo, EmbeddingVector, Embeddings, IEmbeddingsComputer, getWellKnownEmbeddingTypeInfo } from './embeddingsComputer';

interface RouterEmbeddingResults {
	readonly type: 'success';
	readonly embeddings: EmbeddingVector[];
}
interface RouterEmbeddingError {
	readonly type: 'failed';
	readonly reason: string;
}

export class RemoteEmbeddingsComputer implements IEmbeddingsComputer {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IEndpointProvider private readonly _endpointProvider: IEndpointProvider,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IOTelService private readonly _otelService: IOTelService,
	) { }

	public async computeEmbeddings(
		embeddingType: EmbeddingType,
		inputs: readonly string[],
		options?: ComputeEmbeddingsOptions,
		_telemetryInfo?: TelemetryCorrelationId,
		cancellationToken?: CancellationToken,
	): Promise<Embeddings> {
		const otelSpan = this._otelService.startSpan(`embeddings ${embeddingType.id}`, {
			kind: SpanKind.CLIENT,
			attributes: {
				[GenAiAttr.OPERATION_NAME]: GenAiOperationName.EMBEDDINGS,
				[GenAiAttr.PROVIDER_NAME]: GenAiProviderName.OPENAI,
				[GenAiAttr.REQUEST_MODEL]: embeddingType.id,
				'gen_ai.embeddings.input_count': inputs.length,
			},
		});
		try {
			return await logExecTime(this._logService, 'RemoteEmbeddingsComputer::computeEmbeddings', async () => {
				const embeddings = await this.computeRouterEmbeddings(inputs, options, cancellationToken);
				return embeddings ?? { type: embeddingType, values: [] };
			});
		} catch (err) {
			otelSpan.setStatus(SpanStatusCode.ERROR, err instanceof Error ? err.message : String(err));
			otelSpan.setAttribute('error.type', err instanceof Error ? err.constructor.name : 'Error');
			otelSpan.recordException(err);
			throw err;
		} finally {
			otelSpan.end();
		}
	}

	private async computeRouterEmbeddings(
		inputs: readonly string[],
		options?: ComputeEmbeddingsOptions,
		cancellationToken?: CancellationToken,
	) {
		const typeInfo = getWellKnownEmbeddingTypeInfo(EmbeddingType.text3small_512);
		if (!typeInfo) {
			throw new Error(`Embeddings type info not found: ${EmbeddingType.text3small_512}`);
		}
		const endpoint = await this._endpointProvider.getEmbeddingsEndpoint('text3small');
		const batchSize = endpoint.maxBatchSize;
		const maxTokens = endpoint.modelMaxPromptTokens - 1;
		return this.fetchResponseWithBatches(typeInfo, endpoint, inputs, cancellationToken, maxTokens, batchSize);
	}

	private async fetchResponseWithBatches(
		type: EmbeddingTypeInfo,
		endpoint: IEmbeddingsEndpoint,
		inputs: readonly string[],
		cancellationToken: CancellationToken | undefined,
		maxTokens: number,
		batchSize: number,
		parallelism = 1,
	): Promise<Embeddings | undefined> {
		for (const input of inputs) {
			const inputTokenLength = await endpoint.acquireTokenizer().tokenLength(input);
			if (inputTokenLength > maxTokens) {
				return undefined;
			}
		}

		let embeddings: EmbeddingVector[] = [];
		const promises: Promise<RouterEmbeddingResults | undefined>[] = [];
		const limiter = new Limiter<RouterEmbeddingResults | undefined>(parallelism);
		try {
			for (let i = 0; i < inputs.length; i += batchSize) {
				const currentBatch = inputs.slice(i, i + batchSize);
				promises.push(limiter.queue(async () => {
					if (cancellationToken?.isCancellationRequested) {
						return;
					}

					const r = await this.rawEmbeddingsFetchWithTelemetry(type, endpoint, generateUuid(), currentBatch, cancellationToken);
					if (r.type === 'failed') {
						throw new Error('Embeddings request failed ' + r.reason);
					}
					return r;
				}));
			}

			embeddings = (await Promise.all(promises)).flatMap(response => response?.embeddings ?? []);
		} catch (e) {
			return undefined;
		} finally {
			limiter.dispose();
		}

		if (cancellationToken?.isCancellationRequested) {
			return undefined;
		}

		if (embeddings.length === 0) {
			return undefined;
		}
		return { type: EmbeddingType.text3small_512, values: embeddings.map((value): Embedding => ({ type: EmbeddingType.text3small_512, value })) };
	}

	private async rawEmbeddingsFetchWithTelemetry(
		type: EmbeddingTypeInfo,
		endpoint: IEmbeddingsEndpoint,
		requestId: string,
		inputs: readonly string[],
		cancellationToken: CancellationToken | undefined
	) {
		const startTime = Date.now();
		const rawRequest = await this.rawEmbeddingsFetch(type, endpoint, requestId, inputs, cancellationToken);
		if (rawRequest.type === 'failed') {
			this._telemetryService.sendMSFTTelemetryErrorEvent('embedding.error', {
				type: rawRequest.type,
				reason: rawRequest.reason
			});
			return rawRequest;
		}

		const tokenizer = endpoint.acquireTokenizer();
		const tokenCounts = await Promise.all(inputs.map(input => tokenizer.tokenLength(input)));
		const inputTokenCount = tokenCounts.reduce((acc, count) => acc + count, 0);
		this._telemetryService.sendMSFTTelemetryEvent('embedding.success', {}, {
			batchSize: inputs.length,
			inputTokenCount,
			timeToComplete: Date.now() - startTime
		});
		return rawRequest;
	}

	public async rawEmbeddingsFetch(
		type: EmbeddingTypeInfo,
		endpoint: IEmbeddingsEndpoint,
		requestId: string,
		inputs: readonly string[],
		cancellationToken: CancellationToken | undefined
	): Promise<RouterEmbeddingResults | RouterEmbeddingError> {
		try {
			const body = { input: inputs, model: endpoint.family, dimensions: type.dimensions };
			endpoint.interceptBody?.(body);
			const response = await this._instantiationService.invokeFunction(postRequest, {
				endpointOrUrl: endpoint,
				secretKey: undefined,
				intent: 'dardcor-panel',
				requestId,
				body,
				cancelToken: cancellationToken,
			});
			const jsonResponse = response.status === 200 ? await response.json() : await response.text();

			type EmbeddingResponse = {
				object: string;
				index: number;
				embedding: number[];
			};
			if (response.status === 200 && Array.isArray(jsonResponse.data)) {
				const embeddings: number[][] = jsonResponse.data.map((d: EmbeddingResponse) => d.embedding);
				if (embeddings.length !== inputs.length || embeddings.some(vector => !Array.isArray(vector) || vector.length !== type.dimensions)) {
					return { type: 'failed', reason: `Router returned incompatible embeddings: expected ${inputs.length} vectors with ${type.dimensions} dimensions.` };
				}
				return { type: 'success', embeddings };
			} else {
				return { type: 'failed', reason: jsonResponse?.error?.message ?? `HTTP ${response.status}` };
			}
		} catch (e) {
			let errorMessage = (e as Error)?.message ?? 'Unknown error';
			if (errorMessage.match(/Unexpected.*JSON/i)) {
				errorMessage = 'timeout';
			}
			return { type: 'failed', reason: errorMessage };

		}
	}
}
