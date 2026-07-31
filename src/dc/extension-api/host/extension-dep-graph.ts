export class ExtensionDepGraphError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ExtensionDepGraphError';
	}
}

export class ExtensionDepGraph {
	private readonly _extensions = new Map<string, string[]>();

	public addExtension(extensionId: string, dependencies: string[] = []): void {
		this._extensions.set(extensionId, [...new Set(dependencies.filter(dep => dep !== extensionId))]);
	}

	public removeExtension(extensionId: string): void {
		this._extensions.delete(extensionId);
	}

	public getDependencies(extensionId: string): string[] {
		return [...(this._extensions.get(extensionId) ?? [])];
	}

	public getExtensionIds(): string[] {
		return [...this._extensions.keys()];
	}

	public hasExtension(extensionId: string): boolean {
		return this._extensions.has(extensionId);
	}

	public get size(): number {
		return this._extensions.size;
	}

	public getActivationOrder(): string[] {
		const graph = new Map<string, string[]>();
		const inDegree = new Map<string, number>();
		for (const [id] of this._extensions) {
			graph.set(id, []);
			inDegree.set(id, 0);
		}
		for (const [id, dependencies] of this._extensions) {
			for (const dependency of dependencies) {
				if (!graph.has(dependency)) {
					continue;
				}
				graph.get(dependency)!.push(id);
				inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
			}
		}
		const queue: string[] = [];
		for (const [id, degree] of inDegree) {
			if (degree === 0) {
				queue.push(id);
			}
		}
		const order: string[] = [];
		while (queue.length > 0) {
			const current = queue.shift()!;
			order.push(current);
			for (const next of graph.get(current)!) {
				const degree = (inDegree.get(next) ?? 0) - 1;
				inDegree.set(next, degree);
				if (degree === 0) {
					queue.push(next);
				}
			}
		}
		if (order.length !== graph.size) {
			const remaining = [...graph.keys()].filter(id => !order.includes(id));
			throw new ExtensionDepGraphError(`Siklus ketergantungan ekstensi terdeteksi: ${remaining.join(', ')}`);
		}
		return order;
	}

	public hasCycle(): boolean {
		try {
			this.getActivationOrder();
			return false;
		} catch (err) {
			if (err instanceof ExtensionDepGraphError) {
				return true;
			}
			throw err;
		}
	}

	public getActivationOrderFor(extensionId: string): string[] {
		const full = this.getActivationOrder();
		const index = full.indexOf(extensionId);
		if (index === -1) {
			throw new ExtensionDepGraphError(`Ekstensi '${extensionId}' tidak terdaftar`);
		}
		return full.slice(0, index + 1);
	}

	public clear(): void {
		this._extensions.clear();
	}
}
