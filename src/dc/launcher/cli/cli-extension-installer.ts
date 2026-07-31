import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readZip } from '../../core/binary/zip-parser';

export interface IExtensionIndexEntry {
	id: string;
	version: string;
	path: string;
	installedAt: string;
}

export interface IExtensionIndex {
	extensions: IExtensionIndexEntry[];
}

export function getExtensionsDir(): string {
	const fromEnv = process.env.DARDCOR_CODE_EXTENSIONS_DIR ?? process.env.DARDCOR_EXTENSIONS_DIR;
	if (fromEnv) {
		return fromEnv;
	}
	return join(homedir(), '.dardcor-code', 'extensions');
}

export async function readExtensionsIndex(extensionsRoot?: string): Promise<IExtensionIndex> {
	const root = extensionsRoot ?? getExtensionsDir();
	try {
		const raw = await readFile(join(root, 'extensions.json'), 'utf-8');
		const parsed = JSON.parse(raw) as Partial<IExtensionIndex>;
		return { extensions: Array.isArray(parsed.extensions) ? parsed.extensions : [] };
	} catch {
		return { extensions: [] };
	}
}

export async function writeExtensionsIndex(index: IExtensionIndex, extensionsRoot?: string): Promise<void> {
	const root = extensionsRoot ?? getExtensionsDir();
	await mkdir(root, { recursive: true });
	const file = join(root, 'extensions.json');
	const tmp = file + '.tmp';
	await writeFile(tmp, JSON.stringify(index, null, 2), 'utf-8');
	await rename(tmp, file);
}

export class CLIExtensionInstaller {
	constructor(private readonly _extensionsRoot?: string) {}

	public get extensionsRoot(): string {
		return this._extensionsRoot ?? getExtensionsDir();
	}

	public async install(vsixPath: string): Promise<boolean> {
		try {
			const buffer = await readFile(vsixPath);
			const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
			const entries = await readZip(arrayBuffer);
			if (entries.length === 0) {
				return false;
			}

			const manifestEntry = entries.find(e => e.name === 'extension/package.json');
			if (!manifestEntry) {
				return false;
			}

			let manifest: any;
			try {
				manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
			} catch {
				return false;
			}
			if (!manifest.name || !manifest.publisher) {
				return false;
			}

			const id = `${manifest.publisher}.${manifest.name}`;
			const version = typeof manifest.version === 'string' && manifest.version ? manifest.version : '0.0.0';
			const targetDir = join(this.extensionsRoot, id);

			await mkdir(targetDir, { recursive: true });
			for (const entry of entries) {
				if (entry.isDirectory) {
					continue;
				}
				const relativePath = entry.name.startsWith('extension/')
					? entry.name.substring('extension/'.length)
					: entry.name;
				if (!relativePath || hasTraversalSegments(relativePath)) {
					continue;
				}
				const outPath = join(targetDir, ...relativePath.split('/'));
				await mkdir(dirname(outPath), { recursive: true });
				await writeFile(outPath, entry.data);
			}

			const index = await readExtensionsIndex(this.extensionsRoot);
			const existing = index.extensions.find(e => e.id === id);
			if (existing) {
				existing.version = version;
				existing.path = targetDir;
				existing.installedAt = new Date().toISOString();
			} else {
				index.extensions.push({ id, version, path: targetDir, installedAt: new Date().toISOString() });
			}
			await writeExtensionsIndex(index, this.extensionsRoot);
			return true;
		} catch {
			return false;
		}
	}
}

function hasTraversalSegments(relativePath: string): boolean {
	return relativePath.split('/').some(segment => segment === '..' || segment === '.');
}
