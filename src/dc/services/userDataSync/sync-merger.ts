/**
 * Dardcor Code - Sync Conflict Merger (Task 178)
 * Mirrors: vs/platform/userDataSync/common/settingsMerge.ts 3-way conflict resolver
 */

export interface IMergeResult {
	merged: string;
	hasConflicts: boolean;
}

export function mergeSettings(baseJson: string, localJson: string, remoteJson: string): IMergeResult {
	try {
		const base = baseJson ? JSON.parse(baseJson) : {};
		const local = localJson ? JSON.parse(localJson) : {};
		const remote = remoteJson ? JSON.parse(remoteJson) : {};

		const merged: Record<string, any> = { ...base };
		let hasConflicts = false;

		const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);
		for (const key of allKeys) {
			const lVal = local[key];
			const rVal = remote[key];
			const bVal = base[key];

			if (JSON.stringify(lVal) === JSON.stringify(rVal)) {
				merged[key] = lVal;
			} else if (JSON.stringify(lVal) === JSON.stringify(bVal)) {
				merged[key] = rVal; // remote changed, local untouched
			} else if (JSON.stringify(rVal) === JSON.stringify(bVal)) {
				merged[key] = lVal; // local changed, remote untouched
			} else {
				// Both modified differently: remote wins by default, mark conflict
				merged[key] = rVal;
				hasConflicts = true;
			}
		}

		return {
			merged: JSON.stringify(merged, null, 2),
			hasConflicts,
		};
	} catch {
		return { merged: remoteJson || localJson || '{}', hasConflicts: true };
	}
}
