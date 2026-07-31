import * as Electron from 'electron';
import { TouchBar, nativeImage } from 'electron';

const ANY_ELECTRON = Electron as any;
const TouchBarButtonCtor = ANY_ELECTRON.TouchBarButton;
const TouchBarLabelCtor = ANY_ELECTRON.TouchBarLabel;
const TouchBarSpacerCtor = ANY_ELECTRON.TouchBarSpacer;
const TouchBarPopoverCtor = ANY_ELECTRON.TouchBarPopover;

export interface TouchBarAction {
	label: string;
	callback?: () => void;
	iconPath?: string;
	backgroundColor?: string;
	enabled?: boolean;
}

export interface TouchBarGroup {
	type: 'button' | 'label' | 'spacer' | 'flex-space';
	label?: string;
	callback?: () => void;
	iconPath?: string;
	width?: 'small' | 'large' | 'flexible';
	backgroundColor?: string;
	textColor?: string;
}

export function isTouchBarSupported(): boolean {
	return process.platform === 'darwin' && typeof TouchBar === 'function' && typeof TouchBarButtonCtor === 'function';
}

export function buildTouchBar(actions: TouchBarAction[]): Electron.TouchBar | null {
	if (!isTouchBarSupported()) {
		return null;
	}
	const items: Electron.TouchBarButton[] = [];
	for (const action of actions) {
		const options: any = {
			label: action.label,
			backgroundColor: action.backgroundColor ?? '#007aff',
			enabled: action.enabled ?? true,
			click: () => action.callback?.()
		};
		if (action.iconPath) {
			try {
				const icon = nativeImage.createFromPath(action.iconPath);
				if (!icon.isEmpty()) {
					options.icon = icon;
				}
			} catch {
				// Icon optional.
			}
		}
		items.push(new TouchBarButtonCtor(options));
	}
	return new TouchBar({ items });
}

export function buildCustomTouchBar(groups: TouchBarGroup[]): Electron.TouchBar | null {
	if (!isTouchBarSupported()) {
		return null;
	}
	const items: any[] = [];
	for (const group of groups) {
		switch (group.type) {
			case 'button': {
				const options: any = {
					label: group.label ?? '',
					backgroundColor: group.backgroundColor,
					click: () => group.callback?.()
				};
				if (group.iconPath) {
					try {
						const icon = nativeImage.createFromPath(group.iconPath);
						if (!icon.isEmpty()) {
							options.icon = icon;
						}
					} catch {
						// Ignore.
					}
				}
				items.push(new TouchBarButtonCtor(options));
				break;
			}
			case 'label':
				items.push(new TouchBarLabelCtor({ label: group.label ?? '', textColor: group.textColor }));
				break;
			case 'spacer':
				items.push(new TouchBarSpacerCtor({ size: group.width === 'large' ? 'large' : group.width === 'flexible' ? 'flexible' : 'small' }));
				break;
			case 'flex-space':
				items.push(new TouchBarSpacerCtor({ size: 'flexible' }));
				break;
		}
	}
	return new TouchBar({ items });
}

export function getTouchBar(): Electron.TouchBar | null {
	return null;
}

export function buildDefaultTouchBar(callbacks: { onNewFile?: () => void; onSave?: () => void; onRun?: () => void; onUndo?: () => void; onRedo?: () => void; onSettings?: () => void } = {}): Electron.TouchBar | null {
	return buildTouchBar([
		{ label: 'New', callback: callbacks.onNewFile },
		{ label: 'Save', callback: callbacks.onSave },
		{ label: 'Run', backgroundColor: '#28a745', callback: callbacks.onRun },
		{ label: 'Undo', callback: callbacks.onUndo },
		{ label: 'Redo', callback: callbacks.onRedo },
		{ label: 'Settings', callback: callbacks.onSettings }
	]);
}

export function buildTouchBarWithPopover(title: string, label: string, actions: TouchBarAction[]): Electron.TouchBar | null {
	if (!isTouchBarSupported()) {
		return null;
	}
	const inner = buildCustomTouchBar(actions.map((a) => ({ type: 'button' as const, ...a })));
	const popover = new TouchBarPopoverCtor({
		label,
		items: inner ?? new TouchBar({ items: [] })
	});
	return new TouchBar({ items: [popover] });
}

export function installTouchBar(window: Electron.BrowserWindow, actions: TouchBarAction[]): boolean {
	if (!isTouchBarSupported()) {
		return false;
	}
	const touchBar = buildTouchBar(actions);
	if (!touchBar) {
		return false;
	}
	window.setTouchBar(touchBar);
	return true;
}
