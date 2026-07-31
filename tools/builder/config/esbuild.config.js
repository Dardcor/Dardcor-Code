/**
 * Dardcor Code - Main JS/TS Bundling Configuration (Task 906)
 *
 * Shared configuration data consumed by the bundler scripts
 * (bundle-app-shell.mjs, bundle-extension-host.mjs) and any CI step.
 * No external imports - kept as plain data so it can be loaded
 * without esbuild being installed.
 */

const root = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

/** @type {Array<{name: string, entry: string, platform: string, format: string, target: string}>} */
const targets = [
	{
		name: 'app-shell',
		entry: `${root}/src/dc/main.ts`,
		platform: 'browser',
		format: 'esm',
		target: 'es2022',
	},
	{
		name: 'web-workbench',
		entry: `${root}/src/dc/app-shell/layout/workbench-layout.ts`,
		platform: 'browser',
		format: 'esm',
		target: 'es2022',
	},
	{
		name: 'extension-host',
		entry: `${root}/src/dc/extension-api/index.ts`,
		platform: 'browser',
		format: 'esm',
		target: 'es2022',
		conditions: ['worker'],
	},
	{
		name: 'electron-main',
		entry: `${root}/src/dc/launcher/main/electron-main.ts`,
		platform: 'node',
		format: 'esm',
		target: 'es2022',
		external: ['electron'],
	},
];

/** @type {{targets: typeof targets, shared: object, aliases: object}} */
const config = {
	targets,
	shared: {
		sourcemap: true,
		minify: false,
		legalComments: 'eof',
	},
	aliases: {
		'@dc': `${root}/src/dc`,
	},
};

export default config;
