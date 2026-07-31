import { YAMLLite } from '../../core/formatting/yaml-lite.js';

export interface IComposePort {
	readonly published: number;
	readonly target: number;
	readonly hostIp?: string;
	readonly protocol: 'tcp' | 'udp';
}

export interface IComposeService {
	readonly name: string;
	readonly image?: string;
	readonly build?: string;
	readonly ports?: IComposePort[];
	readonly volumes?: string[];
	readonly environment?: Record<string, string>;
	readonly dependsOn?: string[];
	readonly command?: string | string[];
	readonly user?: string;
	readonly raw: Record<string, unknown>;
}

export interface IComposeConfig {
	readonly version?: string;
	readonly name?: string;
	readonly services: Record<string, IComposeService>;
	readonly volumes: string[];
	readonly networks: string[];
}

export interface IComposeValidationError {
	readonly path: string;
	readonly message: string;
}

const VOLUME_PATTERN = /^(\d{1,5})(?::(\d{1,5}))?(\/(udp|tcp))?$/;

export function parseScalar(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value.replace(/^["']|["']$/g, '');
	}
	return String(value);
}

export function parsePortSpec(value: string): IComposePort | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const segments = trimmed.split('/');
	const protocol = (segments[1] as 'tcp' | 'udp' | undefined) ?? 'tcp';
	const mapping = segments[0];
	const match = VOLUME_PATTERN.exec(mapping);
	if (!match) {
		return null;
	}
	const published = Number(match[1]);
	const target = Number(match[2] ?? match[1]);
	if (published > 65535 || target > 65535) {
		return null;
	}
	return { published, target, protocol };
}

export function parseComposeYaml(content: string): IComposeConfig {
	const lines = content.split(/\r?\n/);
	const root = parseYamlBlock(lines, 0, 0).value as Record<string, unknown>;
	return toComposeConfig(root, content);
}

export class DockerComposeParser {
	private _config: IComposeConfig | null = null;
	private readonly _errors: IComposeValidationError[] = [];

	get errors(): readonly IComposeValidationError[] {
		return [...this._errors];
	}

	parse(content: string): IComposeConfig {
		this._config = parseComposeYaml(content);
		this._errors.length = 0;
		this._errors.push(...validateComposeConfig(this._config));
		return this._config;
	}

	validate(config: IComposeConfig): string[] {
		return validateComposeConfig(config).map(error => `${error.path}: ${error.message}`);
	}

	getService(name: string): IComposeService | undefined {
		return this._config?.services[name];
	}

	getServices(): IComposeService[] {
		if (!this._config) {
			return [];
		}
		return Object.values(this._config.services);
	}

	getServiceNames(): string[] {
		if (!this._config) {
			return [];
		}
		return Object.keys(this._config.services);
	}

	getPorts(service: string | IComposeService): IComposePort[] {
		const resolved = typeof service === 'string' ? this.getService(service) : service;
		return resolved?.ports ? [...resolved.ports] : [];
	}

	hasService(name: string): boolean {
		return !!this._config && name in this._config.services;
	}

	toJson(): string {
		return JSON.stringify(this._config, null, 2);
	}
}

function toComposeConfig(root: Record<string, unknown>, content: string): IComposeConfig {
	const version = parseScalar(root.version) || undefined;
	const name = parseScalar(root.name) || undefined;
	const servicesRaw = root.services;
	const services: Record<string, IComposeService> = {};
	if (servicesRaw && typeof servicesRaw === 'object' && !Array.isArray(servicesRaw)) {
		for (const [name, raw] of Object.entries(servicesRaw as Record<string, unknown>)) {
			if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
				services[name] = toComposeService(name, raw as Record<string, unknown>);
			}
		}
	}
	const volumes: string[] = [];
	const volumesRaw = root.volumes;
	if (volumesRaw && typeof volumesRaw === 'object') {
		for (const key of Object.keys(volumesRaw as Record<string, unknown>)) {
			volumes.push(key);
		}
	}
	const networks: string[] = [];
	const networksRaw = root.networks;
	if (networksRaw && typeof networksRaw === 'object') {
		for (const key of Object.keys(networksRaw as Record<string, unknown>)) {
			networks.push(key);
		}
	}
	return { version, name, services, volumes, networks };
}

function toComposeService(name: string, raw: Record<string, unknown>): IComposeService {
	const service: IComposeService = { name, raw };
	const image = raw.image;
	if (typeof image === 'string') {
		(service as any).image = image;
	}
	const build = raw.build;
	if (typeof build === 'string') {
		(service as any).build = build;
	} else if (build && typeof build === 'object' && typeof (build as Record<string, unknown>).context === 'string') {
		(service as any).build = (build as Record<string, unknown>).context as string;
	}
	const ports = raw.ports;
	if (Array.isArray(ports)) {
		(service as any).ports = ports.map(parseScalar).map(parsePortSpec).filter((p): p is IComposePort => p !== null);
	}
	const volumes = raw.volumes;
	if (Array.isArray(volumes)) {
		(service as any).volumes = volumes.map(parseScalar).filter(Boolean);
	}
	const environment = raw.environment;
	if (Array.isArray(environment)) {
		const env: Record<string, string> = {};
		for (const entry of environment.map(parseScalar)) {
			const index = entry.indexOf('=');
			if (index !== -1) {
				env[entry.slice(0, index)] = entry.slice(index + 1);
			} else if (entry) {
				env[entry] = '';
			}
		}
		(service as any).environment = env;
	} else if (environment && typeof environment === 'object') {
		(service as any).environment = Object.fromEntries(
			Object.entries(environment as Record<string, unknown>).map(([key, value]) => [key, parseScalar(value)])
		);
	}
	const dependsOn = raw.depends_on;
	if (Array.isArray(dependsOn)) {
		(service as any).dependsOn = dependsOn.map(parseScalar).filter(Boolean);
	}
	const command = raw.command;
	if (typeof command === 'string' || Array.isArray(command)) {
		(service as any).command = command;
	}
	const user = raw.user;
	if (typeof user === 'string') {
		(service as any).user = user;
	}
	return service;
}

function validateComposeConfig(config: IComposeConfig): IComposeValidationError[] {
	const errors: IComposeValidationError[] = [];
	if (Object.keys(config.services).length === 0) {
		errors.push({ path: 'services', message: 'at least one service is required' });
	}
	for (const [name, service] of Object.entries(config.services)) {
		if (!service.image && !service.build) {
			errors.push({ path: `services.${name}`, message: 'either image or build is required' });
		}
		for (const port of service.ports ?? []) {
			if (port.published < 0 || port.published > 65535 || port.target < 0 || port.target > 65535) {
				errors.push({ path: `services.${name}.ports`, message: `port out of range: ${port.published}:${port.target}` });
			}
		}
	}
	return errors;
}

interface YamlBlockResult {
	value: unknown;
	nextIndex: number;
}

function parseYamlBlock(lines: string[], startIndex: number, baseIndent: number): YamlBlockResult {
	const result: Record<string, unknown> = {};
	let index = startIndex;
	const parentMap = result;
	let currentMap: Record<string, unknown> = result;
	let currentKey: string | null = null;
	let currentIndent = baseIndent;
	while (index < lines.length) {
		const line = lines[index];
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			index++;
			continue;
		}
		const indent = line.length - line.trimStart().length;
		if (indent < baseIndent) {
			break;
		}
		const colonIndex = findColon(trimmed);
		if (colonIndex === -1) {
			if (currentKey && indent > currentIndent) {
				const arrayValue = parentMap[currentKey];
				if (Array.isArray(arrayValue)) {
					arrayValue.push(parseScalar(trimmed));
				}
			}
			index++;
			continue;
		}
		const key = trimmed.slice(0, colonIndex).trim().replace(/^["']|["']$/g, '');
		const rest = trimmed.slice(colonIndex + 1).trim();
		if (rest === '' || rest === '|' || rest === '>') {
			if (indent <= currentIndent) {
				currentMap = parentMap;
			}
			if (rest === '|' || rest === '>') {
				const block = collectBlock(lines, index + 1, indent + 1);
				currentMap[key] = rest === '|' ? block.join('\n') : block.join(' ');
				index = index + 1 + block.length;
				continue;
			}
			const child = parseYamlBlock(lines, index + 1, indent + 1);
			currentMap[key] = child.value;
			index = child.nextIndex;
			currentMap = child.value as Record<string, unknown>;
			parentMap[key] = currentMap;
			currentKey = key;
			currentIndent = indent;
			continue;
		}
		if (rest === '-') {
			const list = parseYamlList(lines, index + 1, indent + 1);
			currentMap[key] = list.value;
			index = list.nextIndex;
			continue;
		}
		if (rest.startsWith('- ')) {
			const list: unknown[] = [];
			while (index < lines.length) {
				const itemLine = lines[index];
				const itemTrimmed = itemLine.trim();
				if (!itemTrimmed.startsWith('-')) {
					break;
				}
				const itemValue = itemTrimmed.slice(1).trim();
				const nested = parseYamlBlock(lines, index + 1, indent + 1);
				if (itemValue) {
					list.push(parseScalar(itemValue));
					index = nested.nextIndex;
				} else {
					list.push(nested.value);
					index = nested.nextIndex;
				}
			}
			currentMap[key] = list;
			continue;
		}
		currentMap[key] = parseScalar(rest);
		index++;
	}
	const fallback = YAMLLite.parse(lines.slice(startIndex, index).join('\n'));
	return { value: { ...result, ...fallback }, nextIndex: index };
}

function parseYamlList(lines: string[], startIndex: number, baseIndent: number): YamlBlockResult {
	const list: unknown[] = [];
	let index = startIndex;
	while (index < lines.length) {
		const line = lines[index];
		const trimmed = line.trim();
		if (!trimmed) {
			index++;
			continue;
		}
		const indent = line.length - line.trimStart().length;
		if (indent < baseIndent) {
			break;
		}
		if (!trimmed.startsWith('-')) {
			break;
		}
		const item = trimmed.slice(1).trim();
		if (!item) {
			const nested = parseYamlBlock(lines, index + 1, indent + 1);
			list.push(nested.value);
			index = nested.nextIndex;
			continue;
		}
		if (item.startsWith('- ')) {
			const nestedList = parseYamlList(lines, index, indent + 1);
			list.push(nestedList.value);
			index = nestedList.nextIndex;
			continue;
		}
		list.push(parseScalar(item));
		index++;
	}
	return { value: list, nextIndex: index };
}

function collectBlock(lines: string[], startIndex: number, baseIndent: number): string[] {
	const block: string[] = [];
	let index = startIndex;
	while (index < lines.length) {
		const line = lines[index];
		const trimmed = line.trim();
		if (!trimmed) {
			block.push('');
			index++;
			continue;
		}
		const indent = line.length - line.trimStart().length;
		if (indent < baseIndent) {
			break;
		}
		block.push(line.slice(Math.min(indent, baseIndent)));
		index++;
	}
	return block;
}

function findColon(line: string): number {
	let inQuote: string | null = null;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuote) {
			if (ch === inQuote) {
				inQuote = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			inQuote = ch;
			continue;
		}
		if (ch === ':' && (i + 1 >= line.length || line[i + 1] === ' ')) {
			return i;
		}
	}
	return -1;
}
