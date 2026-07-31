export interface IContainerVolumeMount {
	readonly source: string;
	readonly target: string;
	readonly type: 'bind' | 'volume' | 'tmpfs' | 'named-volume';
	readonly readOnly: boolean;
	readonly consistency?: string;
}

export interface IContainerVolumeMountOptions {
	readonly readOnly?: boolean;
	readonly type?: IContainerVolumeMount['type'];
	readonly consistency?: string;
}

export function normalizeTargetPath(target: string): string {
	const result = target.trim();
	if (!result.startsWith('/') && !result.startsWith('.')) {
		return `/${result}`;
	}
	return result;
}

export function parseMountString(value: string): IContainerVolumeMount | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.startsWith('type=')) {
		return parseMountTypeValue(trimmed);
	}
	const parts = trimmed.split(':');
	if (parts.length < 2 || parts.length > 3) {
		return null;
	}
	const [source, target, flags] = parts;
	if (!source || !target) {
		return null;
	}
	let readOnly = false;
	if (flags) {
		for (const flag of flags.split(',')) {
			if (flag === 'ro') {
				readOnly = true;
			} else if (flag === 'rw') {
				readOnly = false;
			}
		}
	}
	const type: IContainerVolumeMount['type'] = /^[A-Za-z0-9_-]+$/.test(source) && !source.includes('/') && !source.includes('\\')
		? 'named-volume'
		: 'bind';
	return {
		source,
		target: normalizeTargetPath(target),
		type,
		readOnly,
		consistency: undefined
	};
}

export function parseMountTypeValue(value: string): IContainerVolumeMount | null {
	const props = new Map<string, string>();
	for (const part of value.split(',')) {
		const index = part.indexOf('=');
		if (index === -1) {
			continue;
		}
		props.set(part.slice(0, index), part.slice(index + 1));
	}
	const source = props.get('source') ?? props.get('src');
	const target = props.get('target') ?? props.get('dst') ?? props.get('destination');
	if (!source || !target) {
		return null;
	}
	const typeValue = props.get('type');
	const type: IContainerVolumeMount['type'] = typeValue === 'volume' || typeValue === 'tmpfs' ? typeValue : 'bind';
	return {
		source,
		target: normalizeTargetPath(target),
		type,
		readOnly: props.get('readonly') === 'true' || props.get('ro') === 'true'
	};
}

export class ContainerVolumeMount {
	buildMount(args: { source: string; target: string; readOnly?: boolean; type?: IContainerVolumeMount['type'] }): IContainerVolumeMount {
		return {
			source: args.source,
			target: normalizeTargetPath(args.target),
			type: args.type ?? 'bind',
			readOnly: args.readOnly ?? false,
			consistency: undefined
		};
	}

	getWorkspaceMount(workspacePath: string, containerPath = '/workspaces/dc-workspace'): IContainerVolumeMount {
		return {
			source: workspacePath,
			target: normalizeTargetPath(containerPath),
			type: 'bind',
			readOnly: false,
			consistency: 'cached'
		};
	}

	toDockerArgs(mounts: IContainerVolumeMount[], extra: IContainerVolumeMount[] = []): string[] {
		const args: string[] = [];
		const all = [...mounts, ...extra];
		for (const mount of all) {
			args.push('--mount', this.toMountValue(mount));
		}
		return args;
	}

	toMountValue(mount: IContainerVolumeMount): string {
		const parts = [
			`type=${mount.type === 'named-volume' ? 'volume' : mount.type}`,
			`source=${mount.source}`,
			`target=${mount.target}`
		];
		if (mount.readOnly) {
			parts.push('readonly');
		}
		if (mount.consistency) {
			parts.push(`consistency=${mount.consistency}`);
		}
		return parts.join(',');
	}

	toShortArgs(mounts: IContainerVolumeMount[]): string[] {
		const args: string[] = [];
		for (const mount of mounts) {
			let spec = mount.type === 'named-volume' || mount.type === 'volume'
				? `${mount.source}:${mount.target}`
				: `${mount.source}:${mount.target}`;
			if (mount.readOnly) {
				spec += ':ro';
			}
			args.push('-v', spec);
		}
		return args;
	}

	parseMountString(value: string): IContainerVolumeMount | null {
		return parseMountString(value);
	}

	isNested(mount: IContainerVolumeMount, other: IContainerVolumeMount): boolean {
		return mount.target.startsWith(other.target.endsWith('/') ? other.target : `${other.target}/`);
	}

	filterOverlapping(mounts: IContainerVolumeMount[]): IContainerVolumeMount[] {
		const sorted = [...mounts].sort((a, b) => a.target.length - b.target.length);
		const result: IContainerVolumeMount[] = [];
		for (const mount of sorted) {
			if (!result.some(existing => this.isNested(mount, existing))) {
				result.push(mount);
			}
		}
		return result;
	}
}

export const DEFAULT_WORKSPACE_MOUNT_TARGET = '/workspaces/dc-workspace';
