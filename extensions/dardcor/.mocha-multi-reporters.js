/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const path = require('path');

const commandToBundleName = {
	isolatedProxyTests: 'IsolatedProxy',
	reverseProxyTests: 'ReverseProxy',
	test: 'LSPClient',
	'test:agent': 'Agent',
	'test:lib': 'Lib',
	'test:lib-e2e': 'LibEndToEnd',
};

const config = {
	reporterEnabled: 'spec',
};

if (process.env.CI) {
	const bundleName = commandToBundleName[process.env.npm_lifecycle_event] || 'Unit';
	config.reporterEnabled += ', mocha-junit-reporter';
	config.mochaJunitReporterReporterOptions = {
		testCaseSwitchClassnameAndName: true,
		testsuitesTitle: `Dardcor ${bundleName} Tests`,
		mochaFile: path.resolve(__dirname, `test-results-${bundleName}.xml`),
	};
}

module.exports = config;
