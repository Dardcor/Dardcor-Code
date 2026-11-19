/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { printBanner, spawnCodesignProcess, streamProcessOutputAndCheckResult } from '../common/codesign.ts';
import { e } from '../common/publish.ts';

async function main() {
	const esrpCliDLLPath = e('EsrpCliDllPath');

	const codesignTask1 = spawnCodesignProcess(esrpCliDLLPath, 'sign-pgp', '.build/linux/deb', '*.deb');
	const codesignTask2 = spawnCodesignProcess(esrpCliDLLPath, 'sign-pgp', '.build/linux/rpm', '*.rpm');

	printBanner('Codesign deb package');
	await streamProcessOutputAndCheckResult('Codesign deb package', codesignTask1);

	printBanner('Codesign rpm package');
	await streamProcessOutputAndCheckResult('Codesign rpm package', codesignTask2);
}

main().then(() => {
	process.exit(0);
}, err => {
	console.error(`ERROR: ${err}`);
	process.exit(1);
});
