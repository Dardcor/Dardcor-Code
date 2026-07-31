export function localize(key: string | number, message: string, ...args: any[]): string {
	if (!args || args.length === 0) {
		return message;
	}
	return message.replace(/\{(\d+)\}/g, (match, index) => {
		const idx = parseInt(index, 10);
		return idx < args.length ? String(args[idx]) : match;
	});
}

export function localize2(key: string, message: string, ...args: any[]): { value: string; original: string } {
	return {
		value: localize(key, message, ...args),
		original: message
	};
}
