/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { getChatSessionType } from '../common/model/chatUri.js';
import { IEditSessionEntryDiff } from '../common/editing/chatEditingService.js';

export const IChatResponseFileChangesService = createDecorator<IChatResponseFileChangesService>('chatResponseFileChangesService');

export interface IChatResponseFileEdit extends IEditSessionEntryDiff {
	readonly isOutsideWorkspace: boolean;
}

export const AUTHORITATIVE_EMPTY_CHAT_RESPONSE_FILE_CHANGES: readonly IEditSessionEntryDiff[] = [];

export interface IChatResponseFileChangesProvider {
	getChangesForRequest(sessionResource: URI, requestId: string): IObservable<readonly IEditSessionEntryDiff[]> | undefined;

	getFileEditsForRequest?(sessionResource: URI, requestId: string): IObservable<readonly IChatResponseFileEdit[]> | undefined;
}

export interface IChatResponseFileChangesOpenContext {
	readonly isLastTurn: boolean;
}

export interface IChatResponseFileChangesStats {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}

export interface IChatResponseFileChangesService {
	readonly _serviceBrand: undefined;

	registerProvider(chatSessionType: string, provider: IChatResponseFileChangesProvider): IDisposable;

	getChangesForRequest(sessionResource: URI, requestId: string): IObservable<readonly IEditSessionEntryDiff[]> | undefined;

	getFileEditsForRequest?(sessionResource: URI, requestId: string): IObservable<readonly IChatResponseFileEdit[]> | undefined;

	getChangeStatsForRequest?(sessionResource: URI, requestId: string, context: IChatResponseFileChangesOpenContext): IObservable<IChatResponseFileChangesStats> | undefined;

	openChangesForRequest(sessionResource: URI, requestId: string | undefined, context: IChatResponseFileChangesOpenContext): void;
}

export abstract class AbstractChatResponseFileChangesService extends Disposable implements IChatResponseFileChangesService {
	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Map<string, IChatResponseFileChangesProvider>();

	registerProvider(chatSessionType: string, provider: IChatResponseFileChangesProvider): IDisposable {
		if (this._providers.has(chatSessionType)) {
			throw new Error(`A chat response file changes provider is already registered for session type '${chatSessionType}'`);
		}
		this._providers.set(chatSessionType, provider);
		return toDisposable(() => {
			if (this._providers.get(chatSessionType) === provider) {
				this._providers.delete(chatSessionType);
			}
		});
	}

	getChangesForRequest(sessionResource: URI, requestId: string): IObservable<readonly IEditSessionEntryDiff[]> | undefined {
		const provider = this._providers.get(getChatSessionType(sessionResource));
		return provider?.getChangesForRequest(sessionResource, requestId);
	}

	getFileEditsForRequest(sessionResource: URI, requestId: string): IObservable<readonly IChatResponseFileEdit[]> | undefined {
		const provider = this._providers.get(getChatSessionType(sessionResource));
		return provider?.getFileEditsForRequest?.(sessionResource, requestId);
	}

	getChangeStatsForRequest(_sessionResource: URI, _requestId: string, _context: IChatResponseFileChangesOpenContext): IObservable<IChatResponseFileChangesStats> | undefined {
		return undefined;
	}

	abstract openChangesForRequest(sessionResource: URI, requestId: string | undefined, context: IChatResponseFileChangesOpenContext): void;
}
