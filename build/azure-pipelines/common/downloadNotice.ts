/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import type { ReadableStream } from 'stream/web';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { e, requestAZDOAPI } from './publish.ts';
import { retry } from './retry.ts';

const ARTIFACT_NAME = 'notice_output';
const QUALITY_JOB_NAMES = ['Quality Checks', 'Quality'];
const SHIPPING_NOTICE_NAME = 'ThirdPartyNotices.new.txt';
const TARGET_NOTICE = path.resolve('ThirdPartyNotices.txt');

const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 30_000;

function log(message: string): void {
	console.log(`[notice-cutover] [${new Date().toISOString()}] ${message}`);
}

interface TimelineRecord {
	readonly name: string;
	readonly type: string;
	readonly state: string;
	readonly result: string;
}

interface Timeline {
	readonly records: TimelineRecord[];
}

interface NoticeArtifact {
	readonly name: string;
	readonly resource: {
		readonly downloadUrl: string;
		readonly data?: string;
		readonly properties: {
			readonly artifactsize: number;
		};
	};
}

function installDiagnostics(): void {
	process.on('uncaughtException', err => {
		console.error('[notice-cutover] Uncaught exception:', err);
		process.exit(0);
	});
	process.on('unhandledRejection', reason => {
		console.error('[notice-cutover] Unhandled rejection:', reason);
		process.exit(0);
	});
	for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
		process.on(signal, () => {
			console.error(`[notice-cutover] Received ${signal}, exiting.`);
			process.exit(0);
		});
	}
}

function getAzdoFetchOptions() {
	return {
		headers: {
			'Accept': 'application/json;api-version=5.0-preview.1',
			'Accept-Encoding': 'gzip, deflate, br',
			'Accept-Language': 'en-US,en;q=0.9',
			'Referer': 'https://dev.azure.com',
			Authorization: `Bearer ${e('SYSTEM_ACCESSTOKEN')}`
		}
	};
}

async function getPipelineArtifacts(): Promise<NoticeArtifact[]> {
	const result = await requestAZDOAPI<{ readonly value: NoticeArtifact[] }>('artifacts');
	return result.value;
}

async function listArtifactFiles(artifact: NoticeArtifact): Promise<string[] | undefined> {
	const match = /^#\/(\d+)\/(.+)$/.exec(artifact.resource.data ?? '');
	if (!match) {
		return undefined;
	}

	const [, containerId, itemPath] = match;
	const collectionUri = e('SYSTEM_COLLECTIONURI').replace(/\/$/, '');
	const url = `${collectionUri}/_apis/resources/Containers/${containerId}?itemPath=${encodeURIComponent(itemPath)}&isShallow=false&api-version=4.1-preview.4`;

	const res = await retry(() => fetch(url, getAzdoFetchOptions()));
	if (!res.ok) {
		throw new Error(`Container items request failed: ${res.status}`);
	}

	const body = await res.json() as { readonly value: { readonly path: string; readonly itemType: string }[] };
	return body.value.filter(item => item.itemType === 'file').map(item => item.path);
}

async function getQualityJob(): Promise<TimelineRecord | undefined> {
	const timeline = await retry(() => requestAZDOAPI<Timeline>('timeline'));
	return timeline.records.find(r => r.type === 'Job' && QUALITY_JOB_NAMES.includes(r.name));
}

async function downloadArtifact(artifact: NoticeArtifact, downloadPath: string): Promise<void> {
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), 4 * 60 * 1000);

	try {
		const res = await fetch(artifact.resource.downloadUrl, { ...getAzdoFetchOptions(), signal: abortController.signal });

		if (!res.ok) {
			throw new Error(`Unexpected status code: ${res.status}`);
		}

		await pipeline(Readable.fromWeb(res.body as ReadableStream), fs.createWriteStream(downloadPath));
	} finally {
		clearTimeout(timeout);
	}
}

async function unzip(zipPath: string, outputPath: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
			if (err) {
				return reject(err);
			}

			const result: string[] = [];
			zipfile!.on('entry', entry => {
				if (/\/$/.test(entry.fileName)) {
					zipfile!.readEntry();
				} else {
					zipfile!.openReadStream(entry, (err, istream) => {
						if (err) {
							return reject(err);
						}

						const filePath = path.join(outputPath, entry.fileName);

						const resolvedOutput = path.resolve(outputPath);
						const resolvedTarget = path.resolve(filePath);
						if (resolvedTarget !== resolvedOutput && !resolvedTarget.startsWith(resolvedOutput + path.sep)) {
							return reject(new Error(`Zip entry escapes output directory (zip-slip): ${entry.fileName}`));
						}

						fs.mkdirSync(path.dirname(filePath), { recursive: true });

						const ostream = fs.createWriteStream(filePath);
						ostream.on('finish', () => {
							result.push(filePath);
							zipfile!.readEntry();
						});
						ostream.on('error', err => reject(err));
						istream?.on('error', err => reject(err));
						istream!.pipe(ostream);
					});
				}
			});

			zipfile!.on('close', () => resolve(result));
			zipfile!.readEntry();
		});
	});
}

interface ExtractedNotice {
	readonly shippingPath: string;
	readonly metaFile: string | undefined;
	readonly size: number;
}

async function tryExtractNotice(artifact: NoticeArtifact, tmpDir: string): Promise<ExtractedNotice | undefined> {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	fs.mkdirSync(tmpDir, { recursive: true });
	const artifactZipPath = path.join(tmpDir, 'notice_output.zip');

	log('  * downloading notice_output artifact to verify content...');
	await retry(() => downloadArtifact(artifact, artifactZipPath));

	log('  * extracting notice_output artifact...');
	const files = await unzip(artifactZipPath, tmpDir);
	const shipping = files.find(f => path.basename(f) === SHIPPING_NOTICE_NAME);

	if (!shipping) {
		log(`  * ${SHIPPING_NOTICE_NAME} listed but not yet in extracted output (mid-upload); will recheck next poll.`);
		return undefined;
	}

	const size = fs.statSync(shipping).size;
	if (size <= 1024) {
		log(`  * ${SHIPPING_NOTICE_NAME} extracted but too small (${size} bytes; mid-upload or empty merge); will recheck next poll.`);
		return undefined;
	}

	const metaFile = files.find(f => path.basename(f) === 'notice-meta.txt');
	return { shippingPath: shipping, metaFile, size };
}

async function waitForNotice(tmpDir: string): Promise<ExtractedNotice | undefined> {
	const startTime = Date.now();

	for (let index = 0; index < POLL_ATTEMPTS; index++) {
		const elapsed = Math.round((Date.now() - startTime) / 1000);

		try {
			log(`Waiting for ${ARTIFACT_NAME} artifact (attempt ${index + 1}/${POLL_ATTEMPTS}, ${elapsed}s elapsed)...`);

			const qualityJob = await getQualityJob().catch(() => undefined);
			if (qualityJob) {
				log(`  * Quality job: state=${qualityJob.state}, result=${qualityJob.result ?? 'n/a'}`);
			}

			const allArtifacts = await retry(() => getPipelineArtifacts());
			log(`  * Found ${allArtifacts.length} artifact(s): ${allArtifacts.map(a => a.name).join(', ') || '(none)'}`);

			const artifact = allArtifacts.find(a => a.name === ARTIFACT_NAME);
			if (artifact) {
				const files = await listArtifactFiles(artifact).catch(() => undefined);
				if (files === undefined) {
					log('  * could not list notice_output files yet; will recheck next poll');
				} else {
					log(`  * notice_output files: ${files.map(f => path.basename(f)).join(', ') || '(empty)'}`);
					if (files.some(f => path.basename(f) === SHIPPING_NOTICE_NAME)) {
						log(`  * ${SHIPPING_NOTICE_NAME} listed; verifying extracted content...`);
						const extracted = await tryExtractNotice(artifact, tmpDir).catch(err => {
							log(`  * download/extract attempt failed (${err}); will recheck next poll.`);
							return undefined;
						});
						if (extracted) {
							log(`  * ${SHIPPING_NOTICE_NAME} extracted and validated (${extracted.size} bytes); accepting.`);
							return extracted;
						}
					} else if (qualityJob && qualityJob.state === 'completed') {
						log(`  * Quality job completed but ${SHIPPING_NOTICE_NAME} never appeared in artifact; giving up.`);
						return undefined;
					} else {
						log(`  * ${SHIPPING_NOTICE_NAME} not in artifact yet; waiting...`);
					}
				}
			} else if (qualityJob && qualityJob.state === 'completed') {
				log('  * Quality job completed but no notice_output artifact; giving up.');
				return undefined;
			}

			log(`  * Not ready yet, waiting ${POLL_INTERVAL_MS / 1000}s...`);
		} catch (err) {
			console.error(`[notice-cutover] WARNING: poll attempt failed: ${err}`);
		}

		await new Promise(c => setTimeout(c, POLL_INTERVAL_MS));
	}

	log(`Poll budget exhausted (${POLL_ATTEMPTS} attempts) without a valid ${SHIPPING_NOTICE_NAME}.`);
	return undefined;
}

async function main(): Promise<void> {
	installDiagnostics();

	if ((process.env['VSCODE_OVERWRITE_TPN'] ?? '').trim().toLowerCase() === 'false') {
		log('RESULT=disabled feature flag off (VSCODE_OVERWRITE_TPN=false); keeping legacy notice.');
		return;
	}

	const tmpDir = path.resolve('.build/tmp-notice');
	const notice = await waitForNotice(tmpDir);
	if (!notice) {
		log(`RESULT=fallback ${SHIPPING_NOTICE_NAME} unavailable within budget; keeping legacy notice.`);
		fs.rmSync(tmpDir, { recursive: true, force: true });
		return;
	}

	if (notice.metaFile) {
		log('NOTICE provenance:');
		for (const line of fs.readFileSync(notice.metaFile, 'utf8').split(/\r?\n/)) {
			if (line.trim()) {
				log(`    ${line}`);
			}
		}
	}

	const legacySize = fs.existsSync(TARGET_NOTICE) ? fs.statSync(TARGET_NOTICE).size : 0;
	fs.copyFileSync(notice.shippingPath, TARGET_NOTICE);
	log(`RESULT=fresh overwrote ${TARGET_NOTICE} with CG NOTICE (${notice.size} bytes; legacy was ${legacySize} bytes).`);

	fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(err => {
	console.error('[notice-cutover] Non-fatal error; keeping legacy notice:', err);
	process.exitCode = 0;
});
