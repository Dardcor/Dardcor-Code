/**
 * Dardcor Code - MIME Type Sniffer (Task 86)
 * Mirrors: vs/base/common/mime.ts
 */

const MIME_TEXT = 'text/plain';
const MIME_BINARY = 'application/octet-stream';
const MIME_UNKNOWN = 'application/unknown';

const EXT_TO_MIME: Record<string, string> = {
	'.txt': 'text/plain',
	'.html': 'text/html', '.htm': 'text/html',
	'.css': 'text/css',
	'': 'text/javascript', '.mjs': 'text/javascript',
	'.ts': 'text/typescript', '.tsx': 'text/typescript',
	'.json': 'application/json', '.jsonc': 'application/json',
	'.xml': 'text/xml',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.pdf': 'application/pdf',
	'.zip': 'application/zip',
	'.gz': 'application/gzip',
	'.tar': 'application/x-tar',
	'.wasm': 'application/wasm',
	'.md': 'text/markdown', '.markdown': 'text/markdown',
	'.yaml': 'text/yaml', '.yml': 'text/yaml',
	'.toml': 'text/toml',
	'.sh': 'text/x-shellscript',
	'.py': 'text/x-python',
	'.rb': 'text/x-ruby',
	'.java': 'text/x-java',
	'.c': 'text/x-c', '.h': 'text/x-c',
	'.cpp': 'text/x-c++', '.hpp': 'text/x-c++',
	'.cs': 'text/x-csharp',
	'.go': 'text/x-go',
	'.rs': 'text/x-rust',
	'.swift': 'text/x-swift',
	'.kt': 'text/x-kotlin',
	'.sql': 'text/x-sql',
	'.woff': 'font/woff', '.woff2': 'font/woff2',
	'.ttf': 'font/ttf', '.otf': 'font/otf',
	'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
	'.mp4': 'video/mp4', '.webm': 'video/webm',
};

export function getMimeByExtension(ext: string): string {
	const lower = ext.toLowerCase();
	return EXT_TO_MIME[lower] || MIME_UNKNOWN;
}

export function getMimeByFilename(filename: string): string {
	const dotIdx = filename.lastIndexOf('.');
	if (dotIdx < 0) return MIME_TEXT;
	return getMimeByExtension(filename.substring(dotIdx));
}

export function isTextMime(mime: string): boolean {
	return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/javascript';
}

export function isBinaryMime(mime: string): boolean {
	return !isTextMime(mime) && mime !== MIME_UNKNOWN;
}

export function getExtensionForMime(mime: string): string | undefined {
	for (const [ext, m] of Object.entries(EXT_TO_MIME)) {
		if (m === mime) return ext;
	}
	return undefined;
}

export function sniffMimeFromBuffer(buffer: Uint8Array): string {
	if (buffer.length === 0) return MIME_TEXT;
	// Check for null bytes (binary indicator)
	for (let i = 0; i < Math.min(buffer.length, 512); i++) {
		if (buffer[i] === 0) return MIME_BINARY;
	}
	// Check for BOM
	if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return MIME_TEXT; // UTF-8 BOM
	if (buffer[0] === 0xFF && buffer[1] === 0xFE) return MIME_TEXT; // UTF-16 LE BOM
	if (buffer[0] === 0xFE && buffer[1] === 0xFF) return MIME_TEXT; // UTF-16 BE BOM
	return MIME_TEXT;
}

export { MIME_TEXT, MIME_BINARY, MIME_UNKNOWN };
