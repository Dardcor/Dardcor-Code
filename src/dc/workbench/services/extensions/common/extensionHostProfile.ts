import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostProfile {
	readonly id: string;
	readonly name: string;
	readonly isActive: boolean;
}

export interface IExtensionHostProfileService {
	readonly onDidChangeProfile: Event<IExtensionHostProfile>;
	getCurrentProfile(): IExtensionHostProfile;
	switchProfile(profileId: string): void;
	getProfiles(): IExtensionHostProfile[];
}

export class ExtensionHostProfileService implements IExtensionHostProfileService {
	private _profiles: IExtensionHostProfile[] = [
		{ id: 'default', name: 'Default', isActive: true }
	];
	
	private readonly _onDidChangeProfile = new Emitter<IExtensionHostProfile>();
	readonly onDidChangeProfile = this._onDidChangeProfile.event;

	getCurrentProfile(): IExtensionHostProfile {
		return this._profiles.find(p => p.isActive) || this._profiles[0];
	}

	switchProfile(profileId: string): void {
		const target = this._profiles.find(p => p.id === profileId);
		if (target) {
			this._profiles.forEach(p => {
				(p as any).isActive = (p.id === profileId);
			});
			this._onDidChangeProfile.fire(target);
		}
	}

	getProfiles(): IExtensionHostProfile[] {
		return this._profiles;
	}
}
