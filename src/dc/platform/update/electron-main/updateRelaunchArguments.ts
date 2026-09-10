import { win32 } from '../../../base/common/path.js';
import { cwd } from '../../../base/common/process.js';
import { NativeParsedArgs } from '../../environment/common/argv.js';
const RELAUNCH_STRING_ARGUMENTS: readonly (keyof NativeParsedArgs)[] = [
    'user-data-dir',
    'extensions-dir',
    'builtin-extensions-dir',
    'extensions-download-dir',
    'shared-data-dir',
    'agents-user-data-dir',
    'agents-extensions-dir',
    'agent-plugins-dir',
    'locale',
    'crash-reporter-directory',
    'password-store',
    'proxy-server',
    'proxy-bypass-list',
    'proxy-pac-url',
    'force-device-scale-factor',
    'ozone-platform',
    'js-flags',
    'enable-tracing',
    'trace-startup-format',
    'trace-startup-file',
    'trace-startup-duration',
];
const RELAUNCH_FLAG_ARGUMENTS: readonly (keyof NativeParsedArgs)[] = [
    'disable-gpu',
    'disable-lcd-text',
    'disable-chromium-sandbox',
    'disable-gpu-sandbox',
    'disable-dev-shm-usage',
    'enable-coi',
    'force-renderer-accessibility',
    'enable-rdp-display-tracking',
    'ignore-certificate-errors',
    'allow-insecure-localhost',
    'disable-crash-reporter',
    'disable-telemetry',
    'disable-updates',
    'disable-workspace-trust',
    'disable-experiments',
    'disable-layout-restore',
    'use-inmemory-secretstorage',
];
const RELAUNCH_NEGATED_FLAG_ARGUMENTS = [
    'no-sandbox',
    'no-proxy-server',
] as const;
const RELAUNCH_PATH_ARGUMENTS: ReadonlySet<keyof NativeParsedArgs> = new Set([
    'user-data-dir',
    'extensions-dir',
    'builtin-extensions-dir',
    'extensions-download-dir',
    'shared-data-dir',
    'agents-user-data-dir',
    'agents-extensions-dir',
    'agent-plugins-dir',
    'crash-reporter-directory',
    'trace-startup-file',
]);
export function quoteWindowsArgument(arg: string): string {
    if (arg.length > 0 && !/[ \t"]/.test(arg)) {
        return arg;
    }
    let result = '"';
    let backslashes = 0;
    for (const ch of arg) {
        if (ch === '\\') {
            backslashes++;
        }
        else if (ch === '"') {
            result += '\\'.repeat(backslashes * 2 + 1) + '"';
            backslashes = 0;
        }
        else {
            result += '\\'.repeat(backslashes) + ch;
            backslashes = 0;
        }
    }
    result += '\\'.repeat(backslashes * 2) + '"';
    return result;
}
function toAbsolutePath(value: string, currentWorkingDirectory: string): string {
    return win32.isAbsolute(value) ? value : win32.resolve(currentWorkingDirectory, value);
}
export function getRelaunchArguments(args: NativeParsedArgs, rawArgs: readonly string[], currentWorkingDirectory: string = cwd()): string {
    const argv: string[] = [];
    for (const key of RELAUNCH_STRING_ARGUMENTS) {
        const value = args[key];
        if (typeof value === 'string' && value.length > 0) {
            argv.push(`--${key}=${RELAUNCH_PATH_ARGUMENTS.has(key) ? toAbsolutePath(value, currentWorkingDirectory) : value}`);
        }
    }
    for (const key of RELAUNCH_FLAG_ARGUMENTS) {
        if (args[key] === true) {
            argv.push(`--${key}`);
        }
    }
    const endOfOptions = rawArgs.indexOf('--');
    const rawOptions = endOfOptions === -1 ? rawArgs : rawArgs.slice(0, endOfOptions);
    for (const key of RELAUNCH_NEGATED_FLAG_ARGUMENTS) {
        if (rawOptions.includes(`--${key}`)) {
            argv.push(`--${key}`);
        }
    }
    return argv.map(quoteWindowsArgument).join(' ');
}
