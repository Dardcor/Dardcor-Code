/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ISelfSignedCert {
	key: string;
	cert: string;
	fingerprint: string;
}

export async function generateSelfSignedCert(): Promise<ISelfSignedCert> {
	const crypto = await import('crypto');

	const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
		namedCurve: 'prime256v1',
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});

	const cert = createSelfSignedCertPem(crypto, privateKey, publicKey);

	const certDer = pemToDer(cert);
	const hash = crypto.createHash('sha256').update(certDer).digest('base64');
	const fingerprint = `sha256/${hash}`;

	return { key: privateKey, cert, fingerprint };
}

function createSelfSignedCertPem(
	crypto: typeof import('crypto'),
	privateKeyPem: string,
	publicKeyPem: string,
): string {
	const spkiDer = pemToDer(publicKeyPem);

	const serial = crypto.randomBytes(8);
	serial[0] &= 0x7f;

	const now = new Date();
	const notAfter = new Date(now);
	notAfter.setFullYear(now.getFullYear() + 1);

	const cnOid = derOid(Buffer.from([0x55, 0x04, 0x03]));

	const issuerAndSubject = derSequence([
		derSet([
			derSequence([
				cnOid,
				derUtf8String('TunnelProxy'),
			]),
		]),
	]);

	const validity = derSequence([
		derTime(now),
		derTime(notAfter),
	]);

	const version = Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02]);

	const serialNumber = derInteger(serial);

	const sigAlgOidBytes = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
	const sigAlg = derSequence([derOid(sigAlgOidBytes)]);

	const sanExtension = buildSanExtension();
	const extensions = Buffer.concat([
		Buffer.from([0xa3]),
		derLengthPrefix(derSequence([sanExtension])),
	]);

	const tbs = derSequence([
		version,
		serialNumber,
		sigAlg,
		issuerAndSubject,
		validity,
		issuerAndSubject,
		spkiDer,
		extensions,
	]);

	const signer = crypto.createSign('SHA256');
	signer.update(tbs);
	const signature = signer.sign(privateKeyPem);

	const sigBitString = Buffer.concat([
		Buffer.from([0x03]),
		derLength(signature.length + 1),
		Buffer.from([0x00]),
		signature,
	]);

	const certDer = derSequence([tbs, sigAlg, sigBitString]);

	const b64 = certDer.toString('base64');
	const lines: string[] = [];
	for (let i = 0; i < b64.length; i += 64) {
		lines.push(b64.substring(i, i + 64));
	}
	return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

function buildSanExtension(): Buffer {
	const sanOid = derOid(Buffer.from([0x55, 0x1d, 0x11]));

	const ipBytes = Buffer.from([0x87, 0x04, 0x7f, 0x00, 0x00, 0x01]);

	const sanValue = derOctetString(derSequence([ipBytes]));

	return derSequence([sanOid, sanValue]);
}


function pemToDer(pem: string): Buffer {
	const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
	return Buffer.from(b64, 'base64');
}

function derLength(length: number): Buffer {
	if (length < 0x80) {
		return Buffer.from([length]);
	} else if (length < 0x100) {
		return Buffer.from([0x81, length]);
	} else if (length < 0x10000) {
		return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
	} else if (length < 0x1000000) {
		return Buffer.from([0x83, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
	} else {
		throw new Error(`derLength: value too large (${length})`);
	}
}

function derLengthPrefix(content: Buffer): Buffer {
	return Buffer.concat([derLength(content.length), content]);
}

function derSequence(items: Buffer[]): Buffer {
	const content = Buffer.concat(items);
	return Buffer.concat([Buffer.from([0x30]), derLength(content.length), content]);
}

function derSet(items: Buffer[]): Buffer {
	const content = Buffer.concat(items);
	return Buffer.concat([Buffer.from([0x31]), derLength(content.length), content]);
}

function derInteger(value: Buffer): Buffer {
	if (value.length === 0) {
		throw new Error('derInteger: value must be non-empty');
	}
	let start = 0;
	while (start < value.length - 1 && value[start] === 0 && (value[start + 1] & 0x80) === 0) {
		start++;
	}
	let content = value.subarray(start);
	if (content[0] & 0x80) {
		content = Buffer.concat([Buffer.from([0x00]), content]);
	}
	return Buffer.concat([Buffer.from([0x02]), derLength(content.length), content]);
}

function derOid(value: Buffer): Buffer {
	return Buffer.concat([Buffer.from([0x06]), derLength(value.length), value]);
}

function derUtf8String(str: string): Buffer {
	const content = Buffer.from(str, 'utf8');
	return Buffer.concat([Buffer.from([0x0c]), derLength(content.length), content]);
}

function derOctetString(content: Buffer): Buffer {
	return Buffer.concat([Buffer.from([0x04]), derLength(content.length), content]);
}

function derTime(date: Date): Buffer {
	const iso = date.toISOString().replace(/[-:T]/g, '');
	const year = date.getUTCFullYear();
	if (year >= 1950 && year < 2050) {
		const content = Buffer.from(iso.substring(2, 14) + 'Z', 'ascii');
		return Buffer.concat([Buffer.from([0x17]), derLength(content.length), content]);
	} else {
		const content = Buffer.from(iso.substring(0, 14) + 'Z', 'ascii');
		return Buffer.concat([Buffer.from([0x18]), derLength(content.length), content]);
	}
}

