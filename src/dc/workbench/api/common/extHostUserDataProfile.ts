import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostUserDataProfile {
	private _currentProfile = { id: 'default', name: 'Default' };

	get currentProfile(): any {
		return this._currentProfile;
	}

	readonly onDidChangeProfile = new Emitter<any>().event;

	$acceptProfileChanged(profile: any): void {
		this._currentProfile = profile;
	}
}
