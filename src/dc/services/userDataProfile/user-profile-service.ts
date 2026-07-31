/**
 * Dardcor Code - User Profile Service (Task 148)
 * Mirrors: vs/platform/userDataProfile/common/userDataProfile.ts (profile state switcher)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';

export interface IUserDataProfile {
	readonly id: string;
	readonly name: string;
	readonly location: URI;
	readonly isDefault: boolean;
	readonly settingsResource: URI;
	readonly keybindingsResource: URI;
	readonly extensionsResource: URI;
}

export const IUserDataProfileService = createDecorator<IUserDataProfileService>('userDataProfileService');

export interface IUserDataProfileService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeCurrentProfile: Event<IUserDataProfile>;
	readonly currentProfile: IUserDataProfile;
	readonly profiles: IUserDataProfile[];
	createProfile(name: string): Promise<IUserDataProfile>;
	setProfile(profile: IUserDataProfile): Promise<void>;
	deleteProfile(profile: IUserDataProfile): Promise<boolean>;
}

function profileResources(location: URI): Pick<IUserDataProfile, 'settingsResource' | 'keybindingsResource' | 'extensionsResource'> {
	return {
		settingsResource: URI.from({ scheme: location.scheme, path: `${location.path}/settings.json` }),
		keybindingsResource: URI.from({ scheme: location.scheme, path: `${location.path}/keybindings.json` }),
		extensionsResource: URI.from({ scheme: location.scheme, path: `${location.path}/extensions.json` }),
	};
}

export class UserDataProfileService extends Disposable implements IUserDataProfileService {
	declare readonly _serviceBrand: undefined;

	private _currentProfile: IUserDataProfile;
	private readonly _profiles: IUserDataProfile[] = [];

	private readonly _onDidChangeCurrentProfile = this._register(new Emitter<IUserDataProfile>());
	readonly onDidChangeCurrentProfile: Event<IUserDataProfile> = this._onDidChangeCurrentProfile.event;

	constructor(defaultProfileLocation: URI) {
		super();
		this._currentProfile = {
			id: 'default',
			name: 'Default',
			location: defaultProfileLocation,
			isDefault: true,
			...profileResources(defaultProfileLocation),
		};
		this._profiles.push(this._currentProfile);
	}

	get currentProfile(): IUserDataProfile {
		return this._currentProfile;
	}

	get profiles(): IUserDataProfile[] {
		return [...this._profiles];
	}

	async createProfile(name: string): Promise<IUserDataProfile> {
		const id = name.toLowerCase().replace(/\s+/g, '-');
		const location = URI.from({
			scheme: this._currentProfile.location.scheme,
			path: `${this._currentProfile.location.path}/profiles/${id}`,
		});
		const profile: IUserDataProfile = {
			id,
			name,
			location,
			isDefault: false,
			...profileResources(location),
		};
		this._profiles.push(profile);
		return profile;
	}

	async setProfile(profile: IUserDataProfile): Promise<void> {
		if (this._currentProfile !== profile) {
			this._currentProfile = profile;
			this._onDidChangeCurrentProfile.fire(profile);
		}
	}

	async deleteProfile(profile: IUserDataProfile): Promise<boolean> {
		if (profile.isDefault || profile === this._currentProfile) {
			return false;
		}
		const idx = this._profiles.indexOf(profile);
		if (idx < 0) {
			return false;
		}
		this._profiles.splice(idx, 1);
		return true;
	}
}
