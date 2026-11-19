/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../base/common/async.js';
import { decodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { LRUCache } from '../../../../base/common/map.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';


export async function resizeImage(data: Uint8Array | string, mimeType?: string): Promise<Uint8Array> {
	const isGif = mimeType === 'image/gif';

	if (typeof data === 'string') {
		data = convertStringToUInt8Array(data);
	}

	return new Promise((resolve, reject) => {
		const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeType });
		const img = new Image();
		const url = URL.createObjectURL(blob);
		img.src = url;

		img.onload = () => {
			URL.revokeObjectURL(url);
			let { width, height } = img;

			if ((width <= 768 || height <= 768) && !isGif) {
				resolve(data);
				return;
			}

			if (width > 2048 || height > 2048) {
				const scaleFactor = 2048 / Math.max(width, height);
				width = Math.round(width * scaleFactor);
				height = Math.round(height * scaleFactor);
			}

			const scaleFactor = 768 / Math.min(width, height);
			width = Math.round(width * scaleFactor);
			height = Math.round(height * scaleFactor);

			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.drawImage(img, 0, 0, width, height);

				const jpegTypes = ['image/jpeg', 'image/jpg'];
				const outputMimeType = mimeType && jpegTypes.includes(mimeType) ? 'image/jpeg' : 'image/png';

				canvas.toBlob(blob => {
					if (blob) {
						const reader = new FileReader();
						reader.onload = () => {
							resolve(new Uint8Array(reader.result as ArrayBuffer));
						};
						reader.onerror = (error) => reject(error);
						reader.readAsArrayBuffer(blob);
					} else {
						reject(new Error('Failed to create blob from canvas'));
					}
				}, outputMimeType);
			} else {
				reject(new Error('Failed to get canvas context'));
			}
		};
		img.onerror = (error) => {
			URL.revokeObjectURL(url);
			reject(error);
		};
	});
}

function createImageThumbnail(data: Uint8Array, maxSize: number): Promise<Blob | undefined> {
	return new Promise((resolve) => {
		const blob = new Blob([data as Uint8Array<ArrayBuffer>]);
		const img = document.createElement('img');
		const url = URL.createObjectURL(blob);
		img.src = url;

		img.onload = () => {
			URL.revokeObjectURL(url);
			const { width, height } = img;
			const scaleFactor = Math.min(1, maxSize / Math.max(width, height));
			const targetWidth = Math.max(1, Math.round(width * scaleFactor));
			const targetHeight = Math.max(1, Math.round(height * scaleFactor));

			const canvas = document.createElement('canvas');
			canvas.width = targetWidth;
			canvas.height = targetHeight;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				resolve(undefined);
				return;
			}

			ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
			const outputMimeType = data.length >= 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF ? 'image/jpeg' : 'image/png';
			canvas.toBlob(thumbnail => resolve(thumbnail ?? undefined), outputMimeType);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(undefined);
		};
	});
}

const thumbnailCache = new LRUCache<string, Promise<Blob | undefined>>(50);

const THUMBNAIL_DECODE_TIMEOUT_MS = 10_000;
export const CHAT_IMAGE_HOVER_THUMBNAIL_MAX_SIZE = 768;

export function getOrCreateImageThumbnail(cacheKey: string, data: Uint8Array, maxSize: number): Promise<Blob | undefined> {
	const key = `${cacheKey}:${maxSize}:${data.byteLength}`;
	const cached = thumbnailCache.get(key);
	if (cached) {
		return cached;
	}

	const thumbnail: Promise<Blob | undefined> = raceTimeout(createImageThumbnail(data, maxSize), THUMBNAIL_DECODE_TIMEOUT_MS).then(blob => {
		if (!blob && thumbnailCache.peek(key) === thumbnail) {
			thumbnailCache.delete(key);
		}
		return blob;
	});
	thumbnailCache.set(key, thumbnail);
	return thumbnail;
}

export function convertStringToUInt8Array(data: string): Uint8Array {
	const base64Data = data.includes(',') ? data.split(',')[1] : data;
	if (isValidBase64(base64Data)) {
		return decodeBase64(base64Data).buffer;
	}
	return new TextEncoder().encode(data);
}

export function convertUint8ArrayToString(data: Uint8Array): string {
	try {
		const decoder = new TextDecoder();
		const decodedString = decoder.decode(data);
		return decodedString;
	} catch {
		return '';
	}
}

function isValidBase64(str: string): boolean {
	return /^[A-Za-z0-9+/]*={0,2}$/.test(str) && (() => {
		try {
			atob(str);
			return true;
		} catch {
			return false;
		}
	})();
}

export async function createFileForMedia(fileService: IFileService, imagesFolder: URI, dataTransfer: Uint8Array, mimeType: string): Promise<URI | undefined> {
	const exists = await fileService.exists(imagesFolder);
	if (!exists) {
		await fileService.createFolder(imagesFolder);
	}

	const ext = mimeType.split('/')[1] || 'png';
	const filename = `image-${Date.now()}.${ext}`;
	const fileUri = joinPath(imagesFolder, filename);

	const buffer = VSBuffer.wrap(dataTransfer);
	await fileService.writeFile(fileUri, buffer);

	return fileUri;
}

export async function cleanupOldImages(fileService: IFileService, logService: ILogService, imagesFolder: URI): Promise<void> {
	const exists = await fileService.exists(imagesFolder);
	if (!exists) {
		return;
	}

	const duration = 7 * 24 * 60 * 60 * 1000;
	const files = await fileService.resolve(imagesFolder);
	if (!files.children) {
		return;
	}

	await Promise.all(files.children.map(async (file) => {
		try {
			const timestamp = getTimestampFromFilename(file.name);
			if (timestamp && (Date.now() - timestamp > duration)) {
				await fileService.del(file.resource);
			}
		} catch (err) {
			logService.error('Failed to clean up old images', err);
		}
	}));
}

function getTimestampFromFilename(filename: string): number | undefined {
	const match = filename.match(/image-(\d+)\./);
	if (match) {
		return parseInt(match[1], 10);
	}
	return undefined;
}

CommandsRegistry.registerCommand('_chat.resizeImage', async (_accessor, data: Uint8Array | VSBuffer, mimeType?: string): Promise<Uint8Array> => {
	if (data instanceof VSBuffer) {
		data = data.buffer;
	}
	return resizeImage(data, mimeType);
});
