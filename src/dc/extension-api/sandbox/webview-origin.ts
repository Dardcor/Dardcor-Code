const GLOBAL_ALLOCATED = new Set<string>();

export class WebviewOrigin {
	private readonly _origins = new Set<string>();

	public allocateOrigin(): string {
		let origin = '';
		do {
			origin = `https://webview-${crypto.randomUUID()}.vscode-webview.net`;
		} while (GLOBAL_ALLOCATED.has(origin));
		GLOBAL_ALLOCATED.add(origin);
		this._origins.add(origin);
		return origin;
	}

	public get allocatedOrigins(): string[] {
		return [...this._origins];
	}

	public hasOrigin(origin: string): boolean {
		return this._origins.has(origin);
	}

	public clear(): void {
		for (const origin of this._origins) {
			GLOBAL_ALLOCATED.delete(origin);
		}
		this._origins.clear();
	}
}
