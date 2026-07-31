/**
 * Dardcor Code - Download Service (Task 145)
 * Mirrors: vs/platform/download/common/download.ts (file downloader with progress)
 */

import { createDecorator } from '../instantiation/annotations';
import { URI } from '../../core/types/uri';
import { CancellationToken } from '../../core/async/cancellation';
import { DataBuffer } from '../../core/binary/buffer';
import { IRequestService } from '../request/request-service';
import { IFileService } from '../files/file-service';

export const IDownloadService = createDecorator<IDownloadService>('downloadService');

export interface IDownloadService {
	readonly _serviceBrand: undefined;
	download(url: string, destResource: URI, onProgress?: (downloaded: number, total: number) => void, token?: CancellationToken): Promise<void>;
}

export class DownloadService implements IDownloadService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly _requestService: IRequestService,
		private readonly _fileService: IFileService
	) {}

	async download(url: string, destResource: URI, onProgress?: (downloaded: number, total: number) => void, token?: CancellationToken): Promise<void> {
		const res = await this._requestService.request({ url }, token);

		const stream = res.stream();
		if (stream) {
			const chunks: Uint8Array[] = [];
			let received = 0;
			const total = Number(res.headers['content-length'] ?? 0);
			const reader = stream.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				chunks.push(value);
				received += value.byteLength;
				onProgress?.(received, total || received);
			}
			const size = chunks.reduce((sum, c) => sum + c.byteLength, 0);
			const merged = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				merged.set(chunk, offset);
				offset += chunk.byteLength;
			}
			await this._fileService.writeFile(destResource, DataBuffer.wrap(merged));
			return;
		}

		const buf = await res.arrayBuffer();
		const bytes = new Uint8Array(buf);
		onProgress?.(bytes.byteLength, bytes.byteLength);
		await this._fileService.writeFile(destResource, DataBuffer.wrap(bytes));
	}
}
