const STDIN_TIMEOUT_MS = 5000;

export function readStdin(): Promise<string> {
	return new Promise<string>(resolve => {
		if (typeof process === 'undefined' || !process.stdin) {
			resolve('');
			return;
		}
		const stdin = process.stdin;
		let data = '';
		let settled = false;

		const finish = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			stdin.removeListener('data', onData);
			stdin.removeListener('end', onEnd);
			stdin.removeListener('error', onError);
			resolve(data);
		};

		const onData = (chunk: Buffer | string): void => {
			data += chunk.toString();
		};

		const onEnd = (): void => {
			finish();
		};

		const onError = (): void => {
			finish();
		};

		const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
		if (typeof timer.unref === 'function') {
			timer.unref();
		}

		stdin.setEncoding('utf-8');
		stdin.on('data', onData);
		stdin.once('end', onEnd);
		stdin.once('error', onError);

		if (!stdin.isTTY) {
			stdin.resume();
		}
	});
}
