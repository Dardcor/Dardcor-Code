/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as net from 'net';
import * as ports from '../../node/ports.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';
import { flakySuite } from './testUtils.js';

flakySuite('Ports', () => {
	(process.env['VSCODE_PID'] ? test.skip : test)('Finds a free port (no timeout)', function (done) {

		ports.findFreePort(7000, 100, 300000).then(initialPort => {
			assert.ok(initialPort >= 7000);

			const server = net.createServer();
			server.listen(initialPort, undefined, undefined, () => {

				ports.findFreePort(7000, 50, 300000).then(freePort => {
					assert.ok(freePort >= 7000 && freePort !== initialPort);
					server.close();

					done();
				}, err => done(err));
			});
		}, err => done(err));
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
