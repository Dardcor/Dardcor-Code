import { ExtensionHostService } from './extension-service';
import { ExtensionUnhandledRejections } from './extension-unhandled-rejections';
import { applyV8Flags } from './extension-v8-flags';

export interface IExtensionHostMainOptions {
	readonly extensionHostDebugPort?: number;
	readonly extensionDevelopmentPaths?: string[];
}

export function startExtensionHostMain(): void {
	if (typeof process === 'undefined' || typeof process.argv === 'undefined') {
		throw new Error('Extension Host hanya dapat dijalankan pada Node');
	}
	main();
}

export function main(): void {
	if (typeof process === 'undefined') {
		throw new Error('Extension Host hanya dapat dijalankan pada Node');
	}
	applyV8Flags();
	new ExtensionUnhandledRejections().install();

	const args = process.argv;
	const debugPort = readArgValue(args, '--extensionHostDebugPort');
	if (debugPort !== undefined) {
		const inspect = `--inspect=${debugPort}`;
		if (!process.execArgv.includes(inspect)) {
			process.execArgv.push(inspect);
		}
	}
	const developmentPaths = readArgValues(args, '--extensionDevelopmentPath');
	if (developmentPaths.length === 0) {
		console.log('[extension-host] Tidak ada --extensionDevelopmentPath; tidak ada ekstensi yang dimuat');
		return;
	}
	const service = new ExtensionHostService({
		extensionHostDebugPort: debugPort !== undefined ? Number(debugPort) : undefined
	});
	service.activateExtensions(developmentPaths, 'startup')
		.then(() => {
			console.log(`[extension-host] ${service.getActivatedExtensions().length} ekstensi berhasil diaktifkan`);
		})
		.catch(err => {
			console.error('[extension-host] Gagal mengaktifkan ekstensi:', err);
			process.exitCode = 1;
		});
}

export function readArgValue(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	if (index === -1 || index + 1 >= args.length) {
		return undefined;
	}
	return args[index + 1];
}

export function readArgValues(args: string[], flag: string): string[] {
	const values: string[] = [];
	const prefix = `${flag}=`;
	for (const arg of args) {
		if (arg.startsWith(prefix)) {
			values.push(arg.substring(prefix.length));
			continue;
		}
	}
	for (let i = 0; i < args.length - 1; i++) {
		if (args[i] === flag) {
			values.push(args[i + 1]);
		}
	}
	return values;
}

if (typeof process !== 'undefined' && typeof process.argv !== 'undefined' && process.argv[1] !== undefined && isExtensionHostEntry(process.argv[1])) {
	startExtensionHostMain();
}

function isExtensionHostEntry(entry: string): boolean {
	return entry.replace(/\\/g, '/').endsWith('extension-host-main') || entry.replace(/\\/g, '/').endsWith('extension-host-main.ts');
}
