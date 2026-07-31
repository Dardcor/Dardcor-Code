/**
 * Dardcor Code - VSIX Tar Unpacker (Task 175)
 * Mirrors: vs/platform/extensionManagement/common/extensionManagement.ts VSIX package unpacker
 */

import { readZip } from '../../core/binary/zip-parser.js';
import { URI } from '../../core/types/uri.js';
import { IFileSystemProvider } from '../files/file-service.js';

export async function unpackVsix(vsixBuffer: ArrayBuffer, destDir: URI, fsProvider: IFileSystemProvider): Promise<void> {
	const entries = await readZip(vsixBuffer);
	for (const entry of entries) {
		if (entry.name.startsWith('extension/') && !entry.isDirectory) {
			const relativePath = entry.name.substring('extension/'.length);
			const targetUri = URI.from({
				scheme: destDir.scheme,
				path: `${destDir.path}/${relativePath}`
			});
			await fsProvider.writeFile(targetUri, entry.data, { create: true, overwrite: true });
		}
	}
}
