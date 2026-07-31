/**
 * Dardcor Code - Platform & OS Detectors
 */

declare const process: any;

const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const processPlatform = typeof process !== 'undefined' && process.platform ? process.platform : '';

export const isWindows = processPlatform === 'win32' || userAgent.indexOf('Windows') >= 0;
export const isMacintosh = processPlatform === 'darwin' || userAgent.indexOf('Macintosh') >= 0;
export const isLinux = processPlatform === 'linux' || userAgent.indexOf('Linux') >= 0;
export const isWeb = typeof window !== 'undefined' && typeof window.document !== 'undefined' && typeof process === 'undefined';
export const isElectron = typeof process !== 'undefined' && typeof process.versions !== 'undefined' && !!process.versions.electron;

export const OperatingSystem = {
	Windows: 1,
	Macintosh: 2,
	Linux: 3,
} as const;

export type OperatingSystem = typeof OperatingSystem[keyof typeof OperatingSystem];

export const OS: OperatingSystem = isMacintosh ? OperatingSystem.Macintosh : isWindows ? OperatingSystem.Windows : OperatingSystem.Linux;
