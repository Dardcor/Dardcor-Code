import { Disposable } from '../../core/lifecycle/disposable.js';

export interface IViewPart {
	render(container: HTMLElement): void;
	dispose?(): void;
}

export class ViewParts extends Disposable {
	private readonly _parts = new Map<string, IViewPart>();

	public addPart(id: string, part: IViewPart): void {
		this._parts.set(id, part);
	}

	public removePart(id: string): boolean {
		const part = this._parts.get(id);
		if (!part) {
			return false;
		}
		part.dispose?.();
		return this._parts.delete(id);
	}

	public renderAll(container: HTMLElement): void {
		for (const part of this._parts.values()) {
			part.render(container);
		}
	}

	public renderPart(id: string, container: HTMLElement): void {
		const part = this._parts.get(id);
		if (part) {
			part.render(container);
		}
	}

	public getPart<T extends IViewPart>(id: string): T | undefined {
		return this._parts.get(id) as T | undefined;
	}

	public getParts(): IViewPart[] {
		return Array.from(this._parts.values());
	}

	public getPartIds(): string[] {
		return Array.from(this._parts.keys());
	}

	public hasPart(id: string): boolean {
		return this._parts.has(id);
	}

	public getPartCount(): number {
		return this._parts.size;
	}

	public clear(): void {
		for (const id of Array.from(this._parts.keys())) {
			this.removePart(id);
		}
	}

	override dispose(): void {
		for (const part of this._parts.values()) {
			part.dispose?.();
		}
		this._parts.clear();
		super.dispose();
	}
}
