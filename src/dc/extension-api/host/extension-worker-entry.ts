import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { ExtensionHostService } from './extension-service.js';

export interface IWorkerMessage {
	readonly type: string;
	readonly [key: string]: unknown;
}

export interface IWorkerEntryOptions {
	readonly extensionDevelopmentPaths?: string[];
}

type WorkerLike = {
	postMessage(message: unknown): void;
	addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
};

export function startExtensionWorkerEntry(options: IWorkerEntryOptions = {}): void {
	const selfLike = (typeof self !== 'undefined' ? self : undefined) as WorkerLike | undefined;
	if (!selfLike) {
		throw new Error('Extension Worker Entry harus berjalan di dalam Web Worker');
	}
	const service = new ExtensionHostService();
	const pendingInitialization: string[] = options.extensionDevelopmentPaths ?? [];
	selfLike.addEventListener('message', (event: { data: unknown }) => {
		const message = event.data as IWorkerMessage;
		switch (message.type) {
			case 'initialize': {
				const paths = message.paths as string[] | undefined;
				const allPaths = [...pendingInitialization, ...(paths ?? [])];
				service.activateExtensions(allPaths, 'initialize')
					.then(activated => {
						selfLike.postMessage({ type: 'initialized', activated: activated.map(ext => ext.id) });
					})
					.catch(err => {
						selfLike.postMessage({ type: 'error', error: String(err instanceof Error ? err.message : err) });
					});
				break;
			}
			case 'activateExtension': {
				const path = message.path as string | undefined;
				if (!path) {
					selfLike.postMessage({ type: 'error', error: 'activateExtension membutuhkan field "path"' });
					break;
				}
				service.activateExtension(path, 'worker-message')
					.then(ext => {
						selfLike.postMessage({ type: 'activated', id: ext.id });
					})
					.catch(err => {
						selfLike.postMessage({ type: 'error', error: String(err instanceof Error ? err.message : err) });
					});
				break;
			}
			case 'deactivateAll': {
				service.deactivateAll('worker-message')
					.then(() => {
						selfLike.postMessage({ type: 'deactivated' });
					})
					.catch(err => {
						selfLike.postMessage({ type: 'error', error: String(err instanceof Error ? err.message : err) });
					});
				break;
			}
			case 'ping': {
				selfLike.postMessage({ type: 'pong', activated: service.activatedIds });
				break;
			}
			default:
				selfLike.postMessage({ type: 'error', error: `Pesan worker tidak dikenal: ${String(message.type)}` });
		}
	});
	selfLike.postMessage({ type: 'ready' });
}

export function main(options: IWorkerEntryOptions = {}): void {
	startExtensionWorkerEntry(options);
}
