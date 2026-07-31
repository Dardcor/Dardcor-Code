export interface IGotoLocation {
	path: string;
	line?: number;
	column?: number;
}

export interface IDiffTargets {
	left: string;
	right: string;
}

export interface ICLIOptions {
	goto?: IGotoLocation;
	diff?: IDiffTargets;
	wait?: boolean;
	userDataDir?: string;
	newWindow?: boolean;
	installExtension?: string;
	uninstallExtension?: string;
	listExtensions?: boolean;
	version?: boolean;
	help?: boolean;
	status?: boolean;
	stdin?: boolean;
	args: string[];
}

const OPTIONS_WITH_VALUE = new Set<string>([
	'--goto',
	'--diff',
	'--user-data-dir',
	'--install-extension',
	'--uninstall-extension'
]);

const FLAG_OPTIONS = new Set<string>([
	'--wait',
	'--new-window',
	'--list-extensions',
	'--version',
	'-v',
	'--help',
	'-h',
	'--status'
]);

export function parseCLIArgs(argv: string[]): ICLIOptions {
	const options: ICLIOptions = { args: [] };
	let pendingOption: string | null = null;
	let pendingValues: string[] = [];

	const applyValue = (option: string, value: string): void => {
		switch (option) {
			case '--goto':
				options.goto = parseGoto(value);
				break;
			case '--diff':
				pendingValues.push(value);
				if (pendingValues.length === 2) {
					options.diff = { left: pendingValues[0], right: pendingValues[1] };
					pendingValues = [];
				}
				break;
			case '--user-data-dir':
				options.userDataDir = value;
				break;
			case '--install-extension':
				options.installExtension = value;
				break;
			case '--uninstall-extension':
				options.uninstallExtension = value;
				break;
		}
	};

	const applyFlag = (flag: string): void => {
		switch (flag) {
			case '--wait':
				options.wait = true;
				break;
			case '--new-window':
				options.newWindow = true;
				break;
			case '--list-extensions':
				options.listExtensions = true;
				break;
			case '--version':
			case '-v':
				options.version = true;
				break;
			case '--help':
			case '-h':
				options.help = true;
				break;
			case '--status':
				options.status = true;
				break;
		}
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (pendingOption) {
			applyValue(pendingOption, arg);
			pendingOption = null;
			continue;
		}
		if (arg === '--') {
			options.args.push(...argv.slice(i + 1));
			break;
		}
		if (arg === '-') {
			options.stdin = true;
			options.args.push(arg);
			continue;
		}
		if (OPTIONS_WITH_VALUE.has(arg)) {
			pendingOption = arg;
			pendingValues = [];
			continue;
		}
		if (FLAG_OPTIONS.has(arg)) {
			applyFlag(arg);
			continue;
		}
		if (arg.startsWith('-')) {
			continue;
		}
		options.args.push(arg);
	}

	return options;
}

export function parseGoto(value: string): IGotoLocation {
	const parts = value.split(':');
	if (parts.length >= 3) {
		const line = Number(parts[parts.length - 2]);
		const column = Number(parts[parts.length - 1]);
		if (!isNaN(line) && !isNaN(column)) {
			return { path: parts.slice(0, parts.length - 2).join(':'), line, column };
		}
	}
	if (parts.length >= 2) {
		const line = Number(parts[parts.length - 1]);
		if (!isNaN(line)) {
			return { path: parts.slice(0, parts.length - 1).join(':'), line };
		}
	}
	return { path: value };
}
