/**
 * Dardcor Code - Docker Container .devcontainer.json Environment Builder & Runner (Task 808)
 */

import { resolve, basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { DockerCli, DockerCliError } from './docker-cli.js';
import { DevcontainerConfig, getDefaultWorkspaceFolder } from './devcontainer-parser.js';

export interface DevcontainerSession {
	readonly containerId: string;
	readonly workspaceFolder: string;
	readonly image: string;
	readonly forwardedPorts: Array<number | string>;
}

export interface IDevcontainerRunOptions {
	readonly buildArgs?: Record<string, string>;
	readonly env?: Record<string, string>;
	readonly keepContainer?: boolean;
	readonly skipLifecycleCommands?: boolean;
}

export class DevcontainerClient extends Disposable {
	private readonly _onDidOutput = this._register(new Emitter<string>());
	readonly onDidOutput: Event<string> = this._onDidOutput.event;

	constructor(
		private readonly _docker: DockerCli,
		private readonly _workspaceRoot: string
	) {
		super();
	}

	async start(config: DevcontainerConfig, options: IDevcontainerRunOptions = {}): Promise<DevcontainerSession> {
		if (!(await this._docker.isAvailable())) {
			throw new DockerCliError('Docker is not available; cannot start devcontainer');
		}
		const image = await this._ensureImage(config, options);
		const workspaceFolder = getDefaultWorkspaceFolder(config);
		const name = this._containerName(config, image);

		await this._docker.remove(name, true).catch(() => undefined);

		const ports = config.forwardPorts ?? [];
		const volumes = this._buildVolumes(config, workspaceFolder);
		const env = { ...options.env, DC_REMOTE_DEV_CONTAINER: '1' };

		this._onDidOutput.fire(`Starting container '${name}' from image '${image}'`);
		const result = await this._docker.run(image, [], {
			name,
			detach: true,
			interactive: true,
			tty: false,
			user: config.containerUser,
			workdir: workspaceFolder,
			ports: ports
				.filter((p): p is number => typeof p === 'number')
				.map(port => ({ host: port, container: port })),
			volumes,
			env,
			privileged: config.privileged,
			rm: !(options.keepContainer ?? false),
			extraArgs: [
				...(config.runArgs ?? []),
				...(config.init ? ['--init'] : []),
				'--entrypoint', '/bin/sh'
			]
		});

		if (!result.containerId) {
			throw new DockerCliError('docker run did not return a container id', 'docker run');
		}
		const session: DevcontainerSession = {
			containerId: result.containerId,
			workspaceFolder,
			image,
			forwardedPorts: ports
		};

		if (!(options.skipLifecycleCommands ?? false)) {
			await this.runLifecycleCommands(session, config);
		}
		return session;
	}

	async runLifecycleCommands(session: DevcontainerSession, config: DevcontainerConfig): Promise<void> {
		const phases: Array<{ label: string; command?: string | string[] }> = [
			{ label: 'onCreateCommand', command: config.onCreateCommand },
			{ label: 'updateContentCommand', command: config.updateContentCommand },
			{ label: 'postCreateCommand', command: config.postCreateCommand },
			{ label: 'postStartCommand', command: config.postStartCommand }
		];
		for (const phase of phases) {
			if (!phase.command) {
				continue;
			}
			const command = Array.isArray(phase.command) ? phase.command : [phase.command];
			this._onDidOutput.fire(`Running ${phase.label}: ${command.join(' ')}`);
			const result = await this._docker.exec(session.containerId, ['sh', '-c', command.join(' && ') || 'true'], {
				workdir: session.workspaceFolder,
				user: config.containerUser
			});
			this._onDidOutput.fire(result.stdout || result.stderr || `(${phase.label} exited with ${result.exitCode})`);
		}
	}

	async stop(session: DevcontainerSession): Promise<void> {
		await this._docker.stop(session.containerId);
	}

	async remove(session: DevcontainerSession): Promise<void> {
		await this._docker.remove(session.containerId, true);
	}

	async status(session: DevcontainerSession): Promise<string> {
		const info = await this._docker.inspect(session.containerId);
		return info.State?.Status ?? 'unknown';
	}

	private async _ensureImage(config: DevcontainerConfig, options: IDevcontainerRunOptions): Promise<string> {
		if (config.image) {
			if (!(await this._docker.imageExists(config.image))) {
				this._onDidOutput.fire(`Pulling image '${config.image}'`);
				await this._docker.pull(config.image);
			}
			return config.image;
		}
		const build = config.build!;
		const context = build.context
			? resolve(this._workspaceRoot, build.context)
			: this._workspaceRoot;
		const dockerfile = build.dockerfile
			? resolve(context, build.dockerfile)
			: join(context, 'Dockerfile');
		if (!existsSync(dockerfile)) {
			throw new DockerCliError(`Dockerfile not found at '${dockerfile}'`);
		}
		const tag = `dc-devcontainer-${(config.name ?? basename(this._workspaceRoot)).toLowerCase().replace(/[^a-z0-9_.-]/g, '-')}`;
		this._onDidOutput.fire(`Building image '${tag}' from '${dockerfile}'`);
		await this._docker.build(context, {
			dockerfile,
			tags: [tag],
			buildArgs: { ...(build.args ?? {}), ...options.buildArgs }
		});
		return tag;
	}

	private _buildVolumes(config: DevcontainerConfig, workspaceFolder: string): { host: string; container: string }[] {
		const volumes: { host: string; container: string }[] = [];
		if (config.workspaceMount) {
			const parts = config.workspaceMount.split(':');
			if (parts.length >= 2) {
				volumes.push({ host: parts[0], container: parts.slice(1).join(':') });
			}
		} else {
			volumes.push({ host: this._workspaceRoot, container: workspaceFolder });
		}
		for (const mount of config.mounts ?? []) {
			const parts = mount.split(':');
			if (parts.length >= 2) {
				volumes.push({ host: parts[0], container: parts.slice(1).join(':') });
			}
		}
		return volumes;
	}

	private _containerName(config: DevcontainerConfig, image: string): string {
		const base = config.name ?? basename(this._workspaceRoot);
		const sanitized = base.toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 48);
		const imageHash = [...image].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 997, 7);
		return `dc-devcontainer-${sanitized || 'workspace'}-${imageHash}`;
	}
}
