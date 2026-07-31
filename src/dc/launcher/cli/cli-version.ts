import { readFileSync, existsSync } from 'node:fs';
import { CLIOutput } from './cli-output.js';

interface IPackageJson {
	name?: string;
	version?: string;
	productVersion?: string;
}

interface IBuildMetadata {
	commit?: string;
	date?: string;
	version?: string;
}

export function printVersion(output: CLIOutput): void {
	const pkg = readPackageJson();
	const metadata = readBuildMetadata();
	const version = pkg?.version ?? metadata?.version ?? '1.0.0';
	output.out(`Dardcor Code ${version}`);
	if (metadata?.commit) {
		output.out(`Commit: ${metadata.commit}`);
	}
	if (metadata?.date) {
		output.out(`Date: ${metadata.date}`);
	}
	if (!metadata?.commit && !metadata?.date) {
		output.out(`Date: ${new Date().toISOString().substring(0, 10)}`);
	}
}

export function readPackageJson(): IPackageJson | null {
	try {
		const raw = readFileSync(new URL('../../../../package.json', import.meta.url), 'utf-8');
		return JSON.parse(raw) as IPackageJson;
	} catch {
		return null;
	}
}

function readBuildMetadata(): IBuildMetadata | null {
	const candidates = [
		new URL('../../../../build.json', import.meta.url),
		new URL('../../../../.build-metadata.json', import.meta.url)
	];
	for (const url of candidates) {
		try {
			if (existsSync(url)) {
				const raw = readFileSync(url, 'utf-8');
				return JSON.parse(raw) as IBuildMetadata;
			}
		} catch {
			// Skip unreadable metadata files.
		}
	}
	return null;
}
