/**
 * Dardcor Code - User Profile Exporter (Task 177)
 * Mirrors: vs/platform/userDataProfile/common/userDataProfile.ts export/import
 */

import { IUserDataProfile } from './user-profile-service';

export interface IExportedUserProfile {
	name: string;
	settings?: string;
	keybindings?: string;
	extensions?: string[];
}

export function exportUserProfile(profile: IUserDataProfile, settingsJson?: string, keybindingsJson?: string, extensionIds?: string[]): string {
	const exported: IExportedUserProfile = {
		name: profile.name,
		settings: settingsJson,
		keybindings: keybindingsJson,
		extensions: extensionIds,
	};
	return JSON.stringify(exported, null, 2);
}

export function parseExportedUserProfile(jsonText: string): IExportedUserProfile | null {
	try {
		const obj = JSON.parse(jsonText);
		if (!obj.name) return null;
		return obj as IExportedUserProfile;
	} catch {
		return null;
	}
}
