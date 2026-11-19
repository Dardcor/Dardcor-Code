/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import cp from 'child_process';
import es from 'event-stream';
import fs from 'fs';
import { filter } from './lib/gulp/facade.ts';
import pall from 'p-all';
import path from 'path';
import VinylFile from 'vinyl';
import vfs from 'vinyl-fs';
import { all, copyrightFilter, eslintFilter, indentationFilter, stylelintFilter, tsFormattingFilter, unicodeFilter } from './filters.ts';
import eslint from './gulp-eslint.ts';
import * as formatter from './lib/formatter.ts';
import gulpstylelint from './stylelint.ts';

const copyrightHeaderLines = [
	'/*---------------------------------------------------------------------------------------------',
	' *  Copyright (c) Dardcor Corporation. All rights reserved.',
	' *  Licensed under the MIT License. See License.txt in the project root for license information.',
	' *--------------------------------------------------------------------------------------------*/',
];

interface VinylFileWithLines extends VinylFile {
	__lines: string[];
}

export function checkNoNewJavaScriptFiles(repoRoot: string): string | undefined {
	const allowlistPath = path.join(repoRoot, '.eslint-allowed-javascript-files');
	const allowed = new Set(
		fs.readFileSync(allowlistPath, 'utf8')
			.split(/\r\n|\n/)
			.map(line => line.trim())
			.filter(line => line && !line.startsWith('#'))
	);

	const out = cp.execSync('git ls-files "*.js" "*.cjs" "*.mjs"', {
		cwd: repoRoot,
		encoding: 'utf8',
		maxBuffer: 10 * 1024 * 1024,
	});
	const tracked = out.split(/\r?\n/).filter(line => !!line);

	const unknown = tracked.filter(file => !allowed.has(file));
	if (unknown.length > 0) {
		return [
			'New JavaScript files are not allowed. Use TypeScript (.ts) instead.',
			'If a file genuinely must be JavaScript, add it to .eslint-allowed-javascript-files',
			'(this requires CODEOWNERS review). Offending files:',
			...unknown.map(f => `  ${f}`),
		].join('\n');
	}
	return undefined;
}

export function hygiene(some: NodeJS.ReadWriteStream | string[] | undefined, runEslint = true): NodeJS.ReadWriteStream {
	console.log('Starting hygiene...');
	let errorCount = 0;

	const productJson = es.through(function (file: VinylFile) {
		const product = JSON.parse(file.contents!.toString('utf8'));

		if (product.extensionsGallery) {
			console.error(`product.json: Contains 'extensionsGallery'`);
			errorCount++;
		}

		this.emit('data', file);
	});

	const unicode = es.through(function (file: VinylFileWithLines) {
		const lines = file.contents!.toString('utf8').split(/\r\n|\r|\n/);
		file.__lines = lines;
		const allowInComments = lines.some(line => /allow-any-unicode-comment-file/.test(line));
		let skipNext = false;
		lines.forEach((line, i) => {
			if (/allow-any-unicode-next-line/.test(line)) {
				skipNext = true;
				return;
			}
			if (skipNext) {
				skipNext = false;
				return;
			}
			if (allowInComments) {
				if (line.match(/\s+(\*)/)) {
					line = '';
				} else {
					const index = line.indexOf('//');
					line = index === -1 ? line : line.substring(0, index);
				}
			}
			// eslint-disable-next-line no-misleading-character-class
			const m = /([^\t\n\r\x20-\x7E⊃⊇✔︎✓🎯🧪✍️⚠️🛑🔴🚗🚙🚕🎉✨❗⇧⌥⌘×÷¦⋯…↑↓￫→←↔⟷—·•●◆▼⟪⟫┌└├⏎↩√φ]+)/g.exec(line);
			if (m) {
				console.error(
					file.relative + `(${i + 1},${m.index + 1}): Unexpected unicode character: "${m[0]}" (charCode: ${m[0].charCodeAt(0)}). To suppress, use // allow-any-unicode-next-line`
				);
				errorCount++;
			}
		});

		this.emit('data', file);
	});

	const indentation = es.through(function (file: VinylFileWithLines) {
		const lines = file.__lines || file.contents!.toString('utf8').split(/\r\n|\r|\n/);
		file.__lines = lines;

		lines.forEach((line, i) => {
			if (/^\s*$/.test(line)) {
			} else if (/^[\t]*[^\s]/.test(line)) {
			} else if (/^[\t]* \*/.test(line)) {
			} else {
				console.error(
					file.relative + '(' + (i + 1) + ',1): Bad whitespace indentation'
				);
				errorCount++;
			}
		});

		this.emit('data', file);
	});

	const copyrights = es.through(function (file: VinylFileWithLines) {
		const lines = file.__lines;

		for (let i = 0; i < copyrightHeaderLines.length; i++) {
			if (lines[i] !== copyrightHeaderLines[i]) {
				console.error(file.relative + ': Missing or bad copyright statement');
				errorCount++;
				break;
			}
		}

		this.emit('data', file);
	});

	const formatting = es.map(function (file: any, cb) {
		try {
			const rawInput = file.contents!.toString('utf8');
			if (!formatter.verifyFormatting(file.path, rawInput)) {
				console.error(
					`File not formatted. Run the 'Format Document' command to fix it:`,
					file.relative
				);
				errorCount++;
			}
			cb(undefined, file);
		} catch (err) {
			cb(err);
		}
	});

	let input: NodeJS.ReadWriteStream;
	if (Array.isArray(some) || typeof some === 'string' || !some) {
		const options = { base: '.', follow: true, allowEmpty: true };
		if (some) {
			input = vfs.src(some, options).pipe(filter(Array.from(all)));
		} else {
			input = vfs.src(Array.from(all), options);
		}
	} else {
		input = some;
	}

	const productJsonFilter = filter('product.json', { restore: true });
	const snapshotFilter = filter(['**', '!**/*.snap', '!**/*.snap.actual']);
	const yarnLockFilter = filter(['**', '!**/yarn.lock']);
	const unicodeFilterStream = filter(Array.from(unicodeFilter), { restore: true });

	const result = input
		.pipe(filter((f) => Boolean(f.stat && !f.stat.isDirectory())))
		.pipe(snapshotFilter)
		.pipe(yarnLockFilter)
		.pipe(productJsonFilter)
		.pipe(process.env['BUILD_SOURCEVERSION'] ? es.through() : productJson)
		.pipe(productJsonFilter.restore)
		.pipe(unicodeFilterStream)
		.pipe(unicode)
		.pipe(unicodeFilterStream.restore)
		.pipe(filter(Array.from(indentationFilter)))
		.pipe(indentation)
		.pipe(filter(Array.from(copyrightFilter)))
		.pipe(copyrights);

	const streams: NodeJS.ReadWriteStream[] = [
		result.pipe(filter(Array.from(tsFormattingFilter))).pipe(formatting)
	];

	if (runEslint) {
		streams.push(
			result
				.pipe(filter(Array.from(eslintFilter)))
				.pipe(
					eslint((results) => {
						errorCount += results.warningCount;
						errorCount += results.errorCount;
					})
				)
		);
	}

	streams.push(
		result.pipe(filter(Array.from(stylelintFilter))).pipe(gulpstylelint(((message: string, isError: boolean) => {
			if (isError) {
				console.error(message);
				errorCount++;
			} else {
				console.warn(message);
			}
		}), false, false))
	);

	let count = 0;
	return es.merge(...streams).pipe(
		es.through(
			function (data: unknown) {
				count++;
				if (process.env['TRAVIS'] && count % 10 === 0) {
					process.stdout.write('.');
				}
				this.emit('data', data);
			},
			function () {
				process.stdout.write('\n');
				if (errorCount > 0) {
					this.emit(
						'error',
						'Hygiene failed with ' +
						errorCount +
						` errors. Check 'build / gulpfile.hygiene.js'.`
					);
				} else {
					this.emit('end');
				}
			}
		)
	);
}

function createGitIndexVinyls(paths: string[]): Promise<VinylFile[]> {
	const repositoryPath = process.cwd();

	const fns = paths.map((relativePath) => () =>
		new Promise<VinylFile | null>((c, e) => {
			const fullPath = path.join(repositoryPath, relativePath);

			fs.stat(fullPath, (err, stat) => {
				if (err && err.code === 'ENOENT') {
					return c(null);
				} else if (err) {
					return e(err);
				}

				cp.exec(
					process.platform === 'win32' ? `git show :${relativePath}` : `git show ':${relativePath}'`,
					{ maxBuffer: Math.max(stat.size * 2, 1024 * 1024), encoding: 'buffer' },
					(err, out) => {
						if (err) {
							return e(err);
						}

						c(new VinylFile({
							path: fullPath,
							base: repositoryPath,
							contents: out,
							stat: stat,
						}));
					}
				);
			});
		})
	);

	return pall(fns, { concurrency: 4 }).then((r) => r.filter((p): p is VinylFile => !!p));
}

if (import.meta.main) {
	process.on('unhandledRejection', (reason: unknown, p: Promise<any>) => {
		console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
		process.exit(1);
	});

	if (process.argv.length > 2) {
		hygiene(process.argv.slice(2)).on('error', (err: Error) => {
			console.error();
			console.error(err);
			process.exit(1);
		});
	} else {
		cp.exec(
			'git diff --cached --name-only',
			{ maxBuffer: 2000 * 1024 },
			(err, out) => {
				if (err) {
					console.error();
					console.error(err);
					process.exit(1);
				}

				const some = out.split(/\r?\n/).filter((l) => !!l);

				if (some.length > 0) {
					if (some.some(f => /\.(js|cjs|mjs)$/.test(f) || f === '.eslint-allowed-javascript-files')) {
						const jsAllowlistError = checkNoNewJavaScriptFiles(process.cwd());
						if (jsAllowlistError) {
							console.error(jsAllowlistError);
							process.exit(1);
						}
					}

					console.log('Reading git index versions...');

					createGitIndexVinyls(some)
						.then(
							(vinyls) => {
								return new Promise<void>((c, e) =>
									hygiene(es.readArray(vinyls).pipe(filter(Array.from(all))))
										.on('end', () => c())
										.on('error', e)
								);
							}
						)
						.catch((err: Error) => {
							console.error();
							console.error(err);
							process.exit(1);
						});
				}
			}
		);
	}
}
