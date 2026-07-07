let backend = null;
let isResizing = false;
let startY = 0;
let startFlex = 1;
let contextItem = null;
let contextIsStaged = false;

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
        
        // Initial fetch
        backend.requestRefresh();
    });

    const commitMsg = document.getElementById('commitMsg');
    document.getElementById('commitBtn').onclick = () => commitChanges();
    commitMsg.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commitChanges();
        }
    });

    // Resizer Logic
    const resizer = document.getElementById('resizer');
    const topPane = document.getElementById('changesContainer');
    const bottomPane = document.getElementById('graphContainer');

    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        startY = e.clientY;
        const topHeight = topPane.getBoundingClientRect().height;
        const bottomHeight = bottomPane.getBoundingClientRect().height;
        const totalHeight = topHeight + bottomHeight;
        startFlex = topHeight / totalHeight;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
    });

    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;
        const container = document.querySelector('.split-view');
        const containerHeight = container.getBoundingClientRect().height - resizer.getBoundingClientRect().height;
        const topHeight = e.clientY - container.getBoundingClientRect().top;
        
        let newFlex = topHeight / containerHeight;
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

    // Context Menu Logic
    const topMenuBtn = document.getElementById('topMenuBtn');
    const topContextMenu = document.getElementById('topContextMenu');
    
    topMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (topContextMenu.style.display === 'none') {
            topContextMenu.style.display = 'block';
            topMenuBtn.classList.add('active');
        } else {
            topContextMenu.style.display = 'none';
            topMenuBtn.classList.remove('active');
        }
    });

    document.addEventListener('click', () => {
        topContextMenu.style.display = 'none';
        topMenuBtn.classList.remove('active');
        hideFileContextMenu();
    });
};

function commitChanges() {
    const msg = document.getElementById('commitMsg').value;
    if (backend && msg.trim()) {
        backend.commit(msg);
        document.getElementById('commitMsg').value = '';
    }
}

function stageAllChanges() {
    if (backend) {
        backend.stageAll();
    }
}

function hideFileContextMenu() {
    const menu = document.getElementById('fileContextMenu');
    if (menu) {
        menu.style.display = 'none';
    }
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
            { label: 'Open Changes', action: () => backend.openStagedDiff(item.path) },
            { label: 'Unstage Changes', action: () => backend.unstageFile(item.path) },
        ]
        : [
            { label: 'Open File', action: () => backend.openFile(item.path) },
            { label: 'Open Changes', action: () => backend.openDiff(item.path) },
            { label: 'Stage Changes', action: () => backend.stageFile(item.path) },
            { label: 'Discard Changes', action: () => {
                if (confirm(`Discard changes in ${item.name}?`)) {
                    backend.discardFile(item.path);
                }
            }},
        ];
    menu.innerHTML = actions.map((entry, index) =>
        `<div class="menu-item" data-action="${index}">${entry.label}</div>`
    ).join('');
    menu.style.display = 'block';
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.querySelectorAll('.menu-item').forEach((node, index) => {
        node.onclick = (clickEvent) => {
            clickEvent.stopPropagation();
            actions[index].action();
            hideFileContextMenu();
        };
    });
}

// Toggle for context menu sections
function toggleSection(sectionId, menuItem) {
    const section = document.getElementById(sectionId);
    const checkIcon = menuItem.querySelector('.menu-check');
    if (section.style.display === 'none') {
        section.style.display = 'flex';
        checkIcon.innerHTML = '<i class="codicon codicon-check"></i>';
    } else {
        section.style.display = 'none';
        checkIcon.innerHTML = '';
    }
}

// Toggle for Split View Accordions (CHANGES / GRAPH)
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

// Toggle for Tree Groups (Staged / Changes)
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

let lastStagedStr = "";
let lastUnstagedStr = "";

function updateFiles(stagedStr, unstagedStr) {
    if (stagedStr === lastStagedStr && unstagedStr === lastUnstagedStr) {
        return;
    }
    lastStagedStr = stagedStr;
    lastUnstagedStr = unstagedStr;
    
    const staged = JSON.parse(stagedStr);
    const unstaged = JSON.parse(unstagedStr);

    renderList('stagedItems', 'stagedBadge', 'stagedGroup', staged, true);
    renderList('changesItems', 'changesBadge', 'changesGroup', unstaged, false);
}

// Mapping extensions to local Dardcor Code icons
function getIconUrl(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const baseUrl = '../../assets/icons/';
    
    const iconMap = {
        'py': 'python',
        'html': 'html',
        'css': 'css',
        'js': 'js',
        'json': 'json',
        'md': 'md',
        'ts': 'ts',
        'vue': 'vue',
        'jsx': 'react',
        'tsx': 'react',
        'php': 'php',
        'java': 'java',
        'c': 'cpp',
        'cpp': 'cpp',
        'cs': 'csharp',
        'go': 'go',
        'rs': 'rust',
        'rb': 'ruby',
        'sql': 'sql',
        'yaml': 'yaml',
        'yml': 'yaml',
        'xml': 'xml',
        'sh': 'shell',
        'bat': 'shell',
        'ps1': 'shell'
    };

    if (filename === '.gitignore' || filename === '.git') return `${baseUrl}git.svg`;
    if (filename.startsWith('.env')) return `${baseUrl}env.svg`;
    if (filename === 'package.json' || filename === 'package-lock.json') return `${baseUrl}npm.svg`;
    if (filename === 'tsconfig.json' || filename === 'tsconfig.node.json' || ext === 'tsbuildinfo') return `${baseUrl}tsconfig.svg`;
    
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'];
    if (imageExts.includes(ext)) return `${baseUrl}image.svg`;

    const iconName = iconMap[ext] || 'file';
    return `${baseUrl}${iconName}.svg`;
}

function renderList(containerId, badgeId, groupId, items, isStaged) {
    const container = document.getElementById(containerId);
    const badge = document.getElementById(badgeId);
    const group = document.getElementById(groupId);
    
    container.innerHTML = '';
    badge.innerText = items.length;
    
    if (items.length === 0) {
        group.style.display = 'none';
        return;
    }
    
    group.style.display = 'block';
    
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'tree-item';
        div.onclick = () => {
            if (!backend) return;
            if (isStaged) {
                backend.openStagedDiff(item.path);
            } else {
                backend.openDiff(item.path);
            }
        };
        div.oncontextmenu = (event) => showFileContextMenu(event, item, isStaged);
        
        const iconUrl = getIconUrl(item.name);
        const statusClass = (item.status === 'U' || item.status === 'A' || item.status === '??') ? 'status-u' : 
                            (item.status === 'D') ? 'status-d' : 'status-m';
                            
        let displayStatus = item.status;
        if (displayStatus === '??' || displayStatus === 'A') displayStatus = 'U';

        div.innerHTML = `
            <div class="file-icon-img">
                <img src="${iconUrl}" width="16" height="16" onerror="this.src='../../assets/icons/file.svg'">
            </div>
            <span class="file-name" style="color: ${(statusClass === 'status-u') ? 'var(--status-u)' : 'var(--text-main)'}">${item.name}</span>
            <span class="file-dir">${item.dir}</span>
            <span class="file-status ${statusClass}">${displayStatus}</span>
        `;
        container.appendChild(div);
    });
}

function requestGraphRefresh() {
    if (backend) {
        backend.refreshGraph();
    }
}

let lastGraphStr = "";

function updateGraph(graphStr) {
    if (graphStr === lastGraphStr) {
        return;
    }
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
    
    // Simple color palette for branches
    const colors = ['#569cd6', '#c586c0', '#4ec9b0', '#ce9178', '#dcdcaa'];
    
    lines.forEach((line, index) => {
        const div = document.createElement('div');
        div.className = 'graph-row';
        if (line.hash) {
            div.onclick = () => backend.openCommit(line.hash);
        }
        
        let refsHtml = '';
        if (line.refs) {
            const refNames = line.refs.split(',');
            refNames.forEach(r => {
                const rt = r.trim();
                if (rt.includes('origin/')) {
                    refsHtml += `<span class="ref-tag remote"><i class="codicon codicon-cloud" style="font-size:10px"></i>${rt.replace('origin/','')}</span>`;
                } else if (rt !== 'HEAD') {
                    refsHtml += `<span class="ref-tag branch"><i class="codicon codicon-target" style="font-size:10px"></i>${rt}</span>`;
                }
            });
        }
        
        // Parse line.graph (ASCII git log --graph output) to custom SVGs for perfect continuous lines
        let graphHtml = '';
        const graphChars = line.graph.split('');
        
        graphChars.forEach((char, cIdx) => {
            const color = colors[cIdx % colors.length];
            // SVG container with overflow visible so lines can connect across grid cells
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
        
        if (line.hash) {
            div.innerHTML = `
                <div class="graph-structure">${graphHtml}</div>
                <div class="graph-subject">${line.subject} <span class="graph-refs">${refsHtml}</span></div>
                <div class="graph-author">${line.author || ''}</div>
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
