/**
 * Dardcor Code - SemVer Parser (Task 93)
 * Mirrors: vs/base/common/semver/
 */

export interface ISemVer {
	major: number;
	minor: number;
	patch: number;
	preRelease?: string;
	buildMetadata?: string;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?(?:\+([a-zA-Z0-9.]+))?$/;

export function parseSemVer(version: string): ISemVer | null {
	const m = SEMVER_RE.exec(version.trim());
	if (!m) return null;
	return {
		major: parseInt(m[1], 10),
		minor: parseInt(m[2], 10),
		patch: parseInt(m[3], 10),
		preRelease: m[4],
		buildMetadata: m[5],
	};
}

export function compareSemVer(a: ISemVer, b: ISemVer): number {
	if (a.major !== b.major) return a.major - b.major;
	if (a.minor !== b.minor) return a.minor - b.minor;
	if (a.patch !== b.patch) return a.patch - b.patch;
	if (a.preRelease && !b.preRelease) return -1;
	if (!a.preRelease && b.preRelease) return 1;
	if (a.preRelease && b.preRelease) return a.preRelease.localeCompare(b.preRelease);
	return 0;
}

export function satisfies(version: string, range: string): boolean {
	const v = parseSemVer(version);
	if (!v) return false;
	if (range === '*') return true;
	if (range.startsWith('>=')) { const t = parseSemVer(range.substring(2)); return !!t && compareSemVer(v, t) >= 0; }
	if (range.startsWith('>')) { const t = parseSemVer(range.substring(1)); return !!t && compareSemVer(v, t) > 0; }
	if (range.startsWith('<=')) { const t = parseSemVer(range.substring(2)); return !!t && compareSemVer(v, t) <= 0; }
	if (range.startsWith('<')) { const t = parseSemVer(range.substring(1)); return !!t && compareSemVer(v, t) < 0; }
	if (range.startsWith('^')) {
		const t = parseSemVer(range.substring(1));
		if (!t) return false;
		if (v.major !== t.major) return false;
		return compareSemVer(v, t) >= 0;
	}
	if (range.startsWith('~')) {
		const t = parseSemVer(range.substring(1));
		if (!t) return false;
		if (v.major !== t.major || v.minor !== t.minor) return false;
		return v.patch >= t.patch;
	}
	const t = parseSemVer(range);
	return !!t && compareSemVer(v, t) === 0;
}

export function formatSemVer(v: ISemVer): string {
	let s = `${v.major}.${v.minor}.${v.patch}`;
	if (v.preRelease) s += `-${v.preRelease}`;
	if (v.buildMetadata) s += `+${v.buildMetadata}`;
	return s;
}
