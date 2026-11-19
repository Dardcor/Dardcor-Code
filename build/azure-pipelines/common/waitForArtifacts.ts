/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Artifact, requestAZDOAPI } from '../common/publish.ts';
import { retry } from '../common/retry.ts';

async function getPipelineArtifacts(): Promise<Artifact[]> {
	const result = await requestAZDOAPI<{ readonly value: Artifact[] }>('artifacts');
	return result.value.filter(a => !/sbom$/.test(a.name));
}

interface TimelineRecord {
	readonly name: string;
	readonly identifier?: string;
	readonly type: string;
	readonly state: string;
	readonly result: string;
}

interface Timeline {
	readonly records: TimelineRecord[];
}

async function getPipelineTimeline(): Promise<Timeline> {
	return await requestAZDOAPI<Timeline>('timeline');
}

class ProducerFailedError extends Error { }

function findFailedProducer(timeline: Timeline, producer: string): TimelineRecord | undefined {
	const records = timeline.records.filter(r =>
		r.type === 'Job' && (r.name === producer || r.identifier === producer));

	if (records.length === 0) {
		return undefined;
	}

	if (records.some(r => r.state !== 'completed' || r.result === 'succeeded' || r.result === 'succeededWithIssues')) {
		return undefined;
	}

	return records[0];
}

function parseArgs(args: string[]): { artifacts: string[]; producers: Map<string, string> } {
	const artifacts = new Set<string>();
	const producers = new Map<string, string>();

	for (const arg of args) {
		const match = /^--producer=(?<artifact>[^=]+)=(?<job>.+)$/.exec(arg);
		if (match) {
			const { artifact, job } = match.groups!;
			artifacts.add(artifact);
			producers.set(artifact, job);
		} else {
			artifacts.add(arg);
		}
	}

	return { artifacts: [...artifacts], producers };
}

async function main(args: string[]): Promise<void> {
	const { artifacts, producers } = parseArgs(args);

	if (artifacts.length === 0) {
		throw new Error(`Usage: node waitForArtifacts.ts [--producer=<artifactName>=<producerJob> ...] <artifactName1> <artifactName2> ...`);
	}

	for (let index = 0; index < 120; index++) {
		try {
			console.log(`Waiting for artifacts (${artifacts.join(', ')}) to be uploaded (${index + 1}/120)...`);
			const allArtifacts = await retry(() => getPipelineArtifacts());
			console.log(`  * Artifacts attached to the pipelines: ${allArtifacts.length > 0 ? allArtifacts.map(a => a.name).join(', ') : 'none'}`);

			const foundArtifacts = allArtifacts.filter(a => artifacts.includes(a.name));
			console.log(`  * Found artifacts: ${foundArtifacts.length > 0 ? foundArtifacts.map(a => a.name).join(', ') : 'none'}`);

			if (foundArtifacts.length === artifacts.length) {
				console.log(`  * All artifacts were found`);
				return;
			}

			const missingWithProducers = artifacts.filter(a => producers.has(a) && !foundArtifacts.some(f => f.name === a));
			if (missingWithProducers.length > 0) {
				const timeline = await retry(() => getPipelineTimeline());
				for (const artifact of missingWithProducers) {
					const producer = producers.get(artifact)!;
					const failed = findFailedProducer(timeline, producer);
					if (failed) {
						throw new ProducerFailedError(`Producer job "${failed.name}" ${failed.result} before uploading artifact "${artifact}". It will never be uploaded.`);
					}
				}
			}
		} catch (err) {
			if (err instanceof ProducerFailedError) {
				throw err;
			}

			console.error(`ERROR: Failed to get pipeline artifacts: ${err}`);
		}

		await new Promise(c => setTimeout(c, 30_000));
	}

	throw new Error(`ERROR: Artifacts (${artifacts.join(', ')}) were not uploaded within 60 minutes.`);
}

main(process.argv.splice(2)).catch(err => {
	console.error(err);
	process.exitCode = 1;
});
