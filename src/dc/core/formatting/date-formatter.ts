/**
 * Dardcor Code - Date & Relative Time Formatter
 */

export namespace DateFormatter {
	export function formatRelative(date: Date | number): string {
		const now = Date.now();
		const timestamp = typeof date === 'number' ? date : date.getTime();
		const diffSeconds = Math.floor((now - timestamp) / 1000);

		if (diffSeconds < 60) return 'just now';
		if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
		if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
		return `${Math.floor(diffSeconds / 86400)}d ago`;
	}
}
