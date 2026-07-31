/**
 * Dardcor Code - Source Control Management (SCM / Git) Viewlet
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { Path } from '../../core/types/path';
import { GitService } from './git-service';
import { ScmRepository, IScmResource } from './scm-repository';
import { ScmCommitBox } from './scm-commit-box';
import { URI } from '../../core/types/uri';

const SCM_STYLE_ID = 'dc-scm-viewlet-styles';

export interface IScmViewletOptions {
	rootPath?: string;
	gitService?: GitService;
	repository?: ScmRepository;
}

const STATUS_ICONS: Record<string, string> = {
	'M': '\u270E',
	'A': '\u2795',
	'D': '\u2716',
	'R': '\u21BB',
	'C': '\u{1F4C4}',
	'U': '\u26A0',
	'?': '\u2753'
};

const STATUS_COLORS: Record<string, string> = {
	'M': '#e5e510',
	'A': '#23d18b',
	'D': '#f14c4c',
	'R': '#2472c8',
	'C': '#e5e5e5',
	'U': '#e5e510',
	'?': '#cccccc'
};

export class ScmViewlet extends Disposable {
	private readonly _onDidSelectResource = this._register(new Emitter<IScmResource>());
	readonly onDidSelectResource: Event<IScmResource> = this._onDidSelectResource.event;

	private readonly _container: HTMLElement;
	private readonly _git: GitService;
	private readonly _repository: ScmRepository;
	private readonly _commitBox: ScmCommitBox;
	private readonly _changesContainer: HTMLElement;
	private readonly _headerLabel: HTMLElement;
	private readonly _refreshButton: HTMLButtonElement;

	constructor(parentDom: HTMLElement, options: IScmViewletOptions = {}) {
		super();
		this._git = options.gitService ?? new GitService();

		CssInjector.inject(SCM_STYLE_ID, `
			.dc-scm-group-title {
				text-transform: uppercase; letter-spacing: 1px; font-size: 11px; font-weight: 600;
				color: #bbbbbb; padding: 8px 12px 4px; user-select: none;
			}
			.dc-scm-resource-row { display: flex; align-items: center; gap: 6px; padding: 2px 12px; cursor: pointer; font-size: 13px; color: #cccccc; user-select: none; }
			.dc-scm-resource-row:hover { background: #2a2d2e; }
			.dc-scm-resource-status { font-size: 11px; width: 14px; text-align: center; }
		`);

		this._container = $<HTMLElement>('div', 'dc-scm-viewlet');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		const header = $<HTMLElement>('div', 'dc-scm-header');
		header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #2a2d2e;';

		this._headerLabel = $<HTMLElement>('span', 'dc-scm-repo-name');
		this._headerLabel.style.cssText = 'font-weight:bold;font-size:12px;color:#cccccc;flex:1;';

		this._refreshButton = $<HTMLButtonElement>('button', 'dc-scm-refresh');
		this._refreshButton.textContent = '\u21BB';
		this._refreshButton.title = 'Refresh';
		this._refreshButton.style.cssText = 'background:transparent;border:none;color:#cccccc;font-size:14px;cursor:pointer;';

		header.appendChild(this._headerLabel);
		header.appendChild(this._refreshButton);
		this._container.appendChild(header);

		this._changesContainer = $<HTMLElement>('div', 'dc-scm-changes');
		this._changesContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._changesContainer);
		parentDom.appendChild(this._container);

		const rootPath = options.rootPath ?? this._detectRootPath();
		this._repository = options.repository ?? new ScmRepository(this._git, rootPath);
		this._commitBox = new ScmCommitBox(this._container, this._repository);

		this._register(addDisposableListener(this._refreshButton, 'click', () => {
			this.refresh();
		}));
		this._register(this._repository.onDidChange(() => {
			this._renderChanges();
		}));
		this._register(this._commitBox.onDidCommit(() => {
			this.refresh();
		}));
		this._register(this._commitBox.onDidError(message => {
			this._headerLabel.title = message;
		}));

		this.refresh();
	}

	get repository(): ScmRepository {
		return this._repository;
	}

	public async refresh(): Promise<void> {
		this._headerLabel.textContent = this._repository.repositoryName;
		this._refreshButton.textContent = this._repository.isRefreshing ? '\u231B' : '\u21BB';
		await this._repository.refresh();
		this._refreshButton.textContent = '\u21BB';
	}

	private _detectRootPath(): string {
		const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '';
		if (cwd) {
			return cwd.replace(/\\/g, '/');
		}
		return '';
	}

	private _renderChanges(): void {
		clearNode(this._changesContainer);

		const branch = this._repository.branchName;
		this._headerLabel.textContent = branch
			? `${this._repository.repositoryName} (${branch})`
			: this._repository.repositoryName;

		this._renderGroup('Staged Changes', this._repository.staged);
		this._renderGroup('Changes', this._repository.unstaged);
		this._renderGroup('Untracked', this._repository.untracked);

		if (!this._repository.hasChanges) {
			const empty = $('div', 'dc-scm-empty');
			empty.textContent = 'Tidak ada perubahan';
			empty.style.cssText = 'padding:12px;color:#8a8a8a;font-size:13px;';
			this._changesContainer.appendChild(empty);
		}
	}

	private _renderGroup(title: string, resources: IScmResource[]): void {
		if (resources.length === 0) {
			return;
		}
		const titleEl = $<HTMLElement>('div', 'dc-scm-group-title');
		titleEl.textContent = `${title} (${resources.length})`;
		this._changesContainer.appendChild(titleEl);

		for (const resource of resources) {
			const row = $<HTMLElement>('div', 'dc-scm-resource-row');
			const icon = $<HTMLElement>('span', 'dc-scm-resource-status');
			icon.textContent = STATUS_ICONS[resource.status] ?? resource.status;
			icon.style.color = STATUS_COLORS[resource.status] ?? '#cccccc';
			const name = $<HTMLElement>('span', 'dc-scm-resource-name');
			name.textContent = Path.basename(resource.path);
			name.title = resource.path;
			const dirLabel = $<HTMLElement>('span');
			dirLabel.textContent = Path.dirname(resource.path) === '.' ? '' : Path.dirname(resource.path);
			dirLabel.style.cssText = 'color:#8a8a8a;font-size:11px;';
			row.appendChild(icon);
			row.appendChild(name);
			row.appendChild(dirLabel);
			row.addEventListener('click', () => {
				this._onDidSelectResource.fire(resource);
			});
			this._changesContainer.appendChild(row);
		}
	}

	public getResourceUri(resource: IScmResource): URI {
		return resource.uri;
	}
}
