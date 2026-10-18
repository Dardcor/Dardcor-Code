/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import es from 'event-stream';
import { basename } from 'path';
import File from 'vinyl';

export interface IInlineMetaContext {
	readonly targetPaths: string[];
	readonly packageJsonFn: () => string;
	readonly productJsonFn: () => string;
}

const packageJsonMarkerId = 'BUILD_INSERT_PACKAGE_CONFIGURATION';


export function inlineMeta(result: NodeJS.ReadWriteStream, ctx: IInlineMetaContext): NodeJS.ReadWriteStream {
	return result.pipe(es.through(function (file: File) {
		if (matchesFile(file, ctx)) {
			let content = file.contents!.toString();
			let markerFound = false;

			const packageMarker = `${packageJsonMarkerId}:"${packageJsonMarkerId}"`;
			if (content.includes(packageMarker)) {
				content = content.replace(packageMarker, JSON.stringify(JSON.parse(ctx.packageJsonFn())).slice(1, -1) );
				markerFound = true;
			}


			if (markerFound) {
				file.contents = Buffer.from(content);
			}
		}

		this.emit('data', file);
	}));
}

function matchesFile(file: File, ctx: IInlineMetaContext): boolean {
	for (const targetPath of ctx.targetPaths) {
		if (file.basename === basename(targetPath)) {
			return true;
		}
	}
	return false;
}
