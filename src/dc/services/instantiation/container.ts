/**
 * Dardcor Code - InstantiationService Graph Dependency Resolver
 */

import { ServiceIdentifier, ServicesAccessor, _util, createDecorator } from './annotations';
import { ServiceCollection } from './service-registry';
import { SyncDescriptor } from './descriptors';

export { ServicesAccessor };

export const IInstantiationService = createDecorator<IInstantiationService>('instantiationService');

export interface IInstantiationService {
	readonly _serviceBrand: undefined;
	createInstance<T>(ctor: new (...args: any[]) => T, ...args: any[]): T;
	invokeFunction<R>(fn: (accessor: ServicesAccessor, ...args: any[]) => R, ...args: any[]): R;
	createChild(services: ServiceCollection): IInstantiationService;
}

export class InstantiationService implements IInstantiationService {
	declare readonly _serviceBrand: undefined;

	private readonly _services: ServiceCollection;
	private readonly _parent?: InstantiationService;

	constructor(services = new ServiceCollection(), parent?: InstantiationService) {
		this._services = services;
		this._parent = parent;
		this._services.set(IInstantiationService, this);
	}

	public createChild(services: ServiceCollection): IInstantiationService {
		return new InstantiationService(services, this);
	}

	public invokeFunction<R>(fn: (accessor: ServicesAccessor, ...args: any[]) => R, ...args: any[]): R {
		const accessor: ServicesAccessor = {
			get: <T>(id: ServiceIdentifier<T>) => this._getServiceInstanceOrDescriptor(id)
		};
		return fn(accessor, ...args);
	}

	public createInstance<T>(ctorOrDescriptor: any, ...rest: any[]): T {
		let ctor: any;
		let staticArgs: any[] = [];
		if (ctorOrDescriptor instanceof SyncDescriptor) {
			ctor = ctorOrDescriptor.ctor;
			staticArgs = ctorOrDescriptor.staticArguments.concat(rest);
		} else {
			ctor = ctorOrDescriptor;
			staticArgs = rest;
		}

		const dependencies = _util.getServiceDependencies(ctor);
		const args: any[] = [...staticArgs];

		for (const d of dependencies) {
			const service = this._getServiceInstanceOrDescriptor(d.id);
			if (!service) {
				throw new Error(`[InstantiationService] Missing dependency service '${d.id}' for '${ctor.name}'`);
			}
			args[d.index] = service;
		}

		return new ctor(...args);
	}

	private _getServiceInstanceOrDescriptor<T>(id: ServiceIdentifier<T>): T {
		let instanceOrDesc = this._services.get(id);
		if (!instanceOrDesc && this._parent) {
			return this._parent._getServiceInstanceOrDescriptor(id);
		}
		if (instanceOrDesc instanceof SyncDescriptor) {
			const instance = this.createInstance(instanceOrDesc);
			this._services.set(id, instance);
			return instance as T;
		}
		return instanceOrDesc as T;
	}
}
