/**
 * Dardcor Code - File Tree Node File Type Icon Resolver
 */

import { getIconRegistry, registerIcon, IIconDefinition } from '../../services/theme/icon-registry';
import { CssInjector } from '../../core/dom/css-injector';
import { Path } from '../../core/types/path';

const FILE_ICONS_STYLE_ID = 'dc-file-type-icons-styles';

const EXTENSION_ICONS: Record<string, string> = {
	'': 'ext-js', '.jsx': 'ext-jsx', '.mjs': 'ext-js', '.cjs': 'ext-js',
	'.ts': 'ext-ts', '.tsx': 'ext-tsx', '.mts': 'ext-ts', '.cts': 'ext-ts',
	'.json': 'ext-json', '.jsonc': 'ext-json', '.json5': 'ext-json',
	'.html': 'ext-html', '.htm': 'ext-html', '.xml': 'ext-html', '.svg': 'ext-svg',
	'.css': 'ext-css', '.scss': 'ext-css', '.sass': 'ext-css', '.less': 'ext-css',
	'.md': 'ext-md', '.markdown': 'ext-md', '.txt': 'ext-txt', '.log': 'ext-txt',
	'.py': 'ext-py', '.go': 'ext-go', '.rs': 'ext-rs', '.java': 'ext-java',
	'.c': 'ext-c', '.h': 'ext-c', '.cpp': 'ext-cpp', '.hpp': 'ext-cpp', '.cc': 'ext-cpp',
	'.rb': 'ext-rb', '.php': 'ext-php', '.sql': 'ext-sql', '.sh': 'ext-shell',
	'.bash': 'ext-shell', '.zsh': 'ext-shell', '.ps1': 'ext-shell', '.bat': 'ext-shell', '.cmd': 'ext-shell',
	'.yml': 'ext-config', '.yaml': 'ext-config', '.toml': 'ext-config', '.ini': 'ext-config',
	'.cfg': 'ext-config', '.conf': 'ext-config', '.env': 'ext-config',
	'.png': 'ext-image', '.jpg': 'ext-image', '.jpeg': 'ext-image', '.gif': 'ext-image',
	'.ico': 'ext-image', '.webp': 'ext-image', '.bmp': 'ext-image',
	'.zip': 'ext-archive', '.tar': 'ext-archive', '.gz': 'ext-archive', '.rar': 'ext-archive',
	'.7z': 'ext-archive', '.exe': 'ext-exe', '.dll': 'ext-exe', '.msi': 'ext-exe',
	'.pdf': 'ext-pdf', '.doc': 'ext-word', '.docx': 'ext-word', '.xls': 'ext-excel', '.xlsx': 'ext-excel',
	'.ppt': 'ext-ppt', '.pptx': 'ext-ppt',
	'.lock': 'ext-lock', '.gitignore': 'ext-git', '.gitattributes': 'ext-git', '.gitmodules': 'ext-git',
	'.vue': 'ext-vue', '.svelte': 'ext-svelte', '.dart': 'ext-dart', '.swift': 'ext-swift',
	'.kt': 'ext-kotlin', '.kts': 'ext-kotlin', '.cs': 'ext-csharp', '.fs': 'ext-fsharp',
	'.scala': 'ext-scala', '.lua': 'ext-lua', '.r': 'ext-r', '.pl': 'ext-perl'
};

const NAME_ICONS: Record<string, string> = {
	'package.json': 'ext-json', 'tsconfig.json': 'ext-ts', 'tsconfig.build.json': 'ext-ts',
	'package-lock.json': 'ext-lock', 'yarn.lock': 'ext-lock', 'pnpm-lock.yaml': 'ext-lock',
	'.gitignore': 'ext-git', '.gitattributes': 'ext-git', '.editorconfig': 'ext-config',
	'readme.md': 'ext-md', 'license': 'ext-text', 'makefile': 'ext-config', 'dockerfile': 'ext-docker'
};

interface IExtensionIconDef {
	readonly id: string;
	readonly glyph: string;
	readonly color: string;
}

const ICON_DEFINITIONS: IExtensionIconDef[] = [
	{ id: 'ext-ts', glyph: 'TS', color: '#3794ff' },
	{ id: 'ext-tsx', glyph: 'TSX', color: '#3794ff' },
	{ id: 'ext-js', glyph: 'JS', color: '#e5e510' },
	{ id: 'ext-jsx', glyph: 'JSX', color: '#e5e510' },
	{ id: 'ext-json', glyph: '{}', color: '#e5e510' },
	{ id: 'ext-html', glyph: '<>', color: '#e3790d' },
	{ id: 'ext-svg', glyph: 'SVG', color: '#e3790d' },
	{ id: 'ext-css', glyph: '#', color: '#42a5f5' },
	{ id: 'ext-md', glyph: 'MD', color: '#8a8a8a' },
	{ id: 'ext-txt', glyph: 'TXT', color: '#8a8a8a' },
	{ id: 'ext-text', glyph: 'TXT', color: '#8a8a8a' },
	{ id: 'ext-py', glyph: 'PY', color: '#3572a5' },
	{ id: 'ext-go', glyph: 'GO', color: '#00add8' },
	{ id: 'ext-rs', glyph: 'RS', color: '#dea584' },
	{ id: 'ext-java', glyph: 'J', color: '#b07219' },
	{ id: 'ext-c', glyph: 'C', color: '#555555' },
	{ id: 'ext-cpp', glyph: 'C++', color: '#555555' },
	{ id: 'ext-csharp', glyph: 'C#', color: '#68217a' },
	{ id: 'ext-fsharp', glyph: 'FS', color: '#378bba' },
	{ id: 'ext-rb', glyph: 'RB', color: '#cc342d' },
	{ id: 'ext-php', glyph: 'PHP', color: '#777bb3' },
	{ id: 'ext-sql', glyph: 'SQL', color: '#e38c00' },
	{ id: 'ext-shell', glyph: '>_', color: '#89e051' },
	{ id: 'ext-config', glyph: '={}', color: '#e5e510' },
	{ id: 'ext-image', glyph: 'IMG', color: '#e3790d' },
	{ id: 'ext-archive', glyph: 'ZIP', color: '#e5e510' },
	{ id: 'ext-exe', glyph: 'EXE', color: '#b07219' },
	{ id: 'ext-pdf', glyph: 'PDF', color: '#f14c4c' },
	{ id: 'ext-word', glyph: 'W', color: '#2472c8' },
	{ id: 'ext-excel', glyph: 'X', color: '#23d18b' },
	{ id: 'ext-ppt', glyph: 'P', color: '#d670d6' },
	{ id: 'ext-lock', glyph: 'LOCK', color: '#e5e510' },
	{ id: 'ext-git', glyph: 'GIT', color: '#f14c4c' },
	{ id: 'ext-vue', glyph: 'V', color: '#23d18b' },
	{ id: 'ext-svelte', glyph: 'S', color: '#ff6b35' },
	{ id: 'ext-dart', glyph: 'D', color: '#00b4ab' },
	{ id: 'ext-swift', glyph: 'SW', color: '#f05138' },
	{ id: 'ext-kotlin', glyph: 'K', color: '#a97bff' },
	{ id: 'ext-scala', glyph: 'SC', color: '#c22d40' },
	{ id: 'ext-lua', glyph: 'LUA', color: '#000080' },
	{ id: 'ext-r', glyph: 'R', color: '#198ce7' },
	{ id: 'ext-perl', glyph: 'PL', color: '#0298c3' },
	{ id: 'ext-docker', glyph: 'DK', color: '#3794ff' }
];

let registered = false;

function ensureRegistered(): void {
	if (registered) {
		return;
	}
	registered = true;
	for (const def of ICON_DEFINITIONS) {
		const definition: IIconDefinition = { unicode: def.glyph, codepoint: def.glyph };
		registerIcon(def.id, definition, `Ikon file tipe ${def.glyph}`);
	}
	const colors = ICON_DEFINITIONS.map(def => `[data-icon-id="${def.id}"] { color: ${def.color}; }`).join('\n');
	CssInjector.inject(FILE_ICONS_STYLE_ID, `
		.dc-file-type-icon { font-size: 11px; font-weight: 700; font-family: Consolas, monospace; margin: 0 4px 0 2px; font-style: normal; }
		${colors}
	`);
}

export class FileIcons {
	public static getIconId(name: string, isDirectory: boolean): string {
		if (isDirectory) {
			return 'folder';
		}
		const lower = name.toLowerCase();
		const named = NAME_ICONS[lower];
		if (named) {
			return named;
		}
		const ext = Path.extname(lower);
		return EXTENSION_ICONS[ext] ?? 'file';
	}

	public static getIconHtml(name: string, isDirectory: boolean, expanded = false): string {
		ensureRegistered();
		if (isDirectory) {
			return getIconRegistry().renderIcon(expanded ? 'folder-open' : 'folder', 'dc-file-type-icon');
		}
		const id = FileIcons.getIconId(name, false);
		if (id === 'file' || id === 'folder') {
			return getIconRegistry().renderIcon(id, 'dc-file-type-icon');
		}
		return getIconRegistry().renderIcon(id, 'dc-file-type-icon');
	}

	public static getIconGlyph(name: string, isDirectory: boolean, expanded = false): string {
		ensureRegistered();
		const id = FileIcons.getIconId(name, isDirectory);
		const registry = getIconRegistry();
		if (id === 'folder-open' || id === 'folder') {
			return registry.getUnicode(expanded ? 'folder-open' : 'folder') ?? '\u25B8';
		}
		const unicode = registry.getUnicode(id);
		if (unicode) {
			return unicode;
		}
		return isDirectory ? '\u{1F4C1}' : '\u{1F4C4}';
	}

	public static getIconColor(name: string, isDirectory: boolean): string | undefined {
		ensureRegistered();
		if (isDirectory) {
			return undefined;
		}
		const id = FileIcons.getIconId(name, false);
		return ICON_DEFINITIONS.find(def => def.id === id)?.color;
	}

	public static getExtensionIconId(extension: string): string | undefined {
		const ext = extension.toLowerCase();
		return EXTENSION_ICONS[ext];
	}

	public static disposeStyles(): void {
		if (registered) {
			CssInjector.inject(FILE_ICONS_STYLE_ID, '');
			registered = false;
		}
	}
}
