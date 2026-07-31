import { IDisposable } from '../../../common/lifecycle.js';

export interface IHoverLifecycleOptions {
	readonly hoverPosition?: number;
}

export interface IManagedHover extends IDisposable {
	show(focus?: boolean): void;
	hide(): void;
}

export class Hover implements IManagedHover {
	show(focus?: boolean): void {}
	hide(): void {}
	dispose(): void {}
}
