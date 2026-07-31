/**
 * Dardcor Code - Dependency Injection Annotations & Decorators
 */

export interface ServiceIdentifier<T> {
	(...args: any[]): void;
	type: T;
}

export interface ServicesAccessor {
	get<T>(id: ServiceIdentifier<T>): T;
}

export namespace _util {
	export const serviceIds = new Map<string, ServiceIdentifier<any>>();
	export const DI_TARGET = '$di$target';
	export const DI_DEPENDENCIES = '$di$dependencies';

	export function getServiceDependencies(ctor: any): { id: ServiceIdentifier<any>; index: number }[] {
		return ctor[DI_DEPENDENCIES] || [];
	}
}

export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
	if (_util.serviceIds.has(serviceId)) {
		return _util.serviceIds.get(serviceId)!;
	}

	const id = function (target: Function, _key: string, index: number) {
		storeServiceDependency(id, target, index);
	} as ServiceIdentifier<T>;

	id.toString = () => serviceId;
	_util.serviceIds.set(serviceId, id);
	return id;
}

function storeServiceDependency(id: ServiceIdentifier<unknown>, target: Function, index: number): void {
	if ((target as any)[_util.DI_TARGET] === target) {
		(target as any)[_util.DI_DEPENDENCIES].push({ id, index });
	} else {
		(target as any)[_util.DI_DEPENDENCIES] = [{ id, index }];
		(target as any)[_util.DI_TARGET] = target;
	}
}
