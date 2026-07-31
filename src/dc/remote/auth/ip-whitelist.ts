import { Emitter, Event } from '../../core/events/emitter';

export interface IIpWhitelistOptions {
	readonly ips?: ReadonlyArray<string>;
	readonly defaultAllow?: boolean;
}

interface CidrRule {
	readonly ipv4: number;
	readonly prefix: number;
}

export function isIpv4(ip: string): boolean {
	const parts = ip.split('.');
	if (parts.length !== 4) {
		return false;
	}
	return parts.every(part => {
		if (!/^\d{1,3}$/.test(part)) {
			return false;
		}
		const value = Number(part);
		return value >= 0 && value <= 255;
	});
}

export function ipv4ToInt(ip: string): number {
	const parts = ip.split('.');
	return ((Number(parts[0]) << 24) >>> 0) + (Number(parts[1]) << 16) + (Number(parts[2]) << 8) + Number(parts[3]);
}

export function intToIpv4(value: number): string {
	return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
}

export function parseIpRule(rule: string): CidrRule | null {
	const trimmed = rule.trim();
	if (!trimmed) {
		return null;
	}
	const cidrMatch = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(trimmed);
	if (cidrMatch) {
		const ip = cidrMatch[1];
		if (!isIpv4(ip)) {
			return null;
		}
		const prefix = Number(cidrMatch[2]);
		if (prefix < 0 || prefix > 32) {
			return null;
		}
		return { ipv4: ipv4ToInt(ip) >>> 0, prefix };
	}
	if (trimmed.includes('*')) {
		const parts = trimmed.split('.');
		if (parts.length !== 4) {
			return null;
		}
		const prefixBits: number[] = [];
		for (const part of parts) {
			if (part === '*') {
				prefixBits.push(0);
			} else if (/^\d{1,3}$/.test(part)) {
				const value = Number(part);
				if (value > 255) {
					return null;
				}
				let bits = 8;
				for (let i = 7; i >= 0; i--) {
					if ((value & (1 << i)) !== 0) {
						bits = 8 - i;
						break;
					}
				}
				prefixBits.push(bits);
			} else {
				return null;
			}
		}
		const maskParts = prefixBits.map(bits => {
			const value = bits === 0 ? 0 : (0xff << (8 - bits)) & 0xff;
			return value;
		});
		const mask = ((maskParts[0] << 24) >>> 0) + (maskParts[1] << 16) + (maskParts[2] << 8) + maskParts[3];
		const baseParts = trimmed.split('.').map(part => (part === '*' ? '0' : part));
		return {
			ipv4: ipv4ToInt(baseParts.join('.')) & mask,
			prefix: prefixBits.reduce((sum, bits) => sum + bits, 0)
		};
	}
	if (isIpv4(trimmed)) {
		return { ipv4: ipv4ToInt(trimmed) >>> 0, prefix: 32 };
	}
	return null;
}

export function ruleMatches(rule: CidrRule, ipInt: number): boolean {
	if (rule.prefix === 0) {
		return true;
	}
	const mask = rule.prefix === 32 ? 0xffffffff : (0xffffffff << (32 - rule.prefix)) >>> 0;
	return (ipInt & mask) === (rule.ipv4 & mask);
}

export class IpWhitelist {
	private readonly _rules: CidrRule[] = [];
	private _defaultAllow: boolean;

	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(options: IIpWhitelistOptions = {}) {
		this._defaultAllow = options.defaultAllow ?? false;
		if (options.ips) {
			this.set(options.ips);
		}
	}

	get defaultAllow(): boolean {
		return this._defaultAllow;
	}

	setDefaultAllow(allow: boolean): void {
		if (this._defaultAllow !== allow) {
			this._defaultAllow = allow;
			this._onDidChange.fire();
		}
	}

	set(ips: ReadonlyArray<string>): void {
		this._rules.length = 0;
		for (const ip of ips) {
			const rule = parseIpRule(ip);
			if (rule) {
				this._rules.push(rule);
			}
		}
		this._onDidChange.fire();
	}

	add(ip: string): boolean {
		const rule = parseIpRule(ip);
		if (!rule) {
			return false;
		}
		if (this._rules.some(r => r.ipv4 === rule.ipv4 && r.prefix === rule.prefix)) {
			return false;
		}
		this._rules.push(rule);
		this._onDidChange.fire();
		return true;
	}

	remove(ip: string): boolean {
		const rule = parseIpRule(ip);
		if (!rule) {
			return false;
		}
		const index = this._rules.findIndex(r => r.ipv4 === rule.ipv4 && r.prefix === rule.prefix);
		if (index === -1) {
			return false;
		}
		this._rules.splice(index, 1);
		this._onDidChange.fire();
		return true;
	}

	allows(ip: string): boolean {
		if (!isIpv4(ip)) {
			return this._defaultAllow;
		}
		const ipInt = ipv4ToInt(ip) >>> 0;
		if (this._rules.length === 0) {
			return this._defaultAllow;
		}
		return this._rules.some(rule => ruleMatches(rule, ipInt));
	}

	denies(ip: string): boolean {
		return !this.allows(ip);
	}

	isAllowed(request: { remoteAddress?: string | null; socket?: { remoteAddress?: string } }): boolean {
		const address = request.remoteAddress ?? request.socket?.remoteAddress;
		if (!address) {
			return this._defaultAllow;
		}
		return this.allows(address);
	}

	toArray(): string[] {
		return this._rules.map(rule => {
			if (rule.prefix === 32) {
				return intToIpv4(rule.ipv4);
			}
			return `${intToIpv4(rule.ipv4)}/${rule.prefix}`;
		});
	}

	get count(): number {
		return this._rules.length;
	}

	clear(): void {
		if (this._rules.length > 0) {
			this._rules.length = 0;
			this._onDidChange.fire();
		}
	}
}
