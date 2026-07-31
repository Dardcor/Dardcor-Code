import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerUserDataProfile {
	readonly id: string;
	readonly isDefault: boolean;
	readonly name: string;
	readonly location: string;
	readonly settingsResource?: string;
	readonly keybindingsResource?: string;
	readonly tasksResource?: string;
	readonly snippetsHome?: string;
	readonly extensionsResource?: string;
	readonly useDefaultFlags?: {
		settings?: boolean;
		keybindings?: boolean;
		tasks?: boolean;
		snippets?: boolean;
		extensions?: boolean;
	};
}

export interface IServerUserDataProfileService {
	readonly onDidChangeCurrentProfile: Event<IServerUserDataProfile>;
	readonly onDidChangeProfiles: Event<{ added: IServerUserDataProfile[]; removed: IServerUserDataProfile[]; updated: IServerUserDataProfile[] }>;
	readonly currentProfile: IServerUserDataProfile;
	readonly profiles: IServerUserDataProfile[];
	createProfile(name: string, options?: { useDefaultFlags?: IServerUserDataProfile['useDefaultFlags'] }): Promise<IServerUserDataProfile>;
	updateProfile(profile: IServerUserDataProfile, update: { name?: string; useDefaultFlags?: IServerUserDataProfile['useDefaultFlags'] }): Promise<IServerUserDataProfile>;
	removeProfile(profile: IServerUserDataProfile): Promise<void>;
	setProfileForWorkspace(workspaceId: string, profile: IServerUserDataProfile): Promise<void>;
	getProfileForWorkspace(workspaceId: string): IServerUserDataProfile | undefined;
}

export class ServerUserDataProfileCommon implements IServerUserDataProfileService {
	private readonly _profiles = new Map<string, IServerUserDataProfile>();
	private _currentProfile: IServerUserDataProfile;
	private readonly _workspaceProfiles = new Map<string, string>();
	private _nextId = 1;

	private readonly _onDidChangeCurrentProfile = new Emitter<IServerUserDataProfile>();
	readonly onDidChangeCurrentProfile = this._onDidChangeCurrentProfile.event;

	private readonly _onDidChangeProfiles = new Emitter<{ added: IServerUserDataProfile[]; removed: IServerUserDataProfile[]; updated: IServerUserDataProfile[] }>();
	readonly onDidChangeProfiles = this._onDidChangeProfiles.event;

	constructor() {
		this._currentProfile = { id: 'default', isDefault: true, name: 'Default', location: 'default-profile' };
		this._profiles.set(this._currentProfile.id, this._currentProfile);
	}

	get currentProfile(): IServerUserDataProfile {
		return this._currentProfile;
	}

	get profiles(): IServerUserDataProfile[] {
		return Array.from(this._profiles.values());
	}

	async createProfile(name: string, options?: { useDefaultFlags?: IServerUserDataProfile['useDefaultFlags'] }): Promise<IServerUserDataProfile> {
		const id = `profile-${this._nextId++}`;
		const profile: IServerUserDataProfile = {
			id,
			isDefault: false,
			name,
			location: `profiles/${id}`,
			useDefaultFlags: options?.useDefaultFlags
		};
		this._profiles.set(id, profile);
		this._onDidChangeProfiles.fire({ added: [profile], removed: [], updated: [] });
		return profile;
	}

	async updateProfile(profile: IServerUserDataProfile, update: { name?: string; useDefaultFlags?: IServerUserDataProfile['useDefaultFlags'] }): Promise<IServerUserDataProfile> {
		const existing = this._profiles.get(profile.id);
		if (!existing) { throw new Error('Profile not found'); }
		const updated: IServerUserDataProfile = {
			...existing,
			name: update.name ?? existing.name,
			useDefaultFlags: update.useDefaultFlags ?? existing.useDefaultFlags
		};
		this._profiles.set(profile.id, updated);
		this._onDidChangeProfiles.fire({ added: [], removed: [], updated: [updated] });
		if (this._currentProfile.id === profile.id) {
			this._currentProfile = updated;
			this._onDidChangeCurrentProfile.fire(updated);
		}
		return updated;
	}

	async removeProfile(profile: IServerUserDataProfile): Promise<void> {
		if (profile.isDefault) { throw new Error('Cannot remove default profile'); }
		if (this._profiles.has(profile.id)) {
			this._profiles.delete(profile.id);
			this._onDidChangeProfiles.fire({ added: [], removed: [profile], updated: [] });
			if (this._currentProfile.id === profile.id) {
				this._currentProfile = this._profiles.get('default')!;
				this._onDidChangeCurrentProfile.fire(this._currentProfile);
			}
		}
	}

	async setProfileForWorkspace(workspaceId: string, profile: IServerUserDataProfile): Promise<void> {
		this._workspaceProfiles.set(workspaceId, profile.id);
		this._currentProfile = profile;
		this._onDidChangeCurrentProfile.fire(profile);
	}

	getProfileForWorkspace(workspaceId: string): IServerUserDataProfile | undefined {
		const profileId = this._workspaceProfiles.get(workspaceId);
		return profileId ? this._profiles.get(profileId) : undefined;
	}
}
