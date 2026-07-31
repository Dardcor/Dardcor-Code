/**
 * Dardcor Code - Checksum Service (Task 146)
 * Mirrors: vs/platform/checksum/common/checksumService.ts (SHA256 integrity checker)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { sha256Hex } from '../../core/security/crypto.js';

export const IChecksumService = createDecorator<IChecksumService>('checksumService');

export interface IChecksumService {
	readonly _serviceBrand: undefined;
	checksum(buffer: Uint8Array): Promise<string>;
	verify(buffer: Uint8Array, expectedSha256Hex: string): Promise<boolean>;
}

export class ChecksumService implements IChecksumService {
	declare readonly _serviceBrand: undefined;

	async checksum(buffer: Uint8Array): Promise<string> {
		return sha256Hex(buffer);
	}

	async verify(buffer: Uint8Array, expectedSha256Hex: string): Promise<boolean> {
		const computed = await this.checksum(buffer);
		return computed.toLowerCase() === expectedSha256Hex.toLowerCase();
	}
}
