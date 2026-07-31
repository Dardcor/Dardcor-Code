/**
 * Dardcor Code - Workspace Configuration File Format (Task 168)
 * Mirrors: vs/platform/workspaces/common/workspaces.ts `.dc-workspace` schema
 */

export interface IWorkspaceConfigFile {
	folders: Array<{ path: string; name?: string }>;
	settings?: Record<string, any>;
	extensions?: {
		recommendations?: string[];
	};
}

export function parseWorkspaceConfigFile(jsonText: string): IWorkspaceConfigFile | null {
	try {
		const parsed = JSON.parse(jsonText);
		if (!Array.isArray(parsed.folders)) return null;
		return {
			folders: parsed.folders,
			settings: parsed.settings,
			extensions: parsed.extensions,
		};
	} catch {
		return null;
	}
}

export function serializeWorkspaceConfigFile(config: IWorkspaceConfigFile): string {
	return JSON.stringify(config, null, 2);
}
