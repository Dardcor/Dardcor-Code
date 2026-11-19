/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bisectConflict, type FixtureEntry, readServeUrl, Renderer } from './cssOrderShared.mts';

interface Args {
	readonly config: string;
	readonly fixtureRegex: string;
	readonly out: string;
	readonly imageBaseUrl: string | undefined;
	readonly keep: boolean;
}

function parseArgs(argv: readonly string[]): Args {
	const get = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
	};
	const here = dirname(fileURLToPath(import.meta.url));
	const config = resolve(get('config') ?? join(here, 'component-explorer-attach.json'));
	return {
		config,
		fixtureRegex: get('fixture-id-regex') ?? '.*',
		out: resolve(get('out') ?? join(dirname(config), '.build', 'css-order-report')),
		imageBaseUrl: get('image-base-url'),
		keep: argv.includes('--keep'),
	};
}

interface Problem {
	readonly fixtureId: string;
	readonly background: 'light' | 'dark' | undefined;
	readonly labels: readonly string[];
	readonly docCount: number;
	readonly baselineHash: string;
	readonly reversedHash: string;
	readonly laterIndex: number;
	readonly laterFile: string;
	readonly earlierIndex: number;
	readonly earlierFile: string;
	readonly baselineImage: string | undefined;
	readonly reversedImage: string | undefined;
}

const GITHUB_SERVER = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY;
const GITHUB_SHA = process.env.GITHUB_SHA;

function toSourcePath(path: string): string {
	return path.startsWith('out/') ? `src/${path.slice('out/'.length)}` : path;
}

function fileLink(path: string): string {
	const src = toSourcePath(path);
	if (GITHUB_REPO && GITHUB_SHA) {
		return `[\`${src}\`](${GITHUB_SERVER}/${GITHUB_REPO}/blob/${GITHUB_SHA}/${src})`;
	}
	return `\`${src}\``;
}

function fileBaseName(path: string): string {
	const src = toSourcePath(path);
	return src.slice(src.lastIndexOf('/') + 1);
}

function slugify(fixtureId: string): string {
	return fixtureId.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function imageLink(args: Args, label: string, hash: string, relativePath: string | undefined): Promise<string | undefined> {
	if (!relativePath) {
		return undefined;
	}
	if (args.imageBaseUrl) {
		return `![${label}](${args.imageBaseUrl.replace(/\/$/, '')}/${hash})`;
	}
	return `![${label}](${relativePath})`;
}

async function renderMarkdown(args: Args, problems: readonly Problem[], totals: { scanned: number; errored: number }): Promise<string> {
	const lines: string[] = [];
	const clean = totals.scanned - problems.length - totals.errored;

	lines.push('# CSS Cascade-Order Dependency Report', '');
	lines.push(`- Generated: ${new Date().toISOString()}`);
	if (GITHUB_REPO && GITHUB_SHA) {
		lines.push(`- Commit: [\`${GITHUB_SHA.slice(0, 8)}\`](${GITHUB_SERVER}/${GITHUB_REPO}/commit/${GITHUB_SHA})`);
	}
	lines.push(`- Fixtures scanned: **${totals.scanned}**`);
	lines.push(`- Order-dependent: **${problems.length}**`);
	lines.push(`- Clean: **${clean}**`);
	lines.push(`- Errored / no image: **${totals.errored}**`, '');

	lines.push('> **How this works.** Each fixture is rendered normally and again with the');
	lines.push('> bundled CSS documents reversed. A changed screenshot means the appearance');
	lines.push('> depends on the source-concatenation order of two CSS files — a cascade tie');
	lines.push('> broken only by order. A binary search then localizes the two source files.');
	lines.push('> The later document (by product source order) currently wins the tie.');
	lines.push('>');
	lines.push('> **Caveats.** Detects the dominant conflicting pair per fixture; only flips');
	lines.push('> ties of equal specificity and importance; assumes no `@layer`.', '');

	if (problems.length === 0) {
		lines.push('No order-dependent fixtures detected. :tada:', '');
		return lines.join('\n');
	}

	const byFile = new Map<string, { fixtures: Set<string>; partners: Set<string> }>();
	const note = (file: string, partner: string, fixtureId: string) => {
		let entry = byFile.get(file);
		if (!entry) {
			entry = { fixtures: new Set(), partners: new Set() };
			byFile.set(file, entry);
		}
		entry.fixtures.add(fixtureId);
		entry.partners.add(partner);
	};
	for (const p of problems) {
		note(p.laterFile, p.earlierFile, p.fixtureId);
		note(p.earlierFile, p.laterFile, p.fixtureId);
	}

	lines.push('## Problematic CSS files', '');
	lines.push('| CSS source file | Fixtures affected | Conflicts with |');
	lines.push('| --- | ---: | --- |');
	const sortedFiles = [...byFile.entries()].sort((a, b) => b[1].fixtures.size - a[1].fixtures.size);
	for (const [file, entry] of sortedFiles) {
		const partners = [...entry.partners].map(fileBaseName).sort().join(', ');
		lines.push(`| ${fileLink(file)} | ${entry.fixtures.size} | ${partners} |`);
	}
	lines.push('');

	lines.push('## Affected fixtures', '');
	lines.push('| Fixture | Theme | Earlier doc (loses) | Later doc (wins) |');
	lines.push('| --- | --- | --- | --- |');
	for (const p of problems) {
		lines.push(`| \`${p.fixtureId}\` | ${p.background ?? '—'} | ${fileLink(p.earlierFile)} (#${p.earlierIndex}) | ${fileLink(p.laterFile)} (#${p.laterIndex}) |`);
	}
	lines.push('');

	lines.push('## Details', '');
	for (const p of problems) {
		lines.push(`### \`${p.fixtureId}\``, '');
		lines.push(`- Theme: ${p.background ?? '—'}`);
		if (p.labels.length > 0) {
			lines.push(`- Labels: ${p.labels.map(l => `\`${l}\``).join(', ')}`);
		}
		lines.push(`- Later document (wins): ${fileLink(p.laterFile)} — document #${p.laterIndex}`);
		lines.push(`- Earlier document (loses): ${fileLink(p.earlierFile)} — document #${p.earlierIndex}`);
		lines.push(`- Image hash: \`${p.baselineHash.slice(0, 12)}\` (baseline) → \`${p.reversedHash.slice(0, 12)}\` (reversed)`);

		const baseLink = await imageLink(args, 'baseline image', p.baselineHash, p.baselineImage);
		const revLink = await imageLink(args, 'reversed image', p.reversedHash, p.reversedImage);
		if (baseLink && revLink) {
			lines.push(`- Images: ${baseLink} (product order) · ${revLink} (reversed order)`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const configDir = dirname(args.config);
	const serveUrl = await readServeUrl(args.config);

	process.stdout.write(`Serve:   ${serveUrl ?? '(from config)'}\n`);
	process.stdout.write(`Fixtures: ${args.fixtureRegex}\n`);
	process.stdout.write(`Output:  ${args.out}\n\n`);

	const probeRoot = join(configDir, '.build', 'css-order-scan');
	await rm(probeRoot, { recursive: true, force: true });
	await mkdir(probeRoot, { recursive: true });
	await rm(args.out, { recursive: true, force: true });
	const assetsDir = join(args.out, 'assets');
	await mkdir(assetsDir, { recursive: true });
	const renderer = new Renderer(args.config, probeRoot);

	process.stdout.write('Rendering all fixtures (baseline)...\n');
	const baseline = await renderer.render(args.fixtureRegex, { outputStylesheetFiles: true }, { useHashPaths: false });
	process.stdout.write('Rendering all fixtures (reversed)...\n');
	const reversed = await renderer.render(args.fixtureRegex, { reverseStylesheets: true }, { useHashPaths: false });

	const reversedById = new Map<string, FixtureEntry>(reversed.entries.map(e => [e.fixtureId, e]));
	const candidates = baseline.entries.filter(base => {
		const rev = reversedById.get(base.fixtureId);
		return !base.hasError && base.imageHash && rev?.imageHash && base.imageHash !== rev.imageHash;
	});
	const errored = baseline.entries.filter(e => e.hasError || !e.imageHash).length;
	process.stdout.write(`\nScanned ${baseline.entries.length} fixtures: ${candidates.length} order-dependent, ${errored} errored/no-image.\n`);

	const problems: Problem[] = [];
	for (let i = 0; i < candidates.length; i++) {
		const base = candidates[i];
		const rev = reversedById.get(base.fixtureId)!;
		const files = base.output?.stylesheetFiles;
		if (!files || files.length === 0) {
			process.stderr.write(`::warning::${base.fixtureId} did not report stylesheetFiles; skipping.\n`);
			continue;
		}
		const n = files.length;
		process.stdout.write(`\n[${i + 1}/${candidates.length}] Localizing ${base.fixtureId} (${n} documents)...\n`);
		process.stdout.write(`  hashes: baseline=${base.imageHash} reversed=${rev.imageHash}\n`);
		let probeCount = 0;
		const { later, earlier } = await bisectConflict(renderer, base.fixtureId, n, base.imageHash!, ({ fromIndex, toIndex, differs, ms }) => {
			const verdict = differs ? 'DIFFERS' : 'same';
			process.stdout.write(`  probe #${++probeCount}: reverse[${fromIndex}, ${toIndex}) -> ${verdict} (${ms}ms)\n`);
		});

		const slug = slugify(base.fixtureId);
		let baselineImage: string | undefined;
		let reversedImage: string | undefined;
		if (base.imagePath) {
			baselineImage = `assets/${slug}.baseline.png`;
			await copyFile(join(baseline.targetDir, base.imagePath), join(args.out, baselineImage));
		}
		if (rev.imagePath) {
			reversedImage = `assets/${slug}.reversed.png`;
			await copyFile(join(reversed.targetDir, rev.imagePath), join(args.out, reversedImage));
		}

		problems.push({
			fixtureId: base.fixtureId,
			background: base.background,
			labels: base.labels ?? [],
			docCount: n,
			baselineHash: base.imageHash!,
			reversedHash: rev.imageHash!,
			laterIndex: later,
			laterFile: files[later] ?? '(out of range)',
			earlierIndex: earlier,
			earlierFile: files[earlier] ?? '(out of range)',
			baselineImage,
			reversedImage,
		});
		process.stdout.write(`  → #${earlier} ${fileBaseName(files[earlier] ?? '?')} loses to #${later} ${fileBaseName(files[later] ?? '?')}\n`);
	}

	const markdown = await renderMarkdown(args, problems, { scanned: baseline.entries.length, errored });
	await writeFile(join(args.out, 'report.md'), `${markdown}\n`, 'utf8');
	await writeFile(join(args.out, 'report.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), commit: GITHUB_SHA, scanned: baseline.entries.length, errored, problems }, undefined, '\t')}\n`, 'utf8');

	if (!args.keep) {
		await rm(probeRoot, { recursive: true, force: true });
	}

	process.stdout.write(`\nReport written to ${join(args.out, 'report.md')} (${problems.length} order-dependent fixtures).\n`);
}

main().catch(err => {
	process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
	process.exitCode = 1;
});
