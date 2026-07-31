import * as fs from 'fs';
import * as path from 'path';

export type UpdatePolicy = 'manual' | 'auto' | 'disabled';

const VALID_POLICIES: UpdatePolicy[] = ['manual', 'auto', 'disabled'];

export interface UpdatePolicyFile {
	policy: UpdatePolicy;
	channel: string;
	updatedAt: string;
}

export class UpdatePolicyManager {
	private readonly _policyFile: string;

	constructor(userDataPath?: string) {
		this._policyFile = userDataPath
			? path.join(userDataPath, 'update-policy.json')
			: path.join(getDefaultUserData(), 'update-policy.json');
	}

	public getPolicy(): UpdatePolicy {
		const fromEnv = this._fromEnv();
		if (fromEnv) {
			return fromEnv;
		}
		const fromFile = this._fromFile();
		if (fromFile) {
			return fromFile;
		}
		return 'manual';
	}

	public setPolicy(policy: UpdatePolicy): boolean {
		if (!VALID_POLICIES.includes(policy)) {
			return false;
		}
		try {
			const file: UpdatePolicyFile = {
				policy,
				channel: this.getChannel(),
				updatedAt: new Date().toISOString()
			};
			fs.mkdirSync(path.dirname(this._policyFile), { recursive: true });
			fs.writeFileSync(this._policyFile, JSON.stringify(file, null, 2), 'utf-8');
			return true;
		} catch (err) {
			console.error('[update-policy] failed to set policy:', err);
			return false;
		}
	}

	public shouldAutoUpdate(): boolean {
		return this.getPolicy() === 'auto';
	}

	public isDisabled(): boolean {
		return this.getPolicy() === 'disabled';
	}

	public getChannel(): string {
		return process.env.DC_UPDATE_CHANNEL ?? 'stable';
	}

	public getPolicyFilePath(): string {
		return this._policyFile;
	}

	public clearPolicy(): boolean {
		try {
			if (fs.existsSync(this._policyFile)) {
				fs.unlinkSync(this._policyFile);
			}
			return true;
		} catch (err) {
			console.error('[update-policy] failed to clear policy:', err);
			return false;
		}
	}

	public describe(): { policy: UpdatePolicy; channel: string; source: 'env' | 'file' | 'default' } {
		const fromEnv = this._fromEnv();
		if (fromEnv) {
			return { policy: fromEnv, channel: this.getChannel(), source: 'env' };
		}
		const fromFile = this._fromFile();
		if (fromFile) {
			return { policy: fromFile, channel: this.getChannel(), source: 'file' };
		}
		return { policy: 'manual', channel: this.getChannel(), source: 'default' };
	}

	private _fromEnv(): UpdatePolicy | null {
		const value = process.env.DC_UPDATE_POLICY;
		if (!value) {
			return null;
		}
		const normalized = value.trim().toLowerCase();
		return VALID_POLICIES.includes(normalized as UpdatePolicy) ? (normalized as UpdatePolicy) : null;
	}

	private _fromFile(): UpdatePolicy | null {
		try {
			if (!fs.existsSync(this._policyFile)) {
				return null;
			}
			const raw = fs.readFileSync(this._policyFile, 'utf-8');
			const data = JSON.parse(raw) as Partial<UpdatePolicyFile>;
			if (data.policy && VALID_POLICIES.includes(data.policy)) {
				return data.policy;
			}
			return null;
		} catch {
			return null;
		}
	}
}

function getDefaultUserData(): string {
	return process.env.DC_USER_DATA ?? path.join(process.env.APPDATA ?? process.cwd(), 'Dardcor Code');
}

export function createUpdatePolicyManager(userDataPath?: string): UpdatePolicyManager {
	return new UpdatePolicyManager(userDataPath);
}

export function getUpdatePolicy(): UpdatePolicy {
	return new UpdatePolicyManager().getPolicy();
}

export function setUpdatePolicy(policy: UpdatePolicy): boolean {
	return new UpdatePolicyManager().setPolicy(policy);
}

export function shouldAutoUpdate(): boolean {
	return new UpdatePolicyManager().shouldAutoUpdate();
}
