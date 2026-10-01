/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN_FILE = path.join(os.homedir(), '.dardcor', 'router-token');

function getOrCreateRouterToken() {
	try {
		return fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
	} catch {
		const token = crypto.randomBytes(32).toString('hex');
		try {
			fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
			fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
		} catch {
			// Fallback if filesystem write fails
		}
		return token;
	}
}

function validateRouterAuth(req) {
	const token = getOrCreateRouterToken();
	const authHeader = req.headers['authorization'] || req.headers['x-dardcor-token'];
	if (!authHeader) {
		return false;
	}
	if (authHeader.startsWith('Bearer ')) {
		return authHeader.slice(7).trim() === token;
	}
	return authHeader.trim() === token;
}

module.exports = {
	getOrCreateRouterToken,
	validateRouterAuth,
};
