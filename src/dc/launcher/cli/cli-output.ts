export type CLIColor = 'red' | 'green' | 'yellow' | 'cyan';

const ANSI_CODES: Record<CLIColor, string> = {
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m'
};

const ANSI_RESET = '\x1b[0m';

export class CLIOutput {
	private readonly _stdout: NodeJS.WritableStream;
	private readonly _stderr: NodeJS.WritableStream;

	constructor(stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream) {
		this._stdout = stdout ?? process.stdout;
		this._stderr = stderr ?? process.stderr;
	}

	public out(message: string): void {
		this._stdout.write(message + '\n');
	}

	public err(message: string): void {
		this._stderr.write(message + '\n');
	}

	public table(rows: string[][]): void {
		const widths = this._columnWidths(rows);
		for (const row of rows) {
			const cells = row.map((cell, i) => {
				const pad = i < widths.length ? widths[i] : 0;
				return this._pad(cell, pad);
			});
			this.out(cells.join('  ').trimEnd());
		}
	}

	public coloredOut(message: string, color: CLIColor): void {
		if (this.isTTY()) {
			this.out(`${ANSI_CODES[color]}${message}${ANSI_RESET}`);
		} else {
			this.out(message);
		}
	}

	public isTTY(): boolean {
		return !!(this._stdout as any).isTTY;
	}

	public newline(): void {
		this.out('');
	}

	private _columnWidths(rows: string[][]): number[] {
		const widths: number[] = [];
		for (const row of rows) {
			for (let i = 0; i < row.length; i++) {
				widths[i] = Math.max(widths[i] ?? 0, row[i].length);
			}
		}
		return widths;
	}

	private _pad(value: string, width: number): string {
		return value.length >= width ? value : value + ' '.repeat(width - value.length);
	}
}
