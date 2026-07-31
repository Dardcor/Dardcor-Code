import { CLIOutput } from './cli-output';

export function printStatusTable(output: CLIOutput, status: Record<string, unknown>): void {
	const entries = Object.entries(status);
	const rows: string[][] = entries.map(([key, value]) => {
		let text: string;
		if (value === null || value === undefined) {
			text = 'n/a';
		} else if (typeof value === 'object') {
			text = JSON.stringify(value);
		} else {
			text = String(value);
		}
		return [key, text];
	});
	output.table(rows);
}
