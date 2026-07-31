import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostProgress {
	withProgress<R>(options: any, task: (progress: any, token: any) => Promise<R>): Promise<R> {
		const progress = {
			report: (value: { message?: string; increment?: number }) => {
				console.log(`[Progress] ${value.message || ''} ${value.increment ? `+${value.increment}%` : ''}`);
			}
		};

		const token = {
			isCancellationRequested: false,
			onCancellationRequested: new Emitter<void>().event
		};

		return task(progress, token);
	}
}
