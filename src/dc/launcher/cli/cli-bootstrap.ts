import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLIExitCode } from './cli-exit-codes';
import { parseCLIArgs, ICLIOptions } from './cli-parser';
import { CLIOutput } from './cli-output';
import { printHelp } from './cli-help';
import { printVersion } from './cli-version';
import { printStatusTable } from './cli-status-printer';
import { readStdin } from './cli-stdin-reader';
import { launchDiff } from './cli-diff-launcher';
import { CLICommands } from './cli-commands';
import { CLIFileOpener } from './cli-file-opener';

export async function bootstrapCLI(argv: string[]): Promise<number> {
	const options = parseCLIArgs(argv);
	const output = new CLIOutput();

	if (options.help) {
		printHelp(output);
		return CLIExitCode.OK;
	}

	if (options.version) {
		printVersion(output);
		return CLIExitCode.OK;
	}

	const commands = new CLICommands();

	if (options.listExtensions) {
		const extensions = await commands.listExtensions();
		if (extensions.length === 0) {
			output.out('No extensions installed.');
		} else {
			for (const id of extensions) {
				output.out(id);
			}
		}
		return CLIExitCode.OK;
	}

	if (options.installExtension) {
		try {
			await commands.installExtension(options.installExtension);
			output.coloredOut(`Installed extension: ${options.installExtension}`, 'green');
			return CLIExitCode.OK;
		} catch (err: any) {
			output.err(err?.message ?? String(err));
			return CLIExitCode.ExtensionInstallError;
		}
	}

	if (options.uninstallExtension) {
		try {
			await commands.uninstallExtension(options.uninstallExtension);
			output.coloredOut(`Uninstalled extension: ${options.uninstallExtension}`, 'green');
			return CLIExitCode.OK;
		} catch (err: any) {
			output.err(err?.message ?? String(err));
			return CLIExitCode.ExtensionInstallError;
		}
	}

	if (options.diff) {
		await launchDiff(options.diff.left, options.diff.right);
		return CLIExitCode.OK;
	}

	if (options.status) {
		const status = await collectStatus();
		printStatusTable(output, status);
		return CLIExitCode.OK;
	}

	if (options.stdin) {
		const content = await readStdin();
		if (content.length > 0) {
			const tempPath = join(tmpDir(), `dc-stdin-${Date.now()}.txt`);
			await writeFile(tempPath, content, 'utf-8');
			await commands.openFile(tempPath);
			return CLIExitCode.OK;
		}
	}

	if (options.goto) {
		const fileOpener = new CLIFileOpener();
		const forwarded = fileOpener.openInRunningInstance([options.goto.path]);
		if (!forwarded) {
			await commands.openFile(options.goto.path);
		}
		return CLIExitCode.OK;
	}

	if (options.args.length > 0) {
		await openPaths(options, commands);
		return CLIExitCode.OK;
	}

	await commands.openFolder(process.cwd());
	return CLIExitCode.OK;
}

export async function runCLI(argv: string[]): Promise<number> {
	try {
		return await bootstrapCLI(argv);
	} catch (err: any) {
		const output = new CLIOutput();
		output.err(err?.message ?? String(err));
		if (err?.code === 'ENOENT') {
			return CLIExitCode.FileNotFound;
		}
		return CLIExitCode.GenericError;
	}
}

async function openPaths(options: ICLIOptions, commands: CLICommands): Promise<void> {
	const fileOpener = new CLIFileOpener();
	for (const arg of options.args) {
		if (arg === '-') {
			continue;
		}
		const isDir = await isDirectory(arg);
		if (fileOpener.openInRunningInstance([arg])) {
			continue;
		}
		if (isDir) {
			await commands.openFolder(arg);
		} else {
			await commands.openFile(arg);
		}
	}
}

async function collectStatus(): Promise<Record<string, unknown>> {
	const status: Record<string, unknown> = {
		Version: 'unknown'
	};
	try {
		const { readPackageJson } = await import('./cli-version');
		status.Version = readPackageJson()?.version ?? '1.0.0';
	} catch {
		// Ignore - version already defaults.
	}
	status.Platform = typeof process !== 'undefined' ? process.platform : 'unknown';
	status.Architecture = typeof process !== 'undefined' ? process.arch : 'unknown';
	status.NodeVersion = typeof process !== 'undefined' ? process.version : 'unknown';
	status.Cwd = typeof process !== 'undefined' ? process.cwd() : 'unknown';
	status.UserDataDir = process.env.DARDCOR_CODE_USER_DATA_DIR ?? 'default';
	status.ExtensionsDir = process.env.DARDCOR_CODE_EXTENSIONS_DIR ?? `${process.env.USERPROFILE ?? process.env.HOME ?? '~'}\\.dardcor-code\\extensions`;
	try {
		const mod: any = await import('electron');
		const resolved = typeof mod === 'string' ? mod : mod?.default;
		status.Electron = typeof resolved === 'string' ? 'available' : 'unavailable';
	} catch {
		status.Electron = 'unavailable';
	}
	return status;
}

function tmpDir(): string {
	return process.env.TEMP ?? process.env.TMP ?? process.env.TMPDIR ?? '.';
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		const { stat } = await import('node:fs/promises');
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}
