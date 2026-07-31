/**
 * Dardcor Code - Checksum Service (Task 146)
 * Mirrors: vs/platform/checksum/common/checksumService.ts SHA256 integrity checker
 */

import { sha256Hex } from '../../core/security/crypto.js';

export const IChecksumService = Symbol('IChecksumService');

export interface IChecksumService {
	checksum(buffer: Uint8Array): Promise<string>;
	verify(buffer: Uint8Array, expectedSha256Hex: string): Promise<boolean>;
}

export class ChecksumService implements IChecksumService {
	async checksum(buffer: Uint8Array): Promise<string> {
		return sha256Hex(buffer);
	}

	async verify(buffer: Uint8Array, expectedSha256Hex: string): Promise<boolean> {
		const computed = await this.checksum(buffer);
		return computed.toLowerCase() === expectedSha256Hex.toLowerCase();
	}
}
