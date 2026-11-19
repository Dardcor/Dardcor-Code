/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const paths = require('path');
const glob = require('glob');
const tty = require('tty');
// @ts-ignore
if (!tty.getWindowSize) {
	// @ts-ignore
	tty.getWindowSize = function () { return [80, 75]; };
}
const Mocha = require('mocha');

let mocha = new Mocha({
	ui: 'tdd',
	color: true
});

exports.configure = function configure(opts) {
	if (process.env.MOCHA_GREP) {
		opts.grep = process.env.MOCHA_GREP;
	}
	mocha = new Mocha(opts);
};

exports.run = function run(testsRoot, clb) {
	require('source-map-support').install();

	glob('**/**.test.js', { cwd: testsRoot }, function (error, files) {
		if (error) {
			return clb(error);
		}
		try {
			files.forEach(function (f) { return mocha.addFile(paths.join(testsRoot, f)); });
			mocha.run(function (failures) {
				clb(null, failures);
			});
		}
		catch (error) {
			return clb(error);
		}
	});
};
