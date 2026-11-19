/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentId } from '../../../platform/inlineEdits/common/dataTypes/documentId';
import { StatelessNextEditRequest } from '../../../platform/inlineEdits/common/statelessNextEditProvider';
import { ILogger } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { CachedOrRebasedEdit } from './nextEditCache';
import { NextEditResult } from './nextEditResult';

export const enum SpeculativeCancelReason {

	Rejected = 'rejected',

	IgnoredDismissed = 'ignoredDismissed',

	Superseded = 'superseded',

	Replaced = 'replaced',

	DivergedFromTrajectoryForm = 'divergedFromTrajectoryForm',
	DivergedFromTrajectoryPrefix = 'divergedFromTrajectoryPrefix',
	DivergedFromTrajectoryMiddle = 'divergedFromTrajectoryMiddle',
	DivergedFromTrajectorySuffix = 'divergedFromTrajectorySuffix',

	CacheCleared = 'cacheCleared',

	DocumentClosed = 'documentClosed',

	Disposed = 'disposed',
}

export interface SpeculativePendingRequest {
	readonly request: StatelessNextEditRequest<CachedOrRebasedEdit>;
	readonly docId: DocumentId;
	readonly postEditContent: string;
	readonly trajectoryPrefix: string;
	readonly trajectorySuffix: string;
	readonly trajectoryNewText: string;
}

export interface ScheduledSpeculativeRequest {
	readonly suggestion: NextEditResult;
	readonly headerRequestId: string;
}

export class SpeculativeRequestManager extends Disposable {

	private _pending: SpeculativePendingRequest | null = null;
	private _scheduled: ScheduledSpeculativeRequest | null = null;

	private readonly _claimed = new Map<StatelessNextEditRequest<CachedOrRebasedEdit>, SpeculativePendingRequest>();

	constructor(private readonly _logger: ILogger) {
		super();
	}

	get pending(): SpeculativePendingRequest | null {
		return this._pending;
	}

	setPending(req: SpeculativePendingRequest): void {
		if (this._pending && this._pending.request !== req.request) {
			this._cancelPending(SpeculativeCancelReason.Replaced);
		}
		this._pending = req;
	}

	claimPending(): void {
		const p = this._pending;
		if (!p) {
			return;
		}
		this._pending = null;
		this._claimed.set(p.request, p);
		p.request.result.then(() => this._releaseClaimed(p), () => this._releaseClaimed(p));
	}

	findClaimed(predicate: (req: SpeculativePendingRequest) => boolean): SpeculativePendingRequest | undefined {
		for (const claimed of this._claimed.values()) {
			if (predicate(claimed)) {
				return claimed;
			}
		}
		return undefined;
	}

	private _releaseClaimed(req: SpeculativePendingRequest): void {
		this._claimed.delete(req.request);
	}

	schedule(s: ScheduledSpeculativeRequest): void {
		this._scheduled = s;
	}

	clearScheduled(): void {
		this._scheduled = null;
	}

	consumeScheduled(headerRequestId: string): ScheduledSpeculativeRequest | null {
		if (this._scheduled?.headerRequestId !== headerRequestId) {
			return null;
		}
		const s = this._scheduled;
		this._scheduled = null;
		return s;
	}

	cancelAll(reason: SpeculativeCancelReason): void {
		this._scheduled = null;
		this._cancelPending(reason);
	}

	cancelIfMismatch(docId: DocumentId, postEditContent: string, reason: SpeculativeCancelReason): void {
		if (this._pending && (this._pending.docId !== docId || this._pending.postEditContent !== postEditContent)) {
			this._cancelPending(reason);
		}
	}

	onDocumentClosed(docId: DocumentId): void {
		if (this._scheduled?.suggestion.result?.targetDocumentId === docId) {
			this._scheduled = null;
		}
		if (this._pending?.docId === docId) {
			this._cancelPending(SpeculativeCancelReason.DocumentClosed);
		}
		this.invalidateClaimed(SpeculativeCancelReason.DocumentClosed, req => req.docId === docId);
	}

	onActiveDocumentChanged(docId: DocumentId, currentDocValue: string): void {
		const p = this._pending;
		if (!p || p.docId !== docId) {
			return;
		}
		if (currentDocValue.length < p.trajectoryPrefix.length + p.trajectorySuffix.length) {
			this._cancelPending(SpeculativeCancelReason.DivergedFromTrajectoryForm);
			return;
		}
		if (!currentDocValue.startsWith(p.trajectoryPrefix)) {
			this._cancelPending(SpeculativeCancelReason.DivergedFromTrajectoryPrefix);
			return;
		}
		if (!currentDocValue.endsWith(p.trajectorySuffix)) {
			this._cancelPending(SpeculativeCancelReason.DivergedFromTrajectorySuffix);
			return;
		}
		const middle = currentDocValue.slice(p.trajectoryPrefix.length, currentDocValue.length - p.trajectorySuffix.length);
		if (!p.trajectoryNewText.startsWith(middle)) {
			this._cancelPending(SpeculativeCancelReason.DivergedFromTrajectoryMiddle);
		}
	}

	private _cancelPending(reason: SpeculativeCancelReason): void {
		const p = this._pending;
		if (!p) {
			return;
		}
		this._pending = null;
		this._cancelRequest(p, reason);
	}

	invalidateClaimed(reason: SpeculativeCancelReason, filter?: (req: SpeculativePendingRequest) => boolean): void {
		for (const claimed of [...this._claimed.values()]) {
			if (filter && !filter(claimed)) {
				continue;
			}
			this._claimed.delete(claimed.request);
			this._cancelRequest(claimed, reason);
		}
	}

	private _cancelRequest(p: SpeculativePendingRequest, reason: SpeculativeCancelReason): void {
		const headerRequestId = p.request.headerRequestId;
		this._logger.trace(`cancelling speculative request: ${reason} (headerRequestId=${headerRequestId})`);
		p.request.logContext.addLog(`speculative request cancelled: ${reason}`);
		const cts = p.request.cancellationTokenSource;
		cts.cancel();
		cts.dispose();
	}

	override dispose(): void {
		this.cancelAll(SpeculativeCancelReason.Disposed);
		this.invalidateClaimed(SpeculativeCancelReason.Disposed);
		super.dispose();
	}
}
