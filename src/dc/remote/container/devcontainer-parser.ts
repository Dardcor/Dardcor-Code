/**
 * Dardcor Code - .devcontainer/devcontainer.json Schema Parser (Task 828)
 */

export interface DevcontainerBuildOptions {
	readonly dockerfile?: string;
	readonly context?: string;
	readonly args?: Record<string, string>;
	readonly target?: string;
}

export interface DevcontainerFeature {
	readonly id: string;
	readonly options: Record<string, unknown>;
}

export interface DevcontainerConfig {
	name?: string;
	image?: string;
	build?: DevcontainerBuildOptions;
	containerUser?: string;
	remoteUser?: string;
	workspaceFolder?: string;
	workspaceMount?: string;
	mounts?: string[];
	forwardPorts?: Array<number | string>;
	runArgs?: string[];
	features?: DevcontainerFeature[];
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	customizations?: Record<string, unknown>;
	overrideCommand?: boolean;
	privileged?: boolean;
	init?: boolean;
}

const COMMAND_KEYS = ['onCreateCommand', 'updateContentCommand', 'postCreateCommand', 'postStartCommand'] as const;

export class DevcontainerParseError extends Error {
	readonly errors: string[];

	constructor(errors: string[]) {
		super(`Invalid devcontainer.json: ${errors.join('; ')}`);
		this.name = 'DevcontainerParseError';
		this.errors = errors;
	}
}

export function parseDevcontainerConfig(source: string | Record<string, unknown>): DevcontainerConfig {
	let raw: Record<string, unknown>;
	if (typeof source === 'string') {
		try {
			raw = JSON.parse(stripComments(source)) as Record<string, unknown>;
		} catch (error) {
			throw new DevcontainerParseError([`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`]);
		}
	} else {
		raw = source;
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new DevcontainerParseError(['Root must be a JSON object']);
	}

	const config: DevcontainerConfig = {};
	if (typeof raw.name === 'string') {
		config.name = raw.name;
	}
	if (typeof raw.image === 'string') {
		config.image = raw.image;
	}
	if (raw.build && typeof raw.build === 'object') {
		const build = raw.build as Record<string, unknown>;
		config.build = {
			dockerfile: typeof build.dockerfile === 'string' ? build.dockerfile : undefined,
			context: typeof build.context === 'string' ? build.context : undefined,
			target: typeof build.target === 'string' ? build.target : undefined,
			args: build.args && typeof build.args === 'object' ? build.args as Record<string, string> : undefined
		};
	}
	if (typeof raw.containerUser === 'string') {
		config.containerUser = raw.containerUser;
	}
	if (typeof raw.remoteUser === 'string') {
		config.remoteUser = raw.remoteUser;
	}
	if (typeof raw.workspaceFolder === 'string') {
		config.workspaceFolder = raw.workspaceFolder;
	}
	if (typeof raw.workspaceMount === 'string') {
		config.workspaceMount = raw.workspaceMount;
	}
	if (Array.isArray(raw.mounts)) {
		config.mounts = raw.mounts.filter((m): m is string => typeof m === 'string');
	}
	if (Array.isArray(raw.forwardPorts)) {
		config.forwardPorts = raw.forwardPorts.filter((p): p is number | string =>
			typeof p === 'number' || typeof p === 'string'
		);
	}
	if (Array.isArray(raw.runArgs)) {
		config.runArgs = raw.runArgs.filter((a): a is string => typeof a === 'string');
	}
	if (raw.features && typeof raw.features === 'object') {
		config.features = Object.entries(raw.features as Record<string, unknown>).map(([id, value]) => ({
			id,
			options: value && typeof value === 'object' ? value as Record<string, unknown> : {}
		}));
	}
	for (const key of COMMAND_KEYS) {
		const value = raw[key];
		if (typeof value === 'string') {
			config[key] = value;
		} else if (Array.isArray(value) && value.every((c): c is string => typeof c === 'string')) {
			config[key] = value;
		}
	}
	if (raw.customizations && typeof raw.customizations === 'object') {
		config.customizations = raw.customizations as Record<string, unknown>;
	}
	if (typeof raw.overrideCommand === 'boolean') {
		config.overrideCommand = raw.overrideCommand;
	}
	if (typeof raw.privileged === 'boolean') {
		config.privileged = raw.privileged;
	}
	if (typeof raw.init === 'boolean') {
		config.init = raw.init;
	}
	return config;
}

export function validateDevcontainerConfig(config: DevcontainerConfig): string[] {
	const errors: string[] = [];
	if (!config.image && !config.build) {
		errors.push('Either "image" or "build" must be specified');
	}
	if (config.image && config.build) {
		errors.push('"image" and "build" cannot both be specified');
	}
	if (config.build && !config.build.dockerfile) {
		errors.push('"build.dockerfile" is required when "build" is used');
	}
	if (config.forwardPorts) {
		for (const port of config.forwardPorts) {
			if (typeof port === 'number' && (port < 0 || port > 65535)) {
				errors.push(`Invalid forward port ${port}`);
			}
		}
	}
	return errors;
}

export class DevcontainerParser {
	parse(source: string | Record<string, unknown>): DevcontainerConfig {
		const config = parseDevcontainerConfig(source);
		const errors = validateDevcontainerConfig(config);
		if (errors.length > 0) {
			throw new DevcontainerParseError(errors);
		}
		return config;
	}
}

export function getDefaultWorkspaceFolder(config: DevcontainerConfig): string {
	return config.workspaceFolder ?? '/workspaces/dc-workspace';
}

function stripComments(source: string): string {
	return source
		.split('\n')
		.map(line => {
			const trimmed = line.trimStart();
			if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
				return '';
			}
			return line;
		})
		.join('\n');
}
