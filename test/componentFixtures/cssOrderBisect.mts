/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bisectConflict, readServeUrl, Renderer } from './cssOrderShared.mts';

interface Args {
	readonly config: string;
	readonly fixtureRegex: string;
	readonly keep: boolean;
}

function parseArgs(argv: readonly string[]): Args {
	const get = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
	};
	const here = dirname(fileURLToPath(import.meta.url));
	const fixtureRegex = get('fixture-id-regex');
	if (!fixtureRegex) {
		throw new Error('Missing required --fixture-id-regex <pattern>');
	}
	return {
		config: resolve(get('config') ?? join(here, 'component-explorer-attach.json')),
		fixtureRegex,
		keep: argv.includes('--keep'),
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const configDir = dirname(args.config);
	const serveUrl = await readServeUrl(args.config);

	process.stdout.write(`Serve:   ${serveUrl ?? '(from config)'}\n`);
	process.stdout.write(`Fixture: ${args.fixtureRegex}\n`);

	const probeRoot = join(configDir, '.build', 'css-bisect', 'bisect');
	await rm(probeRoot, { recursive: true, force: true });
	await mkdir(probeRoot, { recursive: true });
	const renderer = new Renderer(args.config, probeRoot);

	const baselineEntries = (await renderer.render(args.fixtureRegex, { outputStylesheetFiles: true })).entries;
	if (baselineEntries.length === 0) {
		throw new Error(`No fixtures matched ${args.fixtureRegex}`);
	}
	const baselineEntry = baselineEntries[0];
	const files = baselineEntry.output?.stylesheetFiles;
	if (!files || files.length === 0) {
		throw new Error('Fixture did not report `output.stylesheetFiles`; rebuild the serve so it includes the runtime change.');
	}
	const n = files.length;
	const baseline = baselineEntry.imageHash;
	if (!baseline) {
		throw new Error('Baseline render produced no image.');
	}
	process.stdout.write(`Bundle:  ${n} documents (reported by the fixture runtime)\n\n`);

	const reversed = await renderer.hash(args.fixtureRegex, { fromIndex: 0, toIndex: n });
	process.stdout.write(`baseline (no reversal): ${baseline.slice(0, 12)}\n`);
	process.stdout.write(`full reversal:          ${reversed.slice(0, 12)}\n\n`);

	if (baseline === reversed) {
		process.stdout.write('No order-dependency detected: full reversal does not change the rendering.\n');
		if (!args.keep) {
			await rm(probeRoot, { recursive: true, force: true });
		}
		return;
	}

	const probesPerPhase = Math.ceil(Math.log2(n)) + 1;
	process.stdout.write(`Localizing the conflicting documents (~${2 * probesPerPhase} probes)...\n`);
	let probeCount = 0;
	const { later, earlier } = await bisectConflict(renderer, baselineEntry.fixtureId, n, baseline, ({ fromIndex, toIndex, differs, ms }) => {
		const verdict = differs ? 'DIFFERS' : 'same as baseline';
		process.stdout.write(`  probe #${++probeCount}: reverse[${fromIndex}, ${toIndex}) -> ${verdict} (${ms}ms)\n`);
	});

	process.stdout.write('\nOrder-dependency localized between two documents:\n');
	process.stdout.write(`  doc ${earlier}: ${files[earlier] ?? '(out of range)'}\n`);
	process.stdout.write(`  doc ${later}: ${files[later] ?? '(out of range)'}\n`);
	process.stdout.write('\nProduct order renders these with the later document winning the cascade tie.\n');

	if (!args.keep) {
		await rm(probeRoot, { recursive: true, force: true });
	}
}

main().catch(err => {
	process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
	process.exitCode = 1;
});
