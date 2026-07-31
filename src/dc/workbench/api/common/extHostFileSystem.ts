import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostFileSystem {
	stat(uri: any): Promise<any> {
		return Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: 0 });
	}

	readDirectory(uri: any): Promise<[string, any][]> {
		return Promise.resolve([]);
	}

	createDirectory(uri: any): Promise<void> {
		return Promise.resolve();
	}

	readFile(uri: any): Promise<Uint8Array> {
		return Promise.resolve(new Uint8Array());
	}

	writeFile(uri: any, content: Uint8Array): Promise<void> {
		return Promise.resolve();
	}

	delete(uri: any, options: { recursive: boolean; useTrash: boolean }): Promise<void> {
		return Promise.resolve();
	}

	rename(oldUri: any, newUri: any, options: { overwrite: boolean }): Promise<void> {
		return Promise.resolve();
	}
}
