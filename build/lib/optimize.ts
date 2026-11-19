/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import es from 'event-stream';
import { gulp, filter, sourcemaps, svgmin } from './gulp/facade.ts';
import path from 'path';
import fs from 'fs';
import pump from 'pump';
import VinylFile from 'vinyl';
import * as bundle from './bundle.ts';
import esbuild from 'esbuild';
import fancyLog from 'fancy-log';
import ansiColors from 'ansi-colors';
import { getTargetStringFromTsConfig } from './tsconfigUtils.ts';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

declare module 'gulp-sourcemaps' {
	interface WriteOptions {
		addComment?: boolean;
		includeContent?: boolean;
		sourceRoot?: string | WriteMapper;
		sourceMappingURL?: ((f: any) => string);
		sourceMappingURLPrefix?: string | WriteMapper;
		clone?: boolean | CloneOptions;
	}
}

const REPO_ROOT_PATH = path.join(import.meta.dirname, '../..');

export interface IBundleESMTaskOpts {
	src: string;
	entryPoints: Array<bundle.IEntryPoint | string>;
	resources?: string[];
	fileContentMapper?: (path: string) => ((contents: string) => Promise<string> | string) | undefined;
	skipTSBoilerplateRemoval?: (entryPointName: string) => boolean;
}

const DEFAULT_FILE_HEADER = [
	'/*!--------------------------------------------------------',
	' * Copyright (C) Dardcor Corporation. All rights reserved.',
	' *--------------------------------------------------------*/'
].join('\n');

function bundleESMTask(opts: IBundleESMTaskOpts): NodeJS.ReadWriteStream {
	const resourcesStream = es.through();
	const bundlesStream = es.through();

	const target = getBuildTarget();

	const entryPoints = opts.entryPoints.map(entryPoint => {
		if (typeof entryPoint === 'string') {
			return { name: path.parse(entryPoint).name };
		}

		return entryPoint;
	});

	const bundleAsync = async () => {
		const files: VinylFile[] = [];
		const tasks: Promise<any>[] = [];

		for (const entryPoint of entryPoints) {
			fancyLog(`Bundled entry point: ${ansiColors.yellow(entryPoint.name)}...`);

			const dest = entryPoint.dest?.replace(/\.[^/.]+$/, '') ?? entryPoint.name;

			const banner = {
				js: DEFAULT_FILE_HEADER,
				css: DEFAULT_FILE_HEADER
			};

			if (!opts.skipTSBoilerplateRemoval?.(entryPoint.name)) {
				const tslibPath = path.join(require.resolve('tslib'), '../tslib.es6.js');
				banner.js += await fs.promises.readFile(tslibPath, 'utf-8');
			}

			const contentsMapper: esbuild.Plugin = {
				name: 'contents-mapper',
				setup(build) {
					build.onLoad({ filter: /\.js$/ }, async ({ path }) => {
						const contents = await fs.promises.readFile(path, 'utf-8');

						let newContents: string;
						if (!opts.skipTSBoilerplateRemoval?.(entryPoint.name)) {
							newContents = bundle.removeAllTSBoilerplate(contents);
						} else {
							newContents = contents;
						}

						const mapper = opts.fileContentMapper?.(path.replace(/\\/g, '/'));
						if (mapper) {
							newContents = await mapper(newContents);
						}

						return { contents: newContents };
					});
				}
			};

			const externalOverride: esbuild.Plugin = {
				name: 'external-override',
				setup(build) {
					build.onResolve({ filter: /^minimist$/ }, () => {
						return { path: path.join(REPO_ROOT_PATH, 'node_modules', 'minimist', 'index.js'), external: false };
					});
				},
			};

			const task = esbuild.build({
				bundle: true,
				packages: 'external',
				platform: 'neutral',
				format: 'esm',
				sourcemap: 'external',
				plugins: [contentsMapper, externalOverride],
				target: [target],
				loader: {
					'.ttf': 'file',
					'.svg': 'file',
					'.png': 'file',
					'.sh': 'file',
				},
				assetNames: 'media/[name]',
				banner,
				entryPoints: [
					{
						in: path.join(REPO_ROOT_PATH, opts.src, `${entryPoint.name}.js`),
						out: dest,
					}
				],
				outdir: path.join(REPO_ROOT_PATH, opts.src),
				write: false,
				metafile: true,
			}).then(res => {
				for (const file of res.outputFiles) {
					let sourceMapFile: esbuild.OutputFile | undefined = undefined;
					if (file.path.endsWith('.js')) {
						sourceMapFile = res.outputFiles.find(f => f.path === `${file.path}.map`);
					}

					const fileProps = {
						contents: Buffer.from(file.contents),
						sourceMap: sourceMapFile ? JSON.parse(sourceMapFile.text) : undefined,
						path: file.path,
						base: path.join(REPO_ROOT_PATH, opts.src)
					};
					files.push(new VinylFile(fileProps));
				}
			});

			tasks.push(task);
		}

		await Promise.all(tasks);
		return { files };
	};

	bundleAsync().then((output) => {

		es.readArray(output.files).pipe(bundlesStream);

		gulp.src(opts.resources ?? [], { base: `${opts.src}`, allowEmpty: true }).pipe(resourcesStream);
	});

	const result = es.merge(
		bundlesStream,
		resourcesStream
	);

	return result
		.pipe(sourcemaps.write('./', {
			sourceRoot: undefined,
			addComment: true,
			includeContent: true
		}));
}

export interface IBundleTaskOpts {
	out: string;
	esm: IBundleESMTaskOpts;
}

export function bundleTask(opts: IBundleTaskOpts): () => NodeJS.ReadWriteStream {
	return function () {
		return bundleESMTask(opts.esm).pipe(gulp.dest(opts.out));
	};
}

export function minifyTask(src: string, sourceMapBaseUrl?: string): (cb: any) => void {
	const sourceMappingURL = sourceMapBaseUrl ? ((f: any) => `${sourceMapBaseUrl}/${f.relative}.map`) : undefined;
	const target = getBuildTarget();

	return cb => {

		const esbuildFilter = filter('**/*.{js,css}', { restore: true });
		const svgFilter = filter('**/*.svg', { restore: true });

		pump(
			gulp.src([src + '/**', '!' + src + '/**/*.map']),
			esbuildFilter,
			sourcemaps.init({ loadMaps: true }),
			es.map((f: any, cb) => {
				esbuild.build({
					entryPoints: [f.path],
					minify: true,
					sourcemap: 'external',
					outdir: '.',
					packages: 'external',
					platform: 'neutral',
					target: [target],
					write: false,
				}).then(res => {
					const jsOrCSSFile = res.outputFiles.find(f => /\.(js|css)$/.test(f.path))!;
					const sourceMapFile = res.outputFiles.find(f => /\.(js|css)\.map$/.test(f.path))!;

					const contents = Buffer.from(jsOrCSSFile.contents);
					const unicodeMatch = contents.toString().match(/[^\x00-\xFF]+/g);
					if (unicodeMatch) {
						cb(new Error(`Found non-ascii character ${unicodeMatch[0]} in the minified output of ${f.path}. Non-ASCII characters in the output can cause performance problems when loading. Please review if you have introduced a regular expression that esbuild is not automatically converting and convert it to using unicode escape sequences.`));
					} else {
						f.contents = contents;
						f.sourceMap = JSON.parse(sourceMapFile.text);

						cb(undefined, f);
					}
				}, cb);
			}),
			esbuildFilter.restore,
			svgFilter,
			svgmin(),
			svgFilter.restore,
			sourcemaps.write('./', {
				sourceMappingURL,
				sourceRoot: undefined,
				includeContent: true,
				addComment: true
			}),
			gulp.dest(src + '-min'),
			(err: any) => cb(err));
	};
}

function getBuildTarget() {
	const tsconfigPath = path.join(REPO_ROOT_PATH, 'src', 'tsconfig.base.json');
	return getTargetStringFromTsConfig(tsconfigPath);
}

