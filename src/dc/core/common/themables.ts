export interface ThemeIcon {
	readonly id: string;
	readonly color?: any;
}

export namespace ThemeIcon {
	export function isThemeIcon(thing: any): thing is ThemeIcon {
		return thing && typeof thing === 'object' && typeof thing.id === 'string';
	}
	export function asClassName(icon: ThemeIcon): string {
		return `codicon codicon-${icon.id}`;
	}
	export function asClassNameArray(icon: ThemeIcon): string[] {
		return ['codicon', `codicon-${icon.id}`];
	}
}

export class Themable {}
export function registerThemingParticipant() {}
