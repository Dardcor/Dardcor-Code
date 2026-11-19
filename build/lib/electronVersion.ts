import fs from 'fs';
import path from 'path';

export function getElectronVersion(root: string): Record<string, string> {
	const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	const legacyNpmrcPath = path.join(root, '.npmrc');
	const legacyNpmrc = fs.existsSync(legacyNpmrcPath) ? fs.readFileSync(legacyNpmrcPath, 'utf8') : '';
	const electronVersion = /^(?:npm_config_)?target="(.*)"$/m.exec(legacyNpmrc)?.[1] ?? packageJson.devDependencies?.electron;
	const msBuildId = /^(?:npm_config_)?ms_build_id="(.*)"$/m.exec(legacyNpmrc)?.[1] ?? packageJson.dardcorBuild?.electronMsBuildId ?? '';
	if (typeof electronVersion !== 'string' || !electronVersion.trim()) {
		throw new Error('Could not resolve the Electron version from package.json devDependencies.');
	}
	return { electronVersion, msBuildId };
}
