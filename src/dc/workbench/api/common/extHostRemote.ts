import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostRemote {
	get isRemote(): boolean {
		return false; // Standalone desktop app
	}

	get remoteName(): string | undefined {
		return undefined;
	}
}
