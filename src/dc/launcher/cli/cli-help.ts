import { CLIOutput } from './cli-output';

export function printHelp(output: CLIOutput): void {
	output.out('Dardcor Code - Command Line Interface');
	output.newline();
	output.out('Usage: dardcor-code [options] [paths...]');
	output.newline();
	output.out('To read output from another program, append \'-\' (e.g. \'ps aux | grep code | dardcor-code -\').');
	output.newline();
	output.out('Options:');
	output.out('  -h, --help                    Print usage.');
	output.out('  -v, --version                 Print version.');
	output.out('  --goto <file:line[:column]>   Open a file at a specific line and column.');
	output.out('  --diff <file1> <file2>        Open a diff editor comparing two files.');
	output.out('  --wait                        Wait for the app to exit after launching.');
	output.out('  --new-window                  Force a new instance of Dardcor Code.');
	output.out('  --user-data-dir <dir>         Specifies the directory that user data is kept in.');
	output.out('  --install-extension <ext-id|vsix-path>  Installs or updates an extension.');
	output.out('  --uninstall-extension <ext-id>          Uninstalls an extension.');
	output.out('  --list-extensions             List the installed extensions.');
	output.out('  --status                      Print diagnostic information about the environment.');
	output.out('  -                             Read file content from stdin and open it in the editor.');
	output.newline();
	output.out('Examples:');
	output.out('  dardcor-code                          Open a new window.');
	output.out('  dardcor-code src/main.ts              Open a file.');
	output.out('  dardcor-code --goto src/main.ts:42    Open a file at line 42.');
	output.out('  dardcor-code --diff a.ts b.ts         Open a diff between two files.');
	output.out('  dardcor-code --install-extension my-ext.vsix  Install a local extension.');
}
