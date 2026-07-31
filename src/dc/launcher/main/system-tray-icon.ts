import { app, nativeImage, NativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CANDIDATES: string[] = [
	'public/dardcor-code.png',
	'public/icon.png',
	'public/tray.png',
	'assets/icon.png',
	'assets/tray.png',
	'build/icon.png',
	'build/icon.ico',
	'resources/tray.png'
];

export function getProjectRoot(): string {
	return path.resolve(__dirname, '../../../../');
}

export function getTrayIconPath(): string {
	const root = getProjectRoot();
	for (const candidate of CANDIDATES) {
		const fullPath = path.join(root, candidate);
		try {
			if (fs.existsSync(fullPath)) {
				return fullPath;
			}
		} catch {
			continue;
		}
	}
	const appPath = app.isPackaged ? path.dirname(process.execPath) : getProjectRoot();
	for (const candidate of CANDIDATES) {
		const fullPath = path.join(appPath, candidate);
		try {
			if (fs.existsSync(fullPath)) {
				return fullPath;
			}
		} catch {
			continue;
		}
	}
	return '';
}

export function getTrayIcon(): NativeImage {
	const iconPath = getTrayIconPath();
	if (!iconPath) {
		return nativeImage.createEmpty();
	}
	try {
		const image = nativeImage.createFromPath(iconPath);
		if (!image.isEmpty()) {
			return process.platform === 'darwin' ? resizeForMac(image) : image;
		}
	} catch {
		// Fall through.
	}
	return nativeImage.createEmpty();
}

export function getTrayIconForPlatform(): NativeImage {
	return getTrayIcon();
}

export function hasTrayIcon(): boolean {
	return !getTrayIcon().isEmpty();
}

export function getTrayIconSize(): { width: number; height: number } {
	const image = getTrayIcon();
	return { width: image.getSize().width, height: image.getSize().height };
}

export function createTrayIconFromPath(iconPath: string): NativeImage {
	try {
		const image = nativeImage.createFromPath(iconPath);
		return image.isEmpty() ? nativeImage.createEmpty() : image;
	} catch {
		return nativeImage.createEmpty();
	}
}

export function createTrayIconFromBuffer(buffer: Buffer): NativeImage {
	try {
		return nativeImage.createFromBuffer(buffer);
	} catch {
		return nativeImage.createEmpty();
	}
}

function resizeForMac(image: NativeImage): NativeImage {
	const size = image.getSize();
	if (size.width <= 22 && size.height <= 22) {
		return image;
	}
	return image.resize({ width: 18, height: 18 });
}

export function getTrayIconCandidates(): string[] {
	const root = getProjectRoot();
	return CANDIDATES.map((c) => path.join(root, c));
}
