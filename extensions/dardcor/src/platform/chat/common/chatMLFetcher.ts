/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { AsyncIterableObject, AsyncIterableSource } from '../../../util/dardcor/base/common/async';
import { Event } from '../../../util/dardcor/base/common/event';
import { FinishedCallback, IResponseDelta, OptionalChatRequestParams } from '../../networking/common/fetch';
import { IChatEndpoint, IMakeChatRequestOptions } from '../../networking/common/networking';
import { ChatResponse, ChatResponses } from './commonTypes';

export interface Source {
	readonly extensionId?: string;
}

export interface IResponsePart {
	readonly delta: IResponseDelta;
}

export interface IFetchMLOptions extends IMakeChatRequestOptions {
	endpoint: IChatEndpoint;
	requestOptions: OptionalChatRequestParams;
}


export const IChatMLFetcher = createServiceIdentifier<IChatMLFetcher>('IChatMLFetcher');

export interface IChatMLFetcher {

	readonly _serviceBrand: undefined;

	readonly onDidMakeChatMLRequest: Event<{ readonly model: string; readonly source?: Source; readonly tokenCount?: number }>;

	fetchOne(options: IFetchMLOptions, token: CancellationToken): Promise<ChatResponse>;

	fetchMany(options: IFetchMLOptions, token: CancellationToken): Promise<ChatResponses>;
}

interface IResponsePartWithText extends IResponsePart {
	readonly text: string;
}

export class FetchStreamSource {

	private _stream = new AsyncIterableSource<IResponsePart>();
	private _paused?: (IResponsePartWithText | undefined)[];

	private _seenAnnotationTypes = new Set<string>();

	public get stream(): AsyncIterableObject<IResponsePart> {
		return this._stream.asyncIterable;
	}

	constructor() { }

	pause() {
		this._paused ??= [];
	}

	unpause() {
		const toEmit = this._paused;
		if (!toEmit) {
			return;
		}

		this._paused = undefined;
		for (const part of toEmit) {
			if (part) {
				this.update(part.text, part.delta);
			} else {
				this.resolve();
			}
		}
	}

	update(text: string, delta: IResponseDelta): void {
		if (this._paused) {
			this._paused.push({ text, delta });
			return;
		}

		if (delta.codeVulnAnnotations) {
			const numTripleBackticks = text.match(/(^|\n)```/g)?.length ?? 0;
			const insideCodeblock = numTripleBackticks % 2 === 1;
			if (!insideCodeblock || text.match(/(^|\n)```\w*\s*$/)) {
				delta.codeVulnAnnotations = undefined;
			}
		}

		if (delta.codeVulnAnnotations) {
			delta.codeVulnAnnotations = delta.codeVulnAnnotations.filter(annotation => !this._seenAnnotationTypes.has(annotation.details.type));
			delta.codeVulnAnnotations.forEach(annotation => this._seenAnnotationTypes.add(annotation.details.type));
		}
		this._stream.emitOne({ delta });
	}

	resolve(): void {
		if (this._paused) {
			this._paused.push(undefined);
			return;
		}

		this._stream.resolve();
	}

	reject(error: Error): void {
		this._paused = undefined;
		this._stream.reject(error);
	}
}

export class FetchStreamRecorder {
	public readonly callback: FinishedCallback;
	public readonly deltas: IResponseDelta[] = [];

	private _firstTokenEmittedTime: number | undefined;
	public get firstTokenEmittedTime(): number | undefined {
		return this._firstTokenEmittedTime;
	}

	private _lastOutputChunkTime: number | undefined;
	private readonly _outputChunkGapsMs: number[] = [];
	public get outputChunkGapsMs(): readonly number[] {
		return this._outputChunkGapsMs;
	}

	constructor(
		callback: FinishedCallback | undefined
	) {
		this.callback = async (text: string, index: number, delta: IResponseDelta): Promise<number | undefined> => {
			const isContentChunk = !!(delta.text || delta.beginToolCalls || (typeof delta.thinking?.text === 'string' && delta.thinking?.text || delta.thinking?.text?.length) || delta.dardcorToolCalls || delta.dardcorToolCallStreamUpdates);
			if (isContentChunk) {
				const now = Date.now();
				if (this._firstTokenEmittedTime === undefined) {
					this._firstTokenEmittedTime = now;
				} else if (this._lastOutputChunkTime !== undefined) {
					this._outputChunkGapsMs.push(now - this._lastOutputChunkTime);
				}
				this._lastOutputChunkTime = now;
			}

			const result = callback ? await callback(text, index, delta) : undefined;
			this.deltas.push(delta);
			return result;
		};
	}
}
