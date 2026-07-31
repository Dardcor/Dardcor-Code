/**
 * Dardcor Code - User Profile Service (Task 148)
 * Mirrors: vs/platform/userDataProfile/common/userDataProfile.ts
 */

import { URI } from '../../core/types/uri.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { IDisposable } from '../../core/lifecycle/disposable.js';

export interface IUserDataProfile {
	readonly id: string;
	readonly name: string;
	readonly location: URI;
	readonly isDefault: boolean;
	readonly settingsResource: URI;
	readonly keybindingsResource: URI;
	readonly extensionsResource: URI;
}

export const IUserDataProfileService = Symbol('IUserDataProfileService');

export interface IUserDataProfileService extends IDisposable {
	readonly onDidChangeCurrentProfile: Event<IUserDataProfile>;
	readonly currentProfile: IUserDataProfile;
	readonly profiles: IUserDataProfile[];
	createProfile(name: string): Promise<IUserDataProfile>;
	setProfile(profile: IUserDataProfile): Promise<void>;
}

export class UserDataProfileService implements IUserDataProfileService {
	private _currentProfile: IUserDataProfile;
	private readonly _profiles: IUserDataProfile[] = [];
	private readonly _onDidChangeCurrentProfile = new Emitter<IUserDataProfile>();
	readonly onDidChangeCurrentProfile: Event<IUserDataProfile> = this._onDidChangeCurrentProfile.event;

	constructor(defaultProfileLocation: URI) {
		this._currentProfile = {
			id: 'default',
			name: 'Default',
			location: defaultProfileLocation,
			isDefault: true,
			settingsResource: URI.from({ scheme: defaultProfileLocation.scheme, path: `${defaultProfileLocation.path}/settings.json` }),
			keybindingsResource: URI.from({ scheme: defaultProfileLocation.scheme, path: `${defaultProfileLocation.path}/keybindings.json` }),
			extensionsResource: URI.from({ scheme: defaultProfileLocation.scheme, path: `${defaultProfileLocation.path}/extensions.json` }),
		};
		this._profiles.push(this._currentProfile);
	}

	get currentProfile(): IUserDataProfile { return this._currentProfile; }
	get profiles(): IUserDataProfile[] { return [...this._profiles]; }

	async createProfile(name: string): Promise<IUserDataProfile> {
		const id = name.toLowerCase().replace(/\s+/g, '-');
		const location = URI.from({ scheme: this._currentProfile.location.scheme, path: `${this._currentProfile.location.path}/profiles/${id}` });
		const p: IUserDataProfile = {
			id,
			name,
			location,
			isDefault: false,
			settingsResource: URI.from({ scheme: location.scheme, path: `${location.path}/settings.json` }),
			keybindingsResource: URI.from({ scheme: location.scheme, path: `${location.path}/keybindings.json` }),
			extensionsResource: URI.from({ scheme: location.scheme, path: `${location.path}/extensions.json` }),
		};
		this._profiles.push(p);
		return p;
	}

	async setProfile(profile: IUserDataProfile): Promise<void> {
		if (this._currentProfile !== profile) {
			this._currentProfile = profile;
			this._onDidChangeCurrentProfile.fire(profile);
		}
	}

	dispose(): void {
		this._onDidChangeCurrentProfile.dispose();
	}
}
