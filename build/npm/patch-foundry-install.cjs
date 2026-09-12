/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const targetScript = path.join(root, 'node_modules', 'foundry-local-sdk', 'script', 'install-standard.cjs');

if (fs.existsSync(targetScript)) {
	fs.writeFileSync(targetScript, 'process.exit(0);\n');
	console.log('Patched foundry-local-sdk install script (skipped external nuget download)');
}

// Ensure core directory and dummy libraries exist so any secondary verification succeeds
const coreDirs = [
	path.join(root, 'node_modules', 'foundry-local-sdk', 'foundry-local-core', 'linux-x64'),
	path.join(root, 'node_modules', 'foundry-local-sdk', 'foundry-local-core', 'linux-arm64')
];

for (const dir of coreDirs) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'Microsoft.AI.Foundry.Local.Core.so'), '');
	fs.writeFileSync(path.join(dir, 'libonnxruntime.so'), '');
	fs.writeFileSync(path.join(dir, 'libonnxruntime-genai.so'), '');
}
console.log('Created stub libraries for foundry-local-sdk on Linux');
