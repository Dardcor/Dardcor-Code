/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger } from '../../../../automation';
import { installAllHandlers } from '../../utils';

export function setup(logger: Logger) {
	describe('Extensions', () => {

		installAllHandlers(logger, opts => {
			opts.verbose = true;
			opts.snapshots = true;
			return opts;
		});

		it.skip('install and enable vscode-smoketest-check extension', async function () {
			const app = this.app as Application;

			await app.workbench.extensions.installExtension('ms-vscode.vscode-smoketest-check', true);

			await app.workbench.extensions.closeExtension('vscode-smoketest-check');

			await app.workbench.quickaccess.runCommand('Smoke Test Check');
		});
	});
}
