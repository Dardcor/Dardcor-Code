let backend = null;
let isResizing = false;
let startY = 0;
let startFlex = 1;
let contextItem = null;
let contextIsStaged = false;
let isConvCommit = false;
let currentBranchName = "main";

function setTheme(colors) {
    document.documentElement.style.setProperty('--bg-color', colors.background);
    document.documentElement.style.setProperty('--text-main', colors.foreground);
    document.documentElement.style.setProperty('--text-muted', '#858585');
    document.documentElement.style.setProperty('--hover-bg', colors.hover || colors.background);
    document.documentElement.style.setProperty('--border-color', colors.border);
    document.documentElement.style.setProperty('--commit-bg', colors.accent);
    document.documentElement.style.setProperty('--commit-hover', colors.accent_hover || colors.accent);
    document.documentElement.style.setProperty('--badge-bg', colors.accent);
    document.documentElement.style.setProperty('--badge-text', '#ffffff');
    document.documentElement.style.setProperty('--menu-bg', colors.background);
    document.documentElement.style.setProperty('--menu-border', colors.border);
}

window.onload = function() {
    new QWebChannel(qt.webChannelTransport, function(channel) {
        backend = channel.objects.gitBridge;

        backend.filesUpdated.connect(updateFiles);
        backend.graphUpdated.connect(updateGraph);
        backend.blameReady.connect(onBlameReady);
        backend.stashUpdated.connect(updateStashes);
        backend.branchUpdated.connect(updateBranches);
        backend.remotesUpdated.connect(updateRemotes);
        backend.tagsUpdated.connect(updateTags);
        backend.syncStatus.connect(onSyncStatus);
        backend.autoFetchStatus.connect(onAutoFetchStatus);

        backend.requestRefresh();
        loadBranches();
        loadStashes();
        loadRemotes();
        loadTags();
        loadConflicted();
        updateCurrentBranch();
    });

    const commitMsg = document.getElementById('commitMsg');
    document.getElementById('commitBtn').onclick = () => commitChanges();
    commitMsg.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commitChanges();
        }
    });

    const resizer = document.getElementById('resizer');
    const topPane = document.getElementById('changesContainer');
    const bottomPane = document.getElementById('graphContainer');

    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        startY = e.clientY;
        const topHeight = topPane.getBoundingClientRect().height;
        const bottomHeight = bottomPane.getBoundingClientRect().height;
        const totalHeight = topHeight + bottomHeight;
        startFlex = totalHeight ? topHeight / totalHeight : 0.5;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
    });

    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;
        const container = document.querySelector('.split-view');
        const containerHeight = container.getBoundingClientRect().height - resizer.getBoundingClientRect().height;
        const topHeight = e.clientY - container.getBoundingClientRect().top;
        let newFlex = containerHeight ? topHeight / containerHeight : 0.5;
        if (newFlex < 0.1) newFlex = 0.1;
        if (newFlex > 0.9) newFlex = 0.9;
        topPane.style.flex = newFlex;
        bottomPane.style.flex = 1 - newFlex;
    });

    document.addEventListener('mouseup', function() {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = 'default';
        }
    });

    const topMenuBtn = document.getElementById('topMenuBtn');
    const topContextMenu = document.getElementById('topContextMenu');
    topMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        topContextMenu.style.display = (topContextMenu.style.display === 'none') ? 'block' : 'none';
        topMenuBtn.classList.toggle('active');
    });

    document.addEventListener('click', () => {
        document.getElementById('topContextMenu').style.display = 'none';
        topMenuBtn.classList.remove('active');
        hideFileContextMenu();
        document.getElementById('commitContextMenu').style.display = 'none';
    });
};

// ======================== COMMIT ========================

function buildConventionalHeader(msg) {
    const type = document.getElementById('commitType').value;
    const scope = document.getElementById('commitScope').value;
    const breaking = document.getElementById('breakingCheck').checked;
    let header = type;
    if (scope) header += `(${scope})`;
    if (breaking) header += '!';
    header += `: ${msg}`;
    return header;
}

function commitChanges() {
    const msg = document.getElementById('commitMsg').value;
    if (!backend || !msg.trim()) return;

    const amend = document.getElementById('amendCheck').checked;
    const signoff = document.getElementById('signoffCheck').checked;

    if (amend) {
        const finalMsg = isConvCommit ? buildConventionalHeader(msg) : msg;
        const amendMsg = (signoff && !finalMsg.includes('Signed-off-by'))
            ? finalMsg + '\n\nSigned-off-by: Dardcor'
            : finalMsg;
        backend.amendCommit(amendMsg);
    } else if (isConvCommit) {
        backend.commitConventional(
            document.getElementById('commitType').value,
            document.getElementById('commitScope').value,
            msg,
            document.getElementById('breakingCheck').checked,
            signoff
        );
    } else if (signoff) {
        backend.commitSigned(msg);
    } else {
        backend.commit(msg);
    }

    document.getElementById('commitMsg').value = '';
    document.getElementById('amendCheck').checked = false;
    document.getElementById('signoffCheck').checked = false;
    document.getElementById('breakingCheck').checked = false;
    document.getElementById('commitScope').value = '';
    updateCommitBtnText();
}

function updateCommitBtnText() {
    const btn = document.getElementById('commitBtnText');
    const amend = document.getElementById('amendCheck').checked;
    if (amend && isConvCommit) {
        btn.textContent = 'Amend (CC)';
    } else if (amend) {
        btn.textContent = 'Amend';
    } else if (isConvCommit) {
        btn.textContent = 'Commit (CC)';
    } else {
        btn.textContent = 'Commit';
    }
}

function toggleConvCommit() {
    isConvCommit = !isConvCommit;
    document.getElementById('convCommitRow').style.display = isConvCommit ? 'flex' : 'none';
    document.getElementById('convToggle').style.background = isConvCommit ? '#500099' : '#3c3c3c';
    updateCommitBtnText();
}

function toggleAmend() {
    const cb = document.getElementById('amendCheck');
    cb.checked = !cb.checked;
    updateCommitBtnText();
}

function toggleSignoff() {
    const cb = document.getElementById('signoffCheck');
    cb.checked = !cb.checked;
}

function showCommitMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('commitContextMenu');
    menu.style.display = 'block';
    menu.style.left = (event.clientX - 120) + 'px';
    menu.style.top = (event.clientY - 80) + 'px';
}

// ======================== STAGE / UNSTAGE ========================

function stageAllChanges() {
    if (backend) backend.stageAll();
}

function unstageAllChanges() {
    if (backend) backend.unstageAll();
}

function toggleFileStage(path, checked, isStaged) {
    if (!backend) return;
    if (checked && !isStaged) {
        backend.stageFile(path);
    } else if (!checked && isStaged) {
        backend.unstageFile(path);
    }
}

// ======================== CONTEXT MENU ========================

function hideFileContextMenu() {
    const menu = document.getElementById('fileContextMenu');
    if (menu) menu.style.display = 'none';
    contextItem = null;
}

function showFileContextMenu(event, item, isStaged) {
    event.preventDefault();
    event.stopPropagation();
    contextItem = item;
    contextIsStaged = isStaged;
    const menu = document.getElementById('fileContextMenu');
    const actions = isStaged
        ? [
            { label: 'Open File', action: () => backend.openFile(item.path) },
            { label: 'Open Staged Changes', action: () => backend.openStagedDiff(item.path) },
            { label: 'Unstage Changes', action: () => backend.unstageFile(item.path) },
            { label: 'Git Blame', action: () => backend.openBlame(item.path) },
        ]
        : [
            { label: 'Open File', action: () => backend.openFile(item.path) },
            { label: 'Open Changes', action: () => backend.openDiff(item.path) },
            { label: 'Stage Changes', action: () => backend.stageFile(item.path) },
            { label: 'Discard Changes', action: () => {
                if (confirm(`Discard changes in ${item.name}?`)) backend.discardFile(item.path);
            }},
            { label: 'Git Blame', action: () => backend.openBlame(item.path) },
        ];

    menu.innerHTML = actions.map((entry, i) =>
        `<div class="menu-item" data-action="${i}">${entry.label}</div>`
    ).join('');
    menu.style.display = 'block';
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.querySelectorAll('.menu-item').forEach((node, i) => {
        node.onclick = (e) => { e.stopPropagation(); actions[i].action(); hideFileContextMenu(); };
    });
}

// ======================== TOGGLES ========================

function toggleSection(sectionId, menuItem) {
    const section = document.getElementById(sectionId);
    const checkIcon = menuItem.querySelector('.menu-check');
    if (section.style.display === 'none') {
        section.style.display = 'flex';
        checkIcon.innerHTML = '<i class="codicon codicon-check"></i>';
        if (sectionId === 'branchesContainer') loadBranches();
        if (sectionId === 'stashContainer') loadStashes();
        if (sectionId === 'remotesContainer') loadRemotes();
        if (sectionId === 'tagsContainer') loadTags();
    } else {
        section.style.display = 'none';
        checkIcon.innerHTML = '';
    }
}

function toggleSectionCollapse(bodyId, chevronId) {
    const body = document.getElementById(bodyId);
    const chevron = document.getElementById(chevronId);
    if (body.style.display === 'none') {
        body.style.display = 'block';
        chevron.className = 'codicon codicon-chevron-down';
    } else {
        body.style.display = 'none';
        chevron.className = 'codicon codicon-chevron-right';
    }
}

function toggleGroup(itemsId, chevronId) {
    const items = document.getElementById(itemsId);
    const chevron = document.getElementById(chevronId);
    if (items.style.display === 'none') {
        items.style.display = 'block';
        chevron.className = 'codicon codicon-chevron-down';
    } else {
        items.style.display = 'none';
        chevron.className = 'codicon codicon-chevron-right';
    }
}

// ======================== FILE LIST RENDERING ========================

let lastStagedStr = "";
let lastUnstagedStr = "";

function updateFiles(stagedStr, unstagedStr) {
    if (stagedStr === lastStagedStr && unstagedStr === lastUnstagedStr) return;
    lastStagedStr = stagedStr;
    lastUnstagedStr = unstagedStr;

    const staged = JSON.parse(stagedStr);
    const unstaged = JSON.parse(unstagedStr);

    renderList('stagedItems', 'stagedBadge', 'stagedGroup', staged, true);
    renderList('changesItems', 'changesBadge', 'changesGroup', unstaged, false);
    loadConflicted();
}

function getIconUrl(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const baseUrl = '../../assets/icons/';
    const iconMap = {
        'py': 'python', 'html': 'html', 'css': 'css', 'js': 'js',
        'json': 'json', 'md': 'md', 'ts': 'ts', 'vue': 'vue',
        'jsx': 'react', 'tsx': 'react', 'php': 'php', 'java': 'java',
        'c': 'cpp', 'cpp': 'cpp', 'cs': 'csharp', 'go': 'go',
        'rs': 'rust', 'rb': 'ruby', 'sql': 'sql', 'yaml': 'yaml',
        'yml': 'yaml', 'xml': 'xml', 'sh': 'shell', 'bat': 'shell', 'ps1': 'shell'
    };
    if (filename === '.gitignore' || filename === '.git') return `${baseUrl}git.svg`;
    if (filename.startsWith('.env')) return `${baseUrl}env.svg`;
    if (filename === 'package.json' || filename === 'package-lock.json') return `${baseUrl}npm.svg`;
    if (filename === 'tsconfig.json' || filename === 'tsconfig.node.json' || ext === 'tsbuildinfo') return `${baseUrl}tsconfig.svg`;
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'];
    if (imageExts.includes(ext)) return `${baseUrl}image.svg`;
    return `${baseUrl}${iconMap[ext] || 'file'}.svg`;
}

function renderList(containerId, badgeId, groupId, items, isStaged) {
    const container = document.getElementById(containerId);
    const badge = document.getElementById(badgeId);
    const group = document.getElementById(groupId);

    container.innerHTML = '';
    badge.innerText = items.length;

    group.style.display = items.length === 0 ? 'none' : 'block';
    if (items.length === 0) return;

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'tree-item';
        div.onclick = () => {
            if (!backend) return;
            if (isStaged) backend.openStagedDiff(item.path);
            else backend.openDiff(item.path);
        };
        div.oncontextmenu = (event) => showFileContextMenu(event, item, isStaged);

        const iconUrl = getIconUrl(item.name);
        const statusClass = (item.status === 'U' || item.status === 'A' || item.status === '??') ? 'status-u'
            : (item.status === 'D') ? 'status-d' : 'status-m';
        let displayStatus = item.status;
        if (displayStatus === '??' || displayStatus === 'A') displayStatus = 'U';

        div.innerHTML = `
            <div class="file-check" onclick="event.stopPropagation()">
                <input type="checkbox" ${isStaged ? 'checked' : ''} onchange="toggleFileStage('${escapeJs(item.path)}', this.checked, ${isStaged})">
            </div>
            <div class="file-icon-img">
                <img src="${iconUrl}" width="16" height="16" onerror="this.src='../../assets/icons/file.svg'">
            </div>
            <span class="file-name" style="color: ${(statusClass === 'status-u') ? 'var(--status-u)' : 'var(--text-main)'}">${escapeHtml(item.name)}</span>
            <span class="file-dir">${escapeHtml(item.dir || '')}</span>
            <span class="file-status ${statusClass}">${displayStatus}</span>
        `;
        container.appendChild(div);
    });
}

function escapeJs(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ======================== CURRENT BRANCH ========================

function updateCurrentBranch() {
    if (!backend) return;
    backend.getCurrentBranch().then(function(name) {
        if (name) {
            currentBranchName = name;
            document.getElementById('currentBranch').textContent = name;
            document.getElementById('branchFrom').textContent = name;
        }
    });
}

// ======================== BRANCH MANAGEMENT ========================

function loadBranches() {
    if (!backend) return;
    backend.getBranches().then(updateBranches);
}

function updateBranches(dataStr) {
    const data = JSON.parse(dataStr);
    currentBranchName = data.current || currentBranchName;
    document.getElementById('currentBranch').textContent = currentBranchName;
    document.getElementById('branchFrom').textContent = currentBranchName;
    renderBranches(data);
}

function renderBranches(data) {
    const container = document.getElementById('branchesList');
    container.innerHTML = '';
    const allBranches = (data.local || []).concat(data.remote || []);
    const filter = (document.getElementById('branchFilter').value || '').toLowerCase();

    const filtered = filter ? allBranches.filter(b => b.name.toLowerCase().includes(filter)) : allBranches;

    filtered.forEach(b => {
        const div = document.createElement('div');
        div.className = 'branch-item' + (b.current ? ' current' : '');
        const isCurrent = b.current;
        div.innerHTML = `
            ${isCurrent ? '<span class="branch-indicator"><i class="codicon codicon-check"></i></span>' : '<span style="width:16px"></span>'}
            <span class="branch-name ${isCurrent ? 'current-b' : ''}">${escapeHtml(b.name)} ${b.remote ? '<span style="color:#888;font-size:10px">(remote)</span>' : ''}</span>
            <span style="color:#888;font-size:11px">${b.hash || ''}</span>
            ${!b.remote ? '<div class="action-btn small" title="Checkout" onclick="event.stopPropagation();doCheckout(\'' + escapeJs(b.name) + '\')"><i class="codicon codicon-check"></i></div>' : ''}
            ${!b.remote && !isCurrent ? '<div class="action-btn small" title="Delete" onclick="event.stopPropagation();if(confirm(\'Delete branch ' + escapeJs(b.name) + '?\'))doDeleteBranch(\'' + escapeJs(b.name) + '\')"><i class="codicon codicon-close"></i></div>' : ''}
        `;
        div.onclick = () => { if (!b.remote) doCheckout(b.name); };
        container.appendChild(div);
    });
}

function filterBranches() {
    loadBranches();
}

function doCheckout(name) {
    if (!backend) return;
    backend.checkoutBranch(name);
}

function doDeleteBranch(name) {
    if (!backend) return;
    backend.deleteBranch(name, false);
}

function showCreateBranchDialog() {
    document.getElementById('newBranchName').value = '';
    document.getElementById('createBranchDialog').style.display = 'flex';
    setTimeout(() => document.getElementById('newBranchName').focus(), 100);
}

function doCreateBranch() {
    const name = document.getElementById('newBranchName').value.trim();
    const from = document.getElementById('branchFrom').textContent;
    if (!name || !backend) return;
    backend.createBranch(name, from);
    hideDialog('createBranchDialog');
    loadBranches();
}

function showMergeDialog() {
    if (!backend) return;
    backend.getBranches().then(function(dataStr) {
        const data = JSON.parse(dataStr);
        const sel = document.getElementById('mergeBranchSelect');
        sel.innerHTML = '';
        (data.local || []).forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.name;
            opt.textContent = b.name + (b.current ? ' (current)' : '');
            sel.appendChild(opt);
        });
        document.getElementById('mergeDialog').style.display = 'flex';
    });
}

function doMerge() {
    const branch = document.getElementById('mergeBranchSelect').value;
    if (!branch || !backend) return;
    backend.mergeBranch(branch);
    hideDialog('mergeDialog');
}

function hideDialog(id) {
    document.getElementById(id).style.display = 'none';
}

// ======================== STASH MANAGEMENT ========================

function loadStashes() {
    if (!backend) return;
    backend.getStashList().then(updateStashes);
}

function updateStashes(dataStr) {
    const stashes = JSON.parse(dataStr);
    document.getElementById('stashBadge').textContent = stashes.length;
    const container = document.getElementById('stashList');
    container.innerHTML = '';
    if (stashes.length === 0) {
        container.innerHTML = '<div style="padding:8px 22px;color:#858585;font-style:italic">No stashes</div>';
        return;
    }
    stashes.forEach(s => {
        const div = document.createElement('div');
        div.className = 'stash-item';
        div.innerHTML = `
            <span class="stash-subject">${escapeHtml(s.subject || 'no message')}</span>
            <span class="stash-hash">${escapeHtml(s.name)}</span>
            <span class="stash-actions">
                <button class="mini-btn" title="Apply" onclick="event.stopPropagation();stashApply(${s.index})"><i class="codicon codicon-reply"></i></button>
                <button class="mini-btn" title="Pop" onclick="event.stopPropagation();stashPop(${s.index})"><i class="codicon codicon-export"></i></button>
                <button class="mini-btn danger" title="Drop" onclick="event.stopPropagation();if(confirm('Drop stash?'))stashDrop(${s.index})"><i class="codicon codicon-trash"></i></button>
            </span>
        `;
        container.appendChild(div);
    });
}

function stashApply(index) {
    if (backend) backend.stashApply(index);
}

function stashPop(index) {
    if (backend) backend.popStash();
}

function stashDrop(index) {
    if (backend) backend.stashDrop(index);
}

function showStashDialog() {
    document.getElementById('stashMsg').value = '';
    document.getElementById('stashDialog').style.display = 'flex';
    setTimeout(() => document.getElementById('stashMsg').focus(), 100);
}

function doStashPush() {
    const msg = document.getElementById('stashMsg').value.trim();
    if (backend && msg) {
        backend.stashPush(msg);
    } else if (backend) {
        backend.stashChanges();
    }
    hideDialog('stashDialog');
}

// ======================== BLAME ========================

function doBlame() {
    const path = document.getElementById('blamePath').value.trim();
    if (!path || !backend) return;
    backend.openBlame(path);
}

function onBlameReady(path, dataStr) {
    const data = JSON.parse(dataStr);
    const container = document.getElementById('blameResult');
    container.innerHTML = '';

    if (data.error) {
        container.innerHTML = `<div style="padding:8px;color:#f14c4c">${escapeHtml(data.error)}</div>`;
        return;
    }
    if (!Array.isArray(data) || data.length === 0) {
        container.innerHTML = '<div style="padding:8px;color:#858585">No blame data</div>';
        return;
    }

    document.getElementById('blamePath').value = path;
    document.getElementById('blameItems').style.display = 'block';
    document.getElementById('blameChevron').className = 'codicon codicon-chevron-down';

    // Group by commit for compact display
    let lastCommit = '';
    data.forEach(line => {
        const div = document.createElement('div');
        div.className = 'blame-line';

        const commitShort = line.commit ? line.commit.substring(0, 7) : '------';
        const author = (line.author || 'Unknown').substring(0, 15);
        let timeStr = '';
        if (line.time) {
            const d = new Date(parseInt(line.time) * 1000);
            timeStr = d.toLocaleDateString();
        }
        const isNewCommit = commitShort !== lastCommit;
        lastCommit = commitShort;

        div.innerHTML = `
            <span class="blame-commit" style="${isNewCommit ? '' : 'opacity:0'}">${commitShort}</span>
            <span class="blame-author" style="${isNewCommit ? '' : 'opacity:0'}">${escapeHtml(author)}</span>
            <span class="blame-date" style="${isNewCommit ? '' : 'opacity:0'}">${timeStr}</span>
            <span class="blame-text">${escapeHtml(line.content || '')}</span>
        `;
        container.appendChild(div);
    });
}

// ======================== SYNC / PUSH / PULL / FETCH ========================

function showSyncStatus(msg, isError) {
    const el = document.getElementById('syncStatus');
    el.textContent = msg;
    el.style.display = 'block';
    el.style.color = isError ? '#f14c4c' : '#73c991';
    setTimeout(() => { if (el.textContent === msg) el.style.display = 'none'; }, 5000);
}

function onSyncStatus(msg) {
    showSyncStatus(msg, msg && msg.toLowerCase().includes('fail'));
}

function onAutoFetchStatus(msg) {
    showSyncStatus(msg, msg && msg.toLowerCase().includes('fail'));
}

function doFetch() {
    if (!backend) return;
    showSyncStatus('Fetching...', false);
    backend.fetch().then(function(result) {
        showSyncStatus(result || 'Fetch complete', false);
    });
}

function doPull() {
    if (!backend) return;
    showSyncStatus('Pulling...', false);
    backend.pull().then(function(result) {
        showSyncStatus(result || 'Pull complete', !result || result.includes('fail'));
        updateCurrentBranch();
        loadBranches();
    });
}

function doPush() {
    if (!backend) return;
    showSyncStatus('Pushing...', false);
    backend.push().then(function(result) {
        showSyncStatus(result || 'Push complete', !result || result.includes('fail'));
    });
}

function doSync() {
    if (!backend) return;
    showSyncStatus('Syncing...', false);
    backend.sync().then(function(result) {
        showSyncStatus(result || 'Sync complete', !result || result.includes('fail'));
        updateCurrentBranch();
        loadBranches();
    });
}

let autoFetchOn = true;

function toggleAutoFetch() {
    autoFetchOn = !autoFetchOn;
    const btn = document.getElementById('autoFetchBtn');
    btn.style.background = autoFetchOn ? '' : '#2a0040';
    if (autoFetchOn) {
        if (backend) backend.startAutoFetch();
    } else {
        if (backend) backend.stopAutoFetch();
    }
}

// ======================== CONFLICTED FILES ========================

function loadConflicted() {
    if (!backend) return;
    backend.getConflicted().then(function(dataStr) {
        const files = JSON.parse(dataStr);
        const container = document.getElementById('conflictedItems');
        const badge = document.getElementById('conflictedBadge');
        const group = document.getElementById('conflictedGroup');

        container.innerHTML = '';
        badge.textContent = files.length;
        group.style.display = files.length === 0 ? 'none' : 'block';

        files.forEach(f => {
            const div = document.createElement('div');
            div.className = 'tree-item';
            div.innerHTML = `
                <div class="file-icon-img"><i class="codicon codicon-warning" style="color:#f14c4c"></i></div>
                <span class="file-name" style="color:#f14c4c">${escapeHtml(f.name)}</span>
                <span class="file-dir">${escapeHtml(f.path)}</span>
            `;
            div.onclick = () => { if (backend) backend.openFile(f.path); };
            container.appendChild(div);
        });
    });
}

// ======================== REMOTES ========================

function loadRemotes() {
    if (!backend) return;
    backend.getRemotes().then(updateRemotes);
}

function updateRemotes(dataStr) {
    const remotes = JSON.parse(dataStr);
    const container = document.getElementById('remotesList');
    container.innerHTML = '';
    if (remotes.length === 0) {
        container.innerHTML = '<div style="padding:8px 22px;color:#858585;font-style:italic">No remotes configured</div>';
        return;
    }
    remotes.forEach(r => {
        const div = document.createElement('div');
        div.className = 'remote-item';
        div.innerHTML = `
            <span class="remote-name">${escapeHtml(r.name)}</span>
            <span class="remote-url">${escapeHtml(r.url)}</span>
            <span style="color:#888;font-size:10px">${r.op || ''}</span>
            <button class="mini-btn danger" title="Remove" onclick="if(confirm('Remove remote ${escapeJs(r.name)}?'))doRemoveRemote('${escapeJs(r.name)}')"><i class="codicon codicon-close"></i></button>
        `;
        container.appendChild(div);
    });
}

function addRemote() {
    const name = document.getElementById('remoteName').value.trim();
    const url = document.getElementById('remoteUrl').value.trim();
    if (!name || !url || !backend) return;
    backend.addRemote(name, url);
    document.getElementById('remoteName').value = '';
    document.getElementById('remoteUrl').value = '';
    loadRemotes();
}

function doRemoveRemote(name) {
    if (!backend) return;
    backend.removeRemote(name);
    loadRemotes();
}

// ======================== TAGS ========================

function loadTags() {
    if (!backend) return;
    backend.getTags().then(updateTags);
}

function updateTags(dataStr) {
    const tags = JSON.parse(dataStr);
    const container = document.getElementById('tagsList');
    container.innerHTML = '';
    if (tags.length === 0) {
        container.innerHTML = '<div style="padding:8px 22px;color:#858585;font-style:italic">No tags</div>';
        return;
    }
    tags.forEach(t => {
        const div = document.createElement('div');
        div.className = 'tag-item';
        div.innerHTML = `
            <span class="tag-name">${escapeHtml(t.name)}</span>
            <span class="tag-hash">${escapeHtml(t.hash || '')}</span>
            <button class="mini-btn danger" title="Delete" onclick="if(confirm('Delete tag ${escapeJs(t.name)}?'))doDeleteTag('${escapeJs(t.name)}')"><i class="codicon codicon-close"></i></button>
        `;
        container.appendChild(div);
    });
}

function createTag() {
    const name = document.getElementById('tagName').value.trim();
    const ref = document.getElementById('tagRef').value.trim();
    if (!name || !backend) return;
    backend.createTag(name, ref || 'HEAD');
    document.getElementById('tagName').value = '';
    document.getElementById('tagRef').value = '';
    loadTags();
}

function doDeleteTag(name) {
    if (!backend) return;
    backend.deleteTag(name);
    loadTags();
}

// ======================== GRAPH ========================

function requestGraphRefresh() {
    if (backend) backend.refreshGraph();
}

let lastGraphStr = "";

function updateGraph(graphStr) {
    if (graphStr === lastGraphStr) return;
    lastGraphStr = graphStr;

    const lines = JSON.parse(graphStr);
    const container = document.getElementById('gitGraphContainer');
    container.innerHTML = '';

    if (lines.length === 0) {
        const div = document.createElement('div');
        div.className = 'graph-row';
        div.innerHTML = '<span class="graph-subject" style="color: var(--text-muted)">No Git repository found</span>';
        container.appendChild(div);
        return;
    }

    const colors = ['#569cd6', '#c586c0', '#4ec9b0', '#ce9178', '#dcdcaa'];

    lines.forEach((line, index) => {
        const div = document.createElement('div');
        div.className = 'graph-row';
        if (line.hash) {
            div.onclick = () => {
                if (backend) backend.openCommit(line.hash);
            };
            div.oncontextmenu = (e) => {
                e.preventDefault();
                showGraphContextMenu(e, line);
            };
        }

        let refsHtml = '';
        if (line.refs) {
            const refNames = line.refs.split(',');
            refNames.forEach(r => {
                const rt = r.trim();
                if (rt.includes('origin/')) {
                    refsHtml += `<span class="ref-tag remote"><i class="codicon codicon-cloud" style="font-size:10px"></i>${escapeHtml(rt.replace('origin/',''))}</span>`;
                } else if (rt !== 'HEAD') {
                    refsHtml += `<span class="ref-tag branch"><i class="codicon codicon-target" style="font-size:10px"></i>${escapeHtml(rt)}</span>`;
                }
            });
        }

        let graphHtml = '';
        if (line.graph) {
            const graphChars = line.graph.split('');
            graphChars.forEach((char, cIdx) => {
                const color = colors[cIdx % colors.length];
                let svgContent = '';
                if (char === '*') {
                    const dotClass = (index === 0) ? 'head' : 'normal';
                    const fillColor = (index === 0) ? 'var(--bg-color)' : color;
                    const y1 = (index === 0) ? '12' : '0';
                    svgContent = `
                        <line x1="7" y1="${y1}" x2="7" y2="24" stroke="${color}" stroke-width="2"/>
                        <circle cx="7" cy="12" r="4" fill="${fillColor}" stroke="${color}" stroke-width="2"/>
                    `;
                } else if (char === '|') {
                    svgContent = `<line x1="7" y1="0" x2="7" y2="24" stroke="${color}" stroke-width="2"/>`;
                } else if (char === '\\') {
                    svgContent = `<line x1="-7" y1="0" x2="21" y2="24" stroke="${color}" stroke-width="2"/>`;
                } else if (char === '/') {
                    svgContent = `<line x1="21" y1="0" x2="-7" y2="24" stroke="${color}" stroke-width="2"/>`;
                } else if (char === '_') {
                    svgContent = `<line x1="-7" y1="24" x2="21" y2="24" stroke="${color}" stroke-width="2"/>`;
                }
                if (svgContent) {
                    graphHtml += `<div class="graph-char-box"><svg width="14" height="24" style="overflow: visible;">${svgContent}</svg></div>`;
                } else {
                    graphHtml += `<div class="graph-char-box"></div>`;
                }
            });
        }

        if (line.hash) {
            div.innerHTML = `
                <div class="graph-structure">${graphHtml}</div>
                <div class="graph-subject">${escapeHtml(line.subject)} <span class="graph-refs">${refsHtml}</span></div>
                <div class="graph-author">${escapeHtml(line.author || '')}</div>
            `;
        } else {
            div.innerHTML = `
                <div class="graph-structure">${graphHtml}</div>
                <div class="graph-subject"></div>
                <div class="graph-author"></div>
            `;
        }
        container.appendChild(div);
    });
}

// Graph context menu with revert/cherry-pick/rebase
function showGraphContextMenu(event, line) {
    event.stopPropagation();
    const menu = document.getElementById('fileContextMenu');
    const hash = line.hash;

    if (!hash) return;

    const actions = [
        { label: 'Copy Hash', action: () => navigator.clipboard.writeText(hash) },
        { label: 'Revert Commit', action: () => { if (confirm(`Revert ${hash}?`)) backend.revertCommit(hash); } },
        { label: 'Cherry-pick', action: () => { if (confirm(`Cherry-pick ${hash}?`)) backend.cherryPick(hash); } },
    ];

    const currentBranch = currentBranchName;
    if (currentBranch) {
        actions.push({
            label: 'Rebase current onto this',
            action: () => { if (confirm(`Rebase ${currentBranch} onto ${hash}?`)) backend.rebaseOnto(hash); }
        });
    }

    menu.innerHTML = actions.map((entry, i) =>
        `<div class="menu-item" data-action="${i}">${entry.label}</div>`
    ).join('');
    menu.style.display = 'block';
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.querySelectorAll('.menu-item').forEach((node, i) => {
        node.onclick = (e) => { e.stopPropagation(); actions[i].action(); hideFileContextMenu(); };
    });
}

// ======================== GUTTER CHANGE INDICATORS ========================

function getGutterChanges(path) {
    if (!backend) return;
    backend.getGutterChanges(path).then(function(dataStr) {
        const changes = JSON.parse(dataStr);
        if (changes && changes.length > 0) {
            const msg = `Gutter changes in ${path}: ${changes.length} hunks`;
            showSyncStatus(msg, false);
        }
    });
}
