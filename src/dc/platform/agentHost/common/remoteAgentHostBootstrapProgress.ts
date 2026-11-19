/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable, observableValue } from '../../../base/common/observable.js';
import { Disposable } from '../../../base/common/lifecycle.js';

const SERVER_DOWNLOAD_PROGRESS_REGEX = /^Downloading server:\s*\d+\/\d+\s+\((?<percentage>\d{1,3})%\)/;

export interface IRemoteAgentHostBootstrapProgress {
	readonly phase: 'serverDownload';
	readonly percentage: number;
}

export function redactToken(text: string): string {
	return text.replace(/\?tkn=[^\s&]+/g, '?tkn=***');
}

export class RemoteAgentHostBootstrapProgressReporter extends Disposable {

	private readonly _progress = observableValue<IRemoteAgentHostBootstrapProgress | undefined>(this, undefined);
	readonly progress: IObservable<IRemoteAgentHostBootstrapProgress | undefined> = this._progress;

	private _lastReportTime: number | undefined;
	private _pendingProgress: IRemoteAgentHostBootstrapProgress | undefined;
	private _timeoutHandle: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly _intervalMs = 250) {
		super();
	}

	acceptLine(line: string): void {
		const progress = this._parseProgress(redactToken(line));
		if (!progress) {
			return;
		}

		const now = Date.now();
		if (this._lastReportTime === undefined || now - this._lastReportTime >= this._intervalMs) {
			if (this._timeoutHandle !== undefined) {
				clearTimeout(this._timeoutHandle);
				this._timeoutHandle = undefined;
			}
			this._pendingProgress = undefined;
			this._lastReportTime = now;
			this._progress.set(progress, undefined);
			return;
		}

		this._pendingProgress = progress;
		if (this._timeoutHandle === undefined) {
			this._timeoutHandle = setTimeout(() => {
				this._timeoutHandle = undefined;
				const pendingProgress = this._pendingProgress;
				if (pendingProgress) {
					this._lastReportTime = Date.now();
					this._progress.set(pendingProgress, undefined);
					this._pendingProgress = undefined;
				}
			}, this._intervalMs - (now - this._lastReportTime));
		}
	}

	flush(): void {
		if (this._timeoutHandle !== undefined) {
			clearTimeout(this._timeoutHandle);
			this._timeoutHandle = undefined;
		}
		const pendingProgress = this._pendingProgress;
		if (pendingProgress) {
			this._lastReportTime = Date.now();
			this._progress.set(pendingProgress, undefined);
			this._pendingProgress = undefined;
		}
	}

	override dispose(): void {
		if (this._timeoutHandle !== undefined) {
			clearTimeout(this._timeoutHandle);
			this._timeoutHandle = undefined;
		}
		super.dispose();
	}

	private _parseProgress(line: string): IRemoteAgentHostBootstrapProgress | undefined {
		const match = SERVER_DOWNLOAD_PROGRESS_REGEX.exec(line);
		const percentage = Number(match?.groups?.percentage);
		if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
			return undefined;
		}
		return { phase: 'serverDownload', percentage };
	}
}
