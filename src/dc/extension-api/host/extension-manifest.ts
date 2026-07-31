/**
 * Dardcor Code - Extension package.json Manifest Descriptor Parser (Task 620)
 * Mirrors: vs/platform/extensionManagement/common/extensionManifest.ts
 */

export interface IExtensionContributesCommand {
	command: string;
	title: string;
	category?: string;
	icon?: string | { light?: string; dark?: string };
	enablement?: string;
}

export interface IExtensionContributes {
	commands?: IExtensionContributesCommand[];
	menus?: Record<string, unknown>;
	keybindings?: unknown[];
	languages?: Array<{ id: string; extensions?: string[]; filenames?: string[]; aliases?: string[]; configuration?: string }>;
	grammars?: unknown[];
	themes?: unknown[];
	iconThemes?: unknown[];
	viewsContainers?: Record<string, unknown>;
	views?: Record<string, unknown>;
	configuration?: unknown;
	configurationDefaults?: Record<string, unknown>;
	problemMatchers?: unknown[];
	problemPatterns?: unknown[];
	walkthroughs?: unknown[];
	breakpoints?: unknown[];
	debuggers?: unknown[];
	submenus?: unknown[];
	taskDefinitions?: unknown[];
	colorThemes?: unknown[];
}

export interface IExtensionManifest {
	readonly name: string;
	readonly publisher: string;
	readonly version: string;
	readonly description?: string;
	readonly displayName?: string;
	readonly main?: string;
	readonly browser?: string;
	readonly icon?: string;
	readonly license?: string;
	readonly engines?: { vscode?: string; dardcor?: string; [key: string]: string | undefined };
	readonly activationEvents?: string[];
	readonly contributes?: IExtensionContributes;
	readonly extensionKind?: string | string[];
	readonly categories?: string[];
	readonly keywords?: string[];
	readonly repository?: { type?: string; url?: string };
	readonly dependencies?: string[];
	readonly extensionDependencies?: string[];
	readonly scripts?: Record<string, string>;
	readonly enablesProposedApi?: boolean;
}

export interface IExtensionDescriptor {
	readonly id: string;
	readonly manifest: IExtensionManifest;
	readonly manifestPath: string;
	readonly extensionPath: string;
	readonly mainPath?: string;
}

export function extensionId(publisher: string, name: string): string {
	return `${publisher}.${name}`;
}

const REQUIRED_FIELDS: Array<keyof IExtensionManifest> = ['name', 'publisher', 'version'];

export class ExtensionManifestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ExtensionManifestError';
	}
}

/**
 * Parses and validates a raw `package.json` object into a typed manifest.
 */
export class ExtensionManifestParser {
	public parse(raw: unknown, manifestPath?: string): IExtensionManifest {
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new ExtensionManifestError(`Manifest ${manifestPath ?? '<unknown>'} bukan object JSON yang valid`);
		}
		const errors = ExtensionManifestParser.validate(raw);
		if (errors.length > 0) {
			throw new ExtensionManifestError(errors.join('; '));
		}
		return raw as IExtensionManifest;
	}

	public static validate(raw: unknown): string[] {
		const errors: string[] = [];
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
			return ['Manifest bukan object'];
		}
		const obj = raw as Record<string, unknown>;
		for (const field of REQUIRED_FIELDS) {
			if (typeof obj[field] !== 'string' || (obj[field] as string).length === 0) {
				errors.push(`Field wajib '${field}' hilang atau tidak bertipe string`);
			}
		}
		if (typeof obj.main === 'string' && obj.main.length === 0) {
			errors.push("Field 'main' tidak boleh kosong");
		}
		if (obj.activationEvents !== undefined) {
			if (!Array.isArray(obj.activationEvents) || obj.activationEvents.some(e => typeof e !== 'string')) {
				errors.push("Field 'activationEvents' harus berupa array of string");
			}
		}
		if (obj.extensionKind !== undefined) {
			const kinds = Array.isArray(obj.extensionKind) ? obj.extensionKind : [obj.extensionKind];
			for (const kind of kinds) {
				if (typeof kind !== 'string' || !['ui', 'workspace', 'workspaceOnly'].includes(kind)) {
					errors.push(`Nilai 'extensionKind' tidak dikenal: ${String(kind)}`);
				}
			}
		}
		return errors;
	}

	public static createDescriptor(extensionPath: string, manifest: IExtensionManifest): IExtensionDescriptor {
		const manifestPath = `${extensionPath.replace(/[\\/]+$/, '')}/package.json`;
		return {
			id: extensionId(manifest.publisher, manifest.name),
			manifest,
			manifestPath,
			extensionPath,
			mainPath: manifest.main ? `${extensionPath.replace(/[\\/]+$/, '')}/${manifest.main}` : undefined
		};
	}
}
