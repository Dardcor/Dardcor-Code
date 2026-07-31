export interface ExtensionDefinition {
	name: string;
	extensions: string[];
}

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
	typescript: ['ts', 'tsx', 'mts', 'cts'],
	javascript: ['js', 'jsx', 'mjs', 'cjs'],
	json: ['json', 'jsonc', 'json5'],
	html: ['html', 'htm', 'xhtml'],
	css: ['css', 'scss', 'sass', 'less', 'styl'],
	markdown: ['md', 'markdown', 'mdown'],
	images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
	python: ['py', 'pyw', 'ipynb'],
	c: ['c', 'h'],
	cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'],
	csharp: ['cs'],
	java: ['java', 'class'],
	rust: ['rs'],
	go: ['go'],
	php: ['php', 'phtml'],
	ruby: ['rb', 'erb', 'rake'],
	swift: ['swift'],
	kotlin: ['kt', 'kts'],
	dart: ['dart'],
	yaml: ['yaml', 'yml'],
	toml: ['toml'],
	xml: ['xml', 'xsl', 'xsd', 'svg'],
	sql: ['sql', 'sqlite'],
	shell: ['sh', 'bash', 'zsh', 'fish'],
	powershell: ['ps1', 'psm1', 'psd1'],
	batch: ['bat', 'cmd'],
	git: ['gitignore', 'gitattributes'],
	env: ['env', 'properties'],
	text: ['txt', 'log', 'ini', 'cfg', 'conf'],
	videos: ['mp4', 'webm', 'mkv', 'mov', 'avi'],
	audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a'],
	fonts: ['ttf', 'otf', 'woff', 'woff2'],
	archives: ['zip', 'tar', 'gz', 'rar', '7z']
};

export function getAllFilesFilter(): Electron.FileFilter {
	return { name: 'All Files', extensions: ['*'] };
}

export function getFileDialogFilters(): Electron.FileFilter[] {
	return [
		getAllFilesFilter(),
		{ name: 'TypeScript', extensions: LANGUAGE_EXTENSIONS.typescript },
		{ name: 'JavaScript', extensions: LANGUAGE_EXTENSIONS.javascript },
		{ name: 'JSON', extensions: LANGUAGE_EXTENSIONS.json },
		{ name: 'HTML', extensions: LANGUAGE_EXTENSIONS.html },
		{ name: 'CSS', extensions: LANGUAGE_EXTENSIONS.css },
		{ name: 'Markdown', extensions: LANGUAGE_EXTENSIONS.markdown },
		{ name: 'Images', extensions: LANGUAGE_EXTENSIONS.images },
		{ name: 'Python', extensions: LANGUAGE_EXTENSIONS.python },
		{ name: 'C/C++', extensions: [...LANGUAGE_EXTENSIONS.c, ...LANGUAGE_EXTENSIONS.cpp] },
		{ name: 'Text', extensions: LANGUAGE_EXTENSIONS.text },
		{ name: 'YAML', extensions: LANGUAGE_EXTENSIONS.yaml },
		{ name: 'XML', extensions: LANGUAGE_EXTENSIONS.xml }
	];
}

export function getExtensionFilters(extensions: string[]): Electron.FileFilter[] {
	const cleaned = extensions
		.map((ext) => ext.replace(/^\.+/, '').toLowerCase())
		.filter((ext) => ext && ext !== '*');
	const filters: Electron.FileFilter[] = [{ name: 'All Files', extensions: ['*'] }];
	if (cleaned.length === 0) {
		return filters;
	}
	filters.push({ name: 'Selected Files', extensions: cleaned });
	return filters;
}

export function getImageFilters(): Electron.FileFilter[] {
	return [{ name: 'Images', extensions: LANGUAGE_EXTENSIONS.images }];
}

export function getCodeFilters(): Electron.FileFilter[] {
	return [
		getAllFilesFilter(),
		{ name: 'TypeScript', extensions: LANGUAGE_EXTENSIONS.typescript },
		{ name: 'JavaScript', extensions: LANGUAGE_EXTENSIONS.javascript },
		{ name: 'JSON', extensions: LANGUAGE_EXTENSIONS.json },
		{ name: 'HTML', extensions: LANGUAGE_EXTENSIONS.html },
		{ name: 'CSS', extensions: LANGUAGE_EXTENSIONS.css },
		{ name: 'Markdown', extensions: LANGUAGE_EXTENSIONS.markdown }
	];
}

export function getLanguageFilter(language: string): Electron.FileFilter {
	const normalized = language.toLowerCase();
	const extensions = LANGUAGE_EXTENSIONS[normalized];
	if (extensions && extensions.length > 0) {
		const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
		return { name: label, extensions };
	}
	return { name: language, extensions: ['*'] };
}

export function getKnownLanguages(): string[] {
	return Object.keys(LANGUAGE_EXTENSIONS);
}

export function getExtensionsForLanguage(language: string): string[] {
	return LANGUAGE_EXTENSIONS[language.toLowerCase()] ?? [];
}

export function getLanguageForFile(filePath: string): string {
	const extension = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase() : '';
	for (const [language, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
		if (extensions.includes(extension)) {
			return language;
		}
	}
	return 'text';
}

export function normalizeExtension(ext: string): string {
	return ext.replace(/^\.+/, '').toLowerCase();
}

export function buildFilterFromNames(names: string[]): Electron.FileFilter[] {
	const filter: Electron.FileFilter = { name: names.join(', '), extensions: names.map(normalizeExtension) };
	return [getAllFilesFilter(), filter];
}
