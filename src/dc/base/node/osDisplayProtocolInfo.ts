/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { constants as FSConstants, promises as FSPromises } from 'fs';
import { join } from '../common/path.js';
import { env } from '../common/process.js';

const XDG_SESSION_TYPE = 'XDG_SESSION_TYPE';
const WAYLAND_DISPLAY = 'WAYLAND_DISPLAY';
const XDG_RUNTIME_DIR = 'XDG_RUNTIME_DIR';

const enum DisplayProtocolType {
	Wayland = 'wayland',
	XWayland = 'xwayland',
	X11 = 'x11',
	Unknown = 'unknown'
}

export async function getDisplayProtocol(errorLogger: (error: string | Error) => void): Promise<DisplayProtocolType> {
	const xdgSessionType = env[XDG_SESSION_TYPE];

	if (xdgSessionType) {
		return xdgSessionType === DisplayProtocolType.Wayland || xdgSessionType === DisplayProtocolType.X11 ? xdgSessionType : DisplayProtocolType.Unknown;
	} else {
		const waylandDisplay = env[WAYLAND_DISPLAY];

		if (!waylandDisplay) {
			return DisplayProtocolType.X11;
		} else {
			const xdgRuntimeDir = env[XDG_RUNTIME_DIR];

			if (!xdgRuntimeDir) {
				return DisplayProtocolType.Unknown;
			} else {
				const waylandServerPipe = join(xdgRuntimeDir, 'wayland-0');

				try {
					await FSPromises.access(waylandServerPipe, FSConstants.R_OK);

					return DisplayProtocolType.Wayland;
				} catch (err) {
					errorLogger(err);
					return DisplayProtocolType.Unknown;
				}
			}
		}
	}
}


export function getCodeDisplayProtocol(displayProtocol: DisplayProtocolType, ozonePlatform: string | undefined): DisplayProtocolType {
	if (!ozonePlatform) {
		return displayProtocol === DisplayProtocolType.Wayland ? DisplayProtocolType.XWayland : DisplayProtocolType.X11;
	} else {
		switch (ozonePlatform) {
			case 'auto':
				return displayProtocol;
			case 'x11':
				return displayProtocol === DisplayProtocolType.Wayland ? DisplayProtocolType.XWayland : DisplayProtocolType.X11;
			case 'wayland':
				return DisplayProtocolType.Wayland;
			default:
				return DisplayProtocolType.Unknown;
		}
	}
}
