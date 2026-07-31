export interface IHoverDelegate2 {
	showHover(options: any, focus?: boolean): void;
}
export function getBaseLayerHoverDelegate(): any {
	return { setupManagedHover: (...args: any[]) => ({ update: () => {} }) };
}
