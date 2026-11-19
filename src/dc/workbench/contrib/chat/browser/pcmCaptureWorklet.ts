/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const PCM_CAPTURE_PROCESSOR = 'vscode-pcm-capture';

export const PCM_FLUSH_REQUEST = 'vscode-pcm-flush';

export const PCM_FLUSH_ACK = 'vscode-pcm-flushed';

const FLUSH_TIMEOUT_MS = 250;

function pcmCaptureWorkletSource(chunkSize: number): string {
	return `
class PcmCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this._chunkSize = ${chunkSize};
		this._buffer = new Float32Array(this._chunkSize);
		this._offset = 0;
		this.port.onmessage = e => {
			if (e.data && e.data.type === '${PCM_FLUSH_REQUEST}') {
				this._flush();
				this.port.postMessage({ type: '${PCM_FLUSH_ACK}' });
			}
		};
	}
	_flush() {
		if (this._offset > 0) {
			const chunk = this._buffer.slice(0, this._offset);
			this.port.postMessage(chunk, [chunk.buffer]);
			this._offset = 0;
		}
	}
	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (channel) {
			for (let i = 0; i < channel.length; i++) {
				this._buffer[this._offset++] = channel[i];
				if (this._offset === this._chunkSize) {
					const chunk = this._buffer;
					this.port.postMessage(chunk, [chunk.buffer]);
					this._buffer = new Float32Array(this._chunkSize);
					this._offset = 0;
				}
			}
		}
		return true;
	}
}
registerProcessor('${PCM_CAPTURE_PROCESSOR}', PcmCaptureProcessor);
`;
}

export type IPcmCapturePort = Pick<MessagePort, 'postMessage' | 'onmessage'>;

export type IPcmCaptureTimers = Pick<Window & typeof globalThis, 'setTimeout' | 'clearTimeout'>;

export function wirePcmCapturePort(port: IPcmCapturePort, timers: IPcmCaptureTimers, onChunk: (samples: Float32Array) => void): { flush(): Promise<void> } {
	let onFlushed: (() => void) | undefined;
	port.onmessage = e => {
		const data = e.data;
		if (data && (data as { type?: string }).type === PCM_FLUSH_ACK) {
			onFlushed?.();
			return;
		}
		onChunk(data as Float32Array);
	};

	const flush = (): Promise<void> => new Promise<void>(resolve => {
		let settled = false;
		const done = () => {
			if (settled) {
				return;
			}
			settled = true;
			onFlushed = undefined;
			timers.clearTimeout(timer);
			resolve();
		};
		onFlushed = done;
		const timer = timers.setTimeout(done, FLUSH_TIMEOUT_MS);
		port.postMessage({ type: PCM_FLUSH_REQUEST });
	});

	return { flush };
}

export interface IPcmCaptureNode {
	readonly node: AudioWorkletNode;
	flush(): Promise<void>;
}

export async function createPcmCaptureNode(window: Window & typeof globalThis, context: AudioContext, chunkSize: number, onChunk: (samples: Float32Array) => void): Promise<IPcmCaptureNode> {
	const moduleUrl = URL.createObjectURL(new Blob([pcmCaptureWorkletSource(chunkSize)], { type: 'application/javascript' }));
	try {
		await context.audioWorklet.addModule(moduleUrl);
	} finally {
		URL.revokeObjectURL(moduleUrl);
	}

	const node = new window.AudioWorkletNode(context, PCM_CAPTURE_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
	const { flush } = wirePcmCapturePort(node.port, window, onChunk);
	return { node, flush };
}
