/**
 * Dardcor Code - Extension Runtime Dependency Tree Installer Resolver
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { IExtensionInfo } from './extensions-viewlet.js';

export interface IExtensionDependencyNode {
	readonly extension: IExtensionInfo | undefined;
	readonly id: string;
	readonly missing: boolean;
	readonly children: IExtensionDependencyNode[];
}

export interface IDependencyResolution {
	readonly root: IExtensionDependencyNode;
	readonly installOrder: string[];
	readonly missing: string[];
	readonly cycles: string[][];
}

export class ExtensionDependencies extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _extensions: Map<string, IExtensionInfo>;
	private readonly _dependencyMap: Map<string, string[]>;

	constructor(extensions: IExtensionInfo[] = []) {
		super();
		this._extensions = new Map();
		this._dependencyMap = new Map();
		for (const ext of extensions) {
			this._extensions.set(ext.id, ext);
		}
	}

	public registerExtension(extension: IExtensionInfo, dependencies: string[] = []): void {
		this._extensions.set(extension.id, extension);
		this._dependencyMap.set(extension.id, dependencies);
		this._onDidChange.fire();
	}

	public registerDependencies(extensionId: string, dependencies: string[]): void {
		this._dependencyMap.set(extensionId, [...dependencies]);
		this._onDidChange.fire();
	}

	public getDependencies(extensionId: string): string[] {
		return [...(this._dependencyMap.get(extensionId) ?? [])];
	}

	public resolve(id: string): IDependencyResolution {
		const nodes = new Map<string, IExtensionDependencyNode>();
		const visited = new Map<string, number>();
		const stack: string[] = [];
		const cycles: string[][] = [];
		const installOrder: string[] = [];
		const installed = new Set<string>();
		const missing: string[] = [];

		const buildNode = (currentId: string, depth: number): IExtensionDependencyNode => {
			let node = nodes.get(currentId);
			if (node) {
				return node;
			}
			const extension = this._extensions.get(currentId);
			node = {
				extension,
				id: currentId,
				missing: !extension,
				children: []
			};
			nodes.set(currentId, node);

			if (visited.get(currentId) === 1) {
				stack.push(currentId);
				return node;
			}
			if (visited.get(currentId) === 2) {
				return node;
			}
			visited.set(currentId, 1);
			stack.push(currentId);

			for (const depId of this.getDependencies(currentId)) {
				const child = buildNode(depId, depth + 1);
				node.children.push(child);
				if (stack.includes(depId)) {
					const cycleStart = stack.indexOf(depId);
					cycles.push([...stack.slice(cycleStart), depId]);
				}
			}

			stack.pop();
			visited.set(currentId, 2);

			if (!extension) {
				if (!missing.includes(currentId)) {
					missing.push(currentId);
				}
			} else if (!extension.installed) {
				if (!installOrder.includes(currentId)) {
					installOrder.push(currentId);
				}
			} else {
				installed.add(currentId);
			}
			return node;
		};

		const root = buildNode(id, 0);
		return { root, installOrder, missing, cycles };
	}

	public getMissingDependencies(id: string): string[] {
		return this.resolve(id).missing;
	}

	public getInstallOrder(id: string): string[] {
		const resolution = this.resolve(id);
		const ordered: string[] = [];
		const seen = new Set<string>();
		const visit = (node: IExtensionDependencyNode): void => {
			for (const child of node.children) {
				visit(child);
			}
			if (node.extension && !node.extension.installed && !seen.has(node.id)) {
				seen.add(node.id);
				ordered.push(node.id);
			}
		};
		visit(resolution.root);
		return ordered;
	}

	public canInstall(id: string): boolean {
		return this.getMissingDependencies(id).length === 0;
	}
}
