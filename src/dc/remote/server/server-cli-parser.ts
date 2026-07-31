/**
 * Dardcor Code - Remote Server CLI Argument Parser (Task 822)
 */

export enum ServerCliLogLevel {
	Debug = 0,
	Info = 1,
	Warn = 2,
	Error = 3,
	Silent = 4
}

export interface ServerCliOptions {
	port: number;
	host: string;
	token?: string;
	workspaceRoot: string;
	logLevel: ServerCliLogLevel;
	help: boolean;
	version: boolean;
}

export const DEFAULT_SERVER_PORT = 8080;
export const DEFAULT_SERVER_HOST = '127.0.0.1';

export function parseLogLevel(value: string): ServerCliLogLevel {
	switch (value.toLowerCase()) {
		case 'debug': return ServerCliLogLevel.Debug;
		case 'info': return ServerCliLogLevel.Info;
		case 'warn':
		case 'warning': return ServerCliLogLevel.Warn;
		case 'error': return ServerCliLogLevel.Error;
		case 'silent':
		case 'off': return ServerCliLogLevel.Silent;
		default: throw new Error(`Unknown log level '${value}' (expected debug, info, warn, error or silent)`);
	}
}

export class ServerCliParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ServerCliParseError';
	}
}

export function parseServerCliArgs(argv: string[]): ServerCliOptions {
	const options: ServerCliOptions = {
		port: DEFAULT_SERVER_PORT,
		host: DEFAULT_SERVER_HOST,
		workspaceRoot: typeof process !== 'undefined' ? process.cwd() : '/',
		logLevel: ServerCliLogLevel.Info,
		help: false,
		version: false
	};

	const takeValue = (args: string[], index: number, flag: string): string => {
		const inline = args[index].startsWith(`${flag}=`);
		if (inline) {
			return args[index].slice(flag.length + 1);
		}
		const value = args[index + 1];
		if (value === undefined || value.startsWith('-')) {
			throw new ServerCliParseError(`Missing value for flag '${flag}'`);
		}
		return value;
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			options.help = true;
		} else if (arg === '--version' || arg === '-v') {
			options.version = true;
		} else if (arg.startsWith('--port')) {
			const value = takeValue(argv, i, '--port');
			const port = Number(value);
			if (!Number.isInteger(port) || port < 0 || port > 65535) {
				throw new ServerCliParseError(`Invalid port '${value}' (expected 0-65535)`);
			}
			options.port = port;
			if (!arg.includes('=')) {
				i++;
			}
		} else if (arg.startsWith('--host')) {
			options.host = takeValue(argv, i, '--host');
			if (!arg.includes('=')) {
				i++;
			}
		} else if (arg.startsWith('--token')) {
			options.token = takeValue(argv, i, '--token');
			if (!arg.includes('=')) {
				i++;
			}
		} else if (arg.startsWith('--workspace') || arg.startsWith('--root')) {
			const flag = arg.startsWith('--workspace') ? '--workspace' : '--root';
			options.workspaceRoot = takeValue(argv, i, flag);
			if (!arg.includes('=')) {
				i++;
			}
		} else if (arg.startsWith('--log-level')) {
			const value = takeValue(argv, i, '--log-level');
			options.logLevel = parseLogLevel(value);
			if (!arg.includes('=')) {
				i++;
			}
		}
	}
	return options;
}

export function printServerHelp(): string {
	return [
		'Dardcor Code - Remote Server Daemon',
		'',
		'Usage: node server-main.js [options]',
		'',
		'Options:',
		'  --port <number>       Port to listen on (default: 8080)',
		'  --host <host>         Bind address (default: 127.0.0.1)',
		'  --token <token>       Bearer token required by clients',
		'  --workspace <path>    Workspace root served by the daemon (default: cwd)',
		'  --log-level <level>   debug, info, warn, error or silent (default: info)',
		'  --help, -h            Show this help',
		'  --version, -v         Print the server version'
	].join('\n');
}
