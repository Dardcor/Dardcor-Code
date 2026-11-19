/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
/* eslint require-await: "error" */
import fs = require("node:fs")

export async function readConfig(location?: string) {
	if (!location) {
		location = "~/.config/program/.default";
	}
	const s = fs.readFileSync(location, 'utf8')
	return JSON.parse(s)
}
