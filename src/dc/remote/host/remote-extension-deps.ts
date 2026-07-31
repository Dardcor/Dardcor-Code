export interface IExtensionManifest {
	readonly name?: string;
	readonly publisher?: string;
	readonly version?: string;
	readonly extensionDependencies?: string[];
	readonly extensionPack?: string[];
	readonly engines?: Record<string, string>;
}

export function getExtensionId(manifest: IExtensionManifest): string {
	if (manifest.publisher && manifest.name) {
		return `${manifest.publisher}.${manifest.name}`;
	}
	return manifest.name ?? '';
}

export function parseExtensionDependencies(manifest: IExtensionManifest | undefined): string[] {
	if (!manifest) {
		return [];
	}
	const deps = manifest.extensionDependencies ?? [];
	const pack = manifest.extensionPack ?? [];
	const result: string[] = [];
	for (const dep of [...deps, ...pack]) {
		if (typeof dep === 'string' && dep && !result.includes(dep)) {
			result.push(dep);
		}
	}
	return result;
}

export function isDependencySatisfied(dependency: string, installed: Iterable<string>): boolean {
	const versions = dependency.split('@');
	const base = versions[0];
	for (const id of installed) {
		if (id === dependency || id === base) {
			return true;
		}
		if (id.startsWith(`${base}@`)) {
			return true;
		}
	}
	return false;
}

export class RemoteExtensionDeps {
	private readonly _dependencyMap = new Map<string, string[]>();

	registerDependencies(extensionId: string, dependencies: string[]): void {
		this._dependencyMap.set(extensionId, [...dependencies]);
	}

	resolveDeps(extensionManifest: IExtensionManifest | string[]): string[] {
		if (Array.isArray(extensionManifest)) {
			return [...extensionManifest];
		}
		return parseExtensionDependencies(extensionManifest);
	}

	resolveAll(extensionId: string): string[] {
		const visited = new Set<string>();
		const result: string[] = [];
		const visit = (id: string, chain: string[] = []): void => {
			if (visited.has(id)) {
				return;
			}
			if (chain.includes(id)) {
				throw new Error(`Circular extension dependency detected: ${[...chain, id].join(' -> ')}`);
			}
			visited.add(id);
			const deps = this._dependencyMap.get(id) ?? [];
			for (const dep of deps) {
				visit(dep, [...chain, id]);
				if (!result.includes(dep)) {
					result.push(dep);
				}
			}
		};
		visit(extensionId);
		return result;
	}

	topologicalOrder(entries: Array<{ id: string; dependencies: string[] }>): string[] {
		const order: string[] = [];
		const visited = new Set<string>();
		const visiting = new Set<string>();
		const edges = new Map<string, string[]>(entries.map(entry => [entry.id, entry.dependencies]));
		const visit = (id: string): void => {
			if (visited.has(id)) {
				return;
			}
			if (visiting.has(id)) {
				return;
			}
			visiting.add(id);
			for (const dep of edges.get(id) ?? []) {
				visit(dep);
			}
			visiting.delete(id);
			visited.add(id);
			order.push(id);
		};
		for (const entry of entries) {
			visit(entry.id);
		}
		return order;
	}

	missingDeps(installed: string[], extensionManifest?: IExtensionManifest): string[] {
		const needed = extensionManifest ? parseExtensionDependencies(extensionManifest) : [];
		return needed.filter(dep => !isDependencySatisfied(dep, installed));
	}

	findMissing(installed: Iterable<string>, dependencies: string[]): string[] {
		return dependencies.filter(dep => !isDependencySatisfied(dep, installed));
	}

	getInstallOrder(manifests: Map<string, IExtensionManifest>, rootIds: string[]): string[] {
		const entries: Array<{ id: string; dependencies: string[] }> = [];
		const seen = new Set<string>();
		const collect = (id: string): void => {
			if (seen.has(id)) {
				return;
			}
			seen.add(id);
			const manifest = manifests.get(id);
			const deps = manifest ? parseExtensionDependencies(manifest) : [];
			for (const dep of deps) {
				collect(dep);
			}
			entries.push({ id, dependencies: deps });
		};
		for (const id of rootIds) {
			collect(id);
		}
		return this.topologicalOrder(entries);
	}

	hasUnresolved(extensionId: string): boolean {
		const deps = this._dependencyMap.get(extensionId) ?? [];
		return deps.some(dep => !this._dependencyMap.has(dep.split('@')[0]));
	}

	toJson(): string {
		return JSON.stringify([...this._dependencyMap.entries()], null, 2);
	}
}
