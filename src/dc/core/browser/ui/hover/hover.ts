import { IDisposable } from '../../../common/lifecycle';

export interface IHoverLifecycleOptions {
	readonly hoverPosition?: number;
	readonly groupId?: string;
}

export interface IManagedHover extends IDisposable {
	show(focus?: boolean): void;
	hide(): void;
	update(tooltip: string): void;
}

export class Hover implements IManagedHover {
	show(focus?: boolean): void {}
	hide(): void {}
	update(tooltip: string): void {}
	dispose(): void {}
}
