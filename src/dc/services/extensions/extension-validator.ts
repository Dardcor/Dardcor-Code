/**
 * Dardcor Code - Extension Runtime Validator (Task 197)
 * Mirrors: vs/platform/extensionManagement/common/extensionValidator.ts
 */

import { IExtensionManifest } from './extension-scanner';
import { parseSemVer, compareSemVer } from '../../core/types/semantic-version';

export interface IValidationResult {
	valid: boolean;
	reasons: string[];
}

export function validateExtensionManifest(manifest: IExtensionManifest, hostVersion = '1.0.0'): IValidationResult {
	const reasons: string[] = [];

	if (!manifest.name) reasons.push('Missing extension name');
	if (!manifest.version) reasons.push('Missing extension version');
	if (!manifest.publisher) reasons.push('Missing extension publisher');

	if (manifest.engines) {
		const req = manifest.engines['dardcor-code'] || manifest.engines.vscode;
		if (req && req !== '*') {
			const minVerStr = req.replace(/^[^\d]+/, '');
			const minVer = parseSemVer(minVerStr);
			const hostVer = parseSemVer(hostVersion);
			if (minVer && hostVer && compareSemVer(hostVer, minVer) < 0) {
				reasons.push(`Host version ${hostVersion} is older than required ${req}`);
			}
		}
	}

	return {
		valid: reasons.length === 0,
		reasons,
	};
}
