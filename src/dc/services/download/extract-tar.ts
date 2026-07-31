/**
 * Dardcor Code - VSIX Zip Unpacker (Task 175)
 * Mirrors: vs/platform/extensionManagement/common/extensionManagement.ts VSIX package unpacker
 */

import { readZip } from '../../core/binary/zip-parser';
import { URI } from '../../core/types/uri';
import { DataBuffer } from '../../core/binary/buffer';
import { IFileService } from '../files/file-service';

export async function unpackVsix(vsixBuffer: ArrayBuffer | Uint8Array, destDir: URI, fileService: IFileService): Promise<void> {
	const buffer = vsixBuffer instanceof Uint8Array
		? vsixBuffer.buffer.slice(vsixBuffer.byteOffset, vsixBuffer.byteOffset + vsixBuffer.byteLength) as ArrayBuffer
		: vsixBuffer;
	const entries = await readZip(buffer);
	const provider = fileService.getProvider(destDir.scheme);
	for (const entry of entries) {
		if (entry.isDirectory) {
			continue;
		}
		const relativePath = entry.name.startsWith('extension/')
			? entry.name.substring('extension/'.length)
			: entry.name;
		if (!relativePath || hasTraversalSegments(relativePath)) {
			continue;
		}
		const targetUri = URI.from({
			scheme: destDir.scheme,
			path: `${destDir.path}/${relativePath}`,
		});
		if (provider) {
			const lastSlash = targetUri.path.lastIndexOf('/');
			if (lastSlash > 0) {
				const parentUri = URI.from({
					scheme: targetUri.scheme,
					path: targetUri.path.substring(0, lastSlash),
				});
				try {
					await provider.mkdir(parentUri);
				} catch {
					// Parent directory already exists.
				}
			}
		}
		await fileService.writeFile(targetUri, DataBuffer.wrap(entry.data));
	}
}

function hasTraversalSegments(relativePath: string): boolean {
	return relativePath.split('/').some((segment) => segment === '..' || segment === '.');
}
