import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostProfile {
	// Alias or stub for ExtHostProfile
	get currentProfile(): any {
		return { id: 'default', name: 'Default' };
	}
}
