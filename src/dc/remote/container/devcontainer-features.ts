import { Emitter, Event } from '../../core/events/emitter.js';

export interface IDevcontainerFeatureSpec {
	readonly id: string;
	readonly options: Record<string, unknown>;
	readonly version?: string;
}

export interface IDevcontainerFeatureManifest {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly install?: string;
	readonly options?: Record<string, unknown>;
}

export const FEATURE_OCI_PREFIX = 'ghcr.io/devcontainers/features';

export function parseFeaturesConfig(features: Record<string, unknown>): IDevcontainerFeatureSpec[] {
	const specs: IDevcontainerFeatureSpec[] = [];
	for (const [id, value] of Object.entries(features ?? {})) {
		if (!id) {
			continue;
		}
		if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
			const version = typeof value === 'string' ? value : undefined;
			specs.push({ id, options: {}, version });
			continue;
		}
		if (typeof value === 'object' && !Array.isArray(value)) {
			specs.push({ id, options: value as Record<string, unknown> });
		}
	}
	return specs;
}

export function parseFeatureId(id: string): { owner: string; repo: string; feature: string; version?: string } | null {
	const match = /^(?:ghcr\.io\/)?([^/]+)\/([^/:]+)\/([^/:]+)(?::(.+))?$/.exec(id);
	if (!match) {
		return null;
	}
	return {
		owner: match[1],
		repo: match[2],
		feature: match[3],
		version: match[4]
	};
}

export function getFeatureInstallDir(feature: IDevcontainerFeatureSpec): string {
	const parsed = parseFeatureId(feature.id);
	const name = parsed?.feature ?? feature.id.split('/').pop() ?? 'unknown';
	return `/tmp/dc-features/${sanitizeName(name)}`;
}

function sanitizeName(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export class DevcontainerFeatures {
	private readonly _knownFeatures: IDevcontainerFeatureManifest[] = [];

	private readonly _onDidInstallFeature = new Emitter<{ id: string; ok: boolean; output: string }>();
	readonly onDidInstallFeature: Event<{ id: string; ok: boolean; output: string }> = this._onDidInstallFeature.event;

	parseFeatures(config: Record<string, unknown> | undefined): IDevcontainerFeatureSpec[] {
		if (!config || typeof config.features !== 'object' || Array.isArray(config.features)) {
			return [];
		}
		return parseFeaturesConfig(config.features as Record<string, unknown>);
	}

	registerKnownFeature(manifest: IDevcontainerFeatureManifest): void {
		const index = this._knownFeatures.findIndex(f => f.id === manifest.id);
		if (index === -1) {
			this._knownFeatures.push(manifest);
		} else {
			this._knownFeatures[index] = manifest;
		}
	}

	listAvailable(): string[] {
		const ids = new Set<string>(this._knownFeatures.map(f => f.id));
		for (const feature of KNOWN_FEATURES) {
			ids.add(feature);
		}
		return [...ids].sort();
	}

	getManifest(id: string): IDevcontainerFeatureManifest | undefined {
		return this._knownFeatures.find(f => f.id === id);
	}

	buildInstallScript(features: IDevcontainerFeatureSpec[]): string {
		const lines: string[] = [
			'set -e',
			'export DEBIAN_FRONTEND=noninteractive',
			'for tool in curl tar jq; do',
			'  if ! command -v "$tool" >/dev/null 2>&1; then',
			'    echo "missing dependency: $tool" >&2',
			'    exit 1',
			'  fi',
			'done',
			''
		];
		let index = 0;
		for (const feature of features) {
			const parsed = parseFeatureId(feature.id);
			if (!parsed) {
				lines.push(`echo "skipping invalid feature: ${feature.id}"`, '');
				continue;
			}
			const version = feature.version ?? parsed.version ?? 'latest';
			const dir = getFeatureInstallDir(feature);
			const tarball = `/tmp/dc-features/${sanitizeName(parsed.feature)}.tgz`;
			const url = `https://github.com/${parsed.owner}/${parsed.repo}/archive/refs/heads/main.tar.gz`;
			const script = [
				`echo "installing feature: ${feature.id}"`,
				`mkdir -p "${dir}"`,
				`curl -fsSL "${url}" -o "${tarball}"`,
				`tar -xzf "${tarball}" -C "${dir}" --strip-components=1 || true`,
				`cd "${dir}"`,
				`if [ -f install.sh ]; then`,
				`  chmod +x install.sh`,
				`  ./install.sh ${formatOptions(feature.options)}`,
				`fi`,
				''
			];
			lines.push(...script.map(line => `${indent(index)}${line}`));
			this._onDidInstallFeature.fire({ id: feature.id, ok: true, output: url });
			index++;
		}
		lines.push('echo "devcontainer features installed"');
		return lines.join('\n');
	}

	buildInstallCommand(features: IDevcontainerFeatureSpec[]): string {
		return this.buildInstallScript(features);
	}

	getFeatureEnv(features: IDevcontainerFeatureSpec[]): Record<string, string> {
		const env: Record<string, string> = {};
		let index = 0;
		for (const feature of features) {
			const parsed = parseFeatureId(feature.id);
			if (!parsed) {
				continue;
			}
			const key = `DC_FEATURE_${index}_VERSION`;
			env[key] = feature.version ?? parsed.version ?? 'latest';
			index++;
		}
		return env;
	}
}

function formatOptions(options: Record<string, unknown>): string {
	const entries = Object.entries(options ?? {});
	if (entries.length === 0) {
		return '';
	}
	return entries.map(([key, value]) => {
		if (typeof value === 'boolean') {
			return value ? `--${key}` : '';
		}
		return `--${key} ${typeof value === 'string' ? `"${value}"` : String(value)}`;
	}).filter(Boolean).join(' ');
}

function indent(level: number): string {
	return '  '.repeat(level);
}

const KNOWN_FEATURES: string[] = [
	'ghcr.io/devcontainers/features/common-utils:2',
	'ghcr.io/devcontainers/features/docker-in-docker:2',
	'ghcr.io/devcontainers/features/git:1',
	'ghcr.io/devcontainers/features/github-cli:2',
	'ghcr.io/devcontainers/features/node:1',
	'ghcr.io/devcontainers/features/python:1',
	'ghcr.io/devcontainers/features/powershell:1',
	'ghcr.io/devcontainers/features/sshd:1'
];
