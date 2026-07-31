import { DevcontainerFeature } from './devcontainer-parser.js';

export interface IDockerfileGenerateOptions {
	readonly baseImage?: string;
	readonly workspacePath?: string;
	readonly user?: string;
	readonly features?: DevcontainerFeature[];
	readonly packages?: string[];
	readonly env?: Record<string, string>;
	readonly exposePorts?: number[];
	readonly installCommand?: string;
	readonly extraLines?: string[];
}

export const DEFAULT_BASE_IMAGE = 'ubuntu:22.04';
export const DEFAULT_WORKSPACE_PATH = '/workspaces/dc-workspace';
export const DEFAULT_USER = 'root';

export function escapeDockerfileArg(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

export function quoteDockerfileArg(value: string): string {
	return `"${escapeDockerfileArg(value)}"`;
}

export function aptPackagesToInstall(packages: string[]): string {
	if (packages.length === 0) {
		return 'true';
	}
	const escaped = packages.map(p => p.replace(/[;&|`]/g, ''));
	return `apt-get update && apt-get install -y --no-install-recommends ${escaped.join(' ')} && rm -rf /var/lib/apt/lists/*`;
}

export class DockerfileGenerator {
	generateDockerfile(options: IDockerfileGenerateOptions = {}): string {
		const baseImage = options.baseImage ?? DEFAULT_BASE_IMAGE;
		const workspacePath = options.workspacePath ?? DEFAULT_WORKSPACE_PATH;
		const user = options.user ?? DEFAULT_USER;
		const features = options.features ?? [];
		const packages = options.packages ?? [];
		const env = options.env ?? {};
		const exposePorts = options.exposePorts ?? [];

		const lines: string[] = [];
		lines.push(`FROM ${baseImage}`);
		lines.push('');

		if (Object.keys(env).length > 0) {
			const envArgs = Object.entries(env)
				.map(([key, value]) => `${key}=${quoteDockerfileArg(value)}`)
				.join(' ');
			lines.push(`ENV ${envArgs}`);
			lines.push('');
		}

		if (features.length > 0) {
			lines.push('ARG DEBIAN_FRONTEND=noninteractive');
			lines.push(`RUN ${aptPackagesToInstall(['curl', 'ca-certificates', 'git'])}`);
			lines.push('');
		}

		if (packages.length > 0) {
			lines.push(`RUN ${aptPackagesToInstall(packages)}`);
			lines.push('');
		}

		const installCommand = options.installCommand;
		if (installCommand) {
			lines.push(`RUN ${installCommand}`);
			lines.push('');
		}

		if (user && user !== 'root') {
			lines.push(`ARG REMOTE_USER=${user}`);
			lines.push('RUN useradd --create-home --shell /bin/bash --uid 1000 ${REMOTE_USER} || true');
			lines.push('');
		}

		lines.push(`WORKDIR ${workspacePath}`);
		lines.push('');

		if (exposePorts.length > 0) {
			lines.push(`EXPOSE ${exposePorts.join(' ')}`);
			lines.push('');
		}

		if (user && user !== 'root') {
			lines.push('USER ${REMOTE_USER}');
			lines.push('');
		}

		if (options.extraLines) {
			for (const extra of options.extraLines) {
				lines.push(extra);
			}
			lines.push('');
		}

		lines.push('# Keep the container running for interactive development');
		lines.push('CMD ["/bin/sh", "-c", "while sleep 3600; do :; done"]');
		return lines.join('\n') + '\n';
	}

	getDefaultDockerfile(): string {
		return this.generateDockerfile();
	}

	generateWithFeatures(features: DevcontainerFeature[], options: IDockerfileGenerateOptions = {}): string {
		const lines: string[] = [];
		lines.push(`FROM ${options.baseImage ?? DEFAULT_BASE_IMAGE}`);
		lines.push('');
		lines.push('ARG DEBIAN_FRONTEND=noninteractive');
		lines.push(`RUN ${aptPackagesToInstall(['curl', 'ca-certificates', 'git', 'jq', 'tar'])}`);
		lines.push('');
		if (features.length > 0) {
			lines.push('# Install devcontainer features');
			for (const feature of features) {
				const name = feature.id.split('/').pop() ?? feature.id;
				const dir = `/tmp/dc-features/${name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
				lines.push(`RUN mkdir -p ${dir} && curl -fsSL "https://github.com/${feature.id.split(':')[0]}/archive/refs/heads/main.tar.gz" -o /tmp/feature.tgz && tar -xzf /tmp/feature.tgz -C ${dir} --strip-components=1 || true`);
			}
			lines.push('');
		}
		lines.push(`WORKDIR ${options.workspacePath ?? DEFAULT_WORKSPACE_PATH}`);
		lines.push('');
		if (options.user && options.user !== 'root') {
			lines.push(`USER ${options.user}`);
			lines.push('');
		}
		lines.push('CMD ["/bin/sh", "-c", "while sleep 3600; do :; done"]');
		return lines.join('\n') + '\n';
	}

	toArgs(options: IDockerfileGenerateOptions): { dockerfile: string; context: string } {
		return {
			dockerfile: this.generateDockerfile(options),
			context: options.workspacePath ?? '.'
		};
	}
}
