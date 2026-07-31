import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostEncryption {
	async encrypt(data: string): Promise<string> {
		// Mock encryption for now
		return Buffer.from(data).toString('base64');
	}

	async decrypt(encryptedData: string): Promise<string> {
		// Mock decryption for now
		return Buffer.from(encryptedData, 'base64').toString('utf8');
	}
}
