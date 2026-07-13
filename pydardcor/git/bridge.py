import os
import json
import subprocess
from PySide6.QtCore import QObject, Slot, Signal, QTimer

class GitBridge(QObject):
    filesUpdated = Signal(str, str)
    graphUpdated = Signal(str)
    counts_changed = Signal(int)
    blameReady = Signal(str, str)
    gutterChanged = Signal(str, str)
    stashUpdated = Signal(str)
    branchUpdated = Signal(str)
    remotesUpdated = Signal(str)
    tagsUpdated = Signal(str)
    syncStatus = Signal(str)
    autoFetchStatus = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._workspace = ""
        self._app = None

        try:
            from ..core.scm import SCMProvider, get_scm_service
            self.provider = SCMProvider("git", "Git")
            get_scm_service().register_provider(self.provider)
        except ImportError:
            self.provider = None
        self._last_status = None
        self._last_staged_json = "[]"
        self._last_unstaged_json = "[]"
        self._last_count = 0
        self._last_graph = None
        self._last_graph_json = "[]"
        self._working_sets = {"Default": []}
        self._active_working_set = "Default"
        self._refresh_pending = False

        self._poll_timer = QTimer(self)
        self._poll_timer.setInterval(3000)
        self._poll_timer.timeout.connect(self.requestRefresh)
        self._refresh_timer = QTimer(self)
        self._refresh_timer.setSingleShot(True)
        self._refresh_timer.setInterval(250)
        self._refresh_timer.timeout.connect(self._auto_refresh)
        self._auto_fetch_timer = QTimer(self)
        self._auto_fetch_timer.setInterval(60000)
        self._auto_fetch_timer.timeout.connect(self._auto_fetch)

    @Slot()
    def _auto_fetch(self):
        if not self._workspace:
            return
        ok, stdout, stderr = self._run_git_cmd(["fetch", "--all"], timeout=60)
        if ok:
            self.autoFetchStatus.emit(stdout.strip() or "Fetched")
        else:
            self.autoFetchStatus.emit(stderr.strip() or "Fetch failed")

    @Slot()
    def _auto_refresh(self):
        self._refresh_pending = False
        if self._workspace:
            self.refreshData()
            self.refreshGraph()

    @Slot()
    def requestRefresh(self):
        if not self._workspace:
            return
        self._refresh_pending = True
        self._refresh_timer.start()

    def set_app(self, app):
        self._app = app

    def set_workspace(self, path):
        self._workspace = path or ""
        if self._workspace:
            self._poll_timer.start()
            self._auto_fetch_timer.start()
            self.requestRefresh()
        else:
            self._poll_timer.stop()
            self._refresh_timer.stop()
            self._auto_fetch_timer.stop()
            self._refresh_pending = False

    def _git_subprocess_kwargs(self):
        kwargs = {}
        if os.name == 'nt':
            kwargs['creationflags'] = 0x08000000
        return kwargs

    def _run_git(self, args):
        ok, stdout, _stderr = self._run_git_cmd(args)
        return stdout if ok else _stderr

    def _run_git_cmd(self, args, timeout=5):
        if not self._workspace or not os.path.exists(os.path.join(self._workspace, ".git")):
            return False, "", "Not a git repository"
        try:
            sub_kwargs = self._git_subprocess_kwargs()
            result = subprocess.run(
                ["git"] + args,
                cwd=self._workspace,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                **sub_kwargs,
            )
            stdout = result.stdout or ""
            stderr = result.stderr or ""
            if result.returncode == 0:
                return True, stdout, stderr
            return False, stdout, stderr or stdout or f"git {' '.join(args)} failed"
        except Exception as e:
            return False, "", str(e)

    def _full_path(self, path):
        return os.path.abspath(os.path.join(self._workspace, path))

    def _read_worktree(self, path):
        full = self._full_path(path)
        try:
            with open(full, encoding="utf-8", errors="replace") as handle:
                return handle.read()
        except OSError:
            return ""

    def _read_git_blob(self, spec):
        if not self._workspace or not os.path.exists(os.path.join(self._workspace, ".git")):
            return ""
        try:
            sub_kwargs = {}
            if os.name == "nt":
                sub_kwargs["creationflags"] = 0x08000000
            result = subprocess.run(
                ["git", "show", spec],
                cwd=self._workspace,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
                **sub_kwargs,
            )
            if result.returncode != 0:
                return ""
            return result.stdout
        except Exception:
            return ""

    @Slot()
    def refreshData(self):
        stdout = self._run_git(["status", "-uall", "--porcelain"])
        if stdout == self._last_status:
            self.filesUpdated.emit(self._last_staged_json, self._last_unstaged_json)
            self.counts_changed.emit(self._last_count)
            return

        self._last_status = stdout
        staged = []
        unstaged = []

        if stdout:
            for line in stdout.splitlines():
                if len(line) < 4:
                    continue
                x = line[0]
                y = line[1]
                path = line[3:].strip()

                item = {
                    "name": os.path.basename(path),
                    "dir": os.path.dirname(path).replace("/", "\\") if os.name == 'nt' else os.path.dirname(path),
                    "path": path,
                    "status": "M"
                }

                if x != ' ' and x != '?':
                    s_item = dict(item)
                    s_item["status"] = x
                    staged.append(s_item)

                if y != ' ':
                    u_item = dict(item)
                    u_item["status"] = 'U' if y == '?' else y
                    unstaged.append(u_item)

        self._last_staged_json = json.dumps(staged)
        self._last_unstaged_json = json.dumps(unstaged)
        self._last_count = len(staged) + len(unstaged)

        self.filesUpdated.emit(self._last_staged_json, self._last_unstaged_json)
        self.counts_changed.emit(self._last_count)

    @Slot()
    def refreshGraph(self):
        stdout = self._run_git([
            "log", "--graph", "--oneline", "--decorate", "--all", "-n", "100",
            "--pretty=format:%h%x1f%s%x1f%cd%x1f%an%x1f%d", "--date=short"
        ])
        if stdout == self._last_graph:
            self.graphUpdated.emit(self._last_graph_json)
            return

        self._last_graph = stdout
        lines_data = []
        if stdout:
            for line in stdout.splitlines():
                parts = line.split('\x1f')
                if len(parts) >= 5:
                    graph_and_hash = parts[0]
                    words = graph_and_hash.split()
                    commit_hash = words[-1] if words else ""
                    if len(commit_hash) >= 4 and commit_hash.isalnum():
                        graph_part = graph_and_hash[:graph_and_hash.rfind(commit_hash)].rstrip()
                        if commit_hash and not graph_part.endswith("*"):
                            graph_part += " *"
                    else:
                        commit_hash = ""
                        graph_part = graph_and_hash

                    subject = parts[1]
                    date = parts[2]
                    author = parts[3]
                    refs = parts[4].strip("() ")

                    lines_data.append({
                        "graph": graph_part,
                        "subject": subject,
                        "date": date,
                        "author": author,
                        "hash": commit_hash,
                        "refs": refs
                    })
                else:
                    lines_data.append({
                        "graph": line,
                        "subject": "",
                        "date": "",
                        "author": "",
                        "hash": "",
                        "refs": ""
                    })

        self._last_graph_json = json.dumps(lines_data)
        self.graphUpdated.emit(self._last_graph_json)

    @Slot(str)
    def commit(self, message):
        if not message.strip():
            return
        self._run_git(["commit", "-m", message])
        self.requestRefresh()

    @Slot(str)
    def stageFile(self, path):
        self._run_git(["add", "--", path])
        self.requestRefresh()

    @Slot(str)
    def unstageFile(self, path):
        self._run_git(["restore", "--staged", "--", path])
        self.requestRefresh()

    @Slot(str)
    def pushBranch(self, remote):
        self._run_git(["push", remote, "HEAD"])
        self.requestRefresh()

    @Slot()
    def stashChanges(self):
        self._run_git(["stash", "save", "Dardcor Stash"])
        self.requestRefresh()

    @Slot()
    def popStash(self):
        self._run_git(["stash", "pop"])
        self.requestRefresh()

    @Slot(str)
    def mergeBranch(self, branch_name):
        self._run_git(["merge", branch_name])
        self.requestRefresh()

    @Slot(str, str)
    def addRemote(self, name, url):
        self._run_git(["remote", "add", name, url])
        self.remotesUpdated.emit(self.getRemotes())

    @Slot(str)
    def removeRemote(self, name):
        self._run_git(["remote", "remove", name])
        self.remotesUpdated.emit(self.getRemotes())

    @Slot(str, str)
    def renameRemote(self, old_name, new_name):
        self._run_git(["remote", "rename", old_name, new_name])
        self.remotesUpdated.emit(self.getRemotes())

    @Slot(str)
    def createWorkingSet(self, name):
        if name not in self._working_sets:
            self._working_sets[name] = []

    @Slot(str)
    def switchWorkingSet(self, name):
        if name in self._working_sets:
            self._active_working_set = name

    @Slot(str)
    def addToWorkingSet(self, path):
        if path not in self._working_sets[self._active_working_set]:
            self._working_sets[self._active_working_set].append(path)

    @Slot(str)
    def discardFile(self, path):
        self._run_git(["restore", "--", path])
        self.requestRefresh()

    @Slot()
    def stageAll(self):
        self._run_git(["add", "-A"])
        self.refreshData()

    @Slot()
    def unstageAll(self):
        self._run_git(["restore", "--staged", "."])
        self.refreshData()

    @Slot(str)
    def openDiff(self, path):
        if not self._app:
            return
        head = self._read_git_blob(f"HEAD:{path}")
        modified = self._read_worktree(path)
        self._app._open_diff_in_editor(self._full_path(path), head, modified)

    @Slot(str)
    def openStagedDiff(self, path):
        if not self._app:
            return
        head = self._read_git_blob(f"HEAD:{path}")
        staged = self._read_git_blob(f":{path}")
        self._app._open_diff_in_editor(self._full_path(path), head, staged)

    @Slot(str)
    def openFile(self, path):
        if self._app:
            self._app._open_file_in_editor(self._full_path(path))

    @Slot(str)
    def openCommit(self, commit_hash):
        if self._app:
            self._app._chat_panel.append_system_message(f"Selected commit: {commit_hash}")

    @Slot(result=str)
    def fetch(self):
        ok, stdout, stderr = self._run_git_cmd(["fetch"], timeout=60)
        self.requestRefresh()
        return stdout.strip() if ok else stderr.strip()

    @Slot(result=str)
    def pull(self):
        ok, stdout, stderr = self._run_git_cmd(["pull", "--rebase"], timeout=120)
        self.requestRefresh()
        if self._app and hasattr(self._app, "_detect_git_branch"):
            self._app._detect_git_branch()
        return stdout.strip() if ok else stderr.strip()

    @Slot(result=str)
    def push(self):
        ok, stdout, stderr = self._run_git_cmd(["push"], timeout=120)
        self.requestRefresh()
        return stdout.strip() if ok else stderr.strip()

    @Slot(result=str)
    def sync(self):
        messages = []
        ok, stdout, stderr = self._run_git_cmd(["fetch"], timeout=60)
        if stdout.strip():
            messages.append(stdout.strip())
        if not ok and stderr.strip():
            messages.append(stderr.strip())
            return "\n".join(messages)

        ok, stdout, stderr = self._run_git_cmd(["pull", "--rebase"], timeout=120)
        if stdout.strip():
            messages.append(stdout.strip())
        if not ok:
            if stderr.strip():
                messages.append(stderr.strip())
            self.requestRefresh()
            return "\n".join(messages)

        ok, stdout, stderr = self._run_git_cmd(["push"], timeout=120)
        if stdout.strip():
            messages.append(stdout.strip())
        if not ok and stderr.strip():
            messages.append(stderr.strip())

        self.requestRefresh()
        if self._app and hasattr(self._app, "_detect_git_branch"):
            self._app._detect_git_branch()
        return "\n".join(messages) if messages else "Already up to date."

    # ============== BRANCH MANAGEMENT ==============

    @Slot(result=str)
    def getBranches(self):
        local = self._run_git(["branch", "--format=%(refname:short)%x1f%(upstream:short)%x1f%(objectname:short)"])
        remote = self._run_git(["branch", "-r", "--format=%(refname:short)%x1f%(upstream:short)%x1f%(objectname:short)"])
        current = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"]).strip()
        branches = []
        remote_branches = []
        if local:
            for line in local.splitlines():
                parts = line.split('\x1f')
                name = parts[0]
                upstream = parts[1] if len(parts) > 1 else ""
                h = parts[2] if len(parts) > 2 else ""
                branches.append({"name": name, "upstream": upstream, "hash": h, "current": name == current, "remote": False})
        if remote:
            for line in remote.splitlines():
                parts = line.split('\x1f')
                name = parts[0]
                remote_branches.append({"name": name, "upstream": "", "hash": parts[2] if len(parts) > 2 else "", "current": False, "remote": True})
        return json.dumps({"local": branches, "remote": remote_branches, "current": current})

    @Slot(str)
    def checkoutBranch(self, name):
        self._run_git(["checkout", name])
        self.requestRefresh()
        self.branchUpdated.emit(self.getBranches())

    @Slot(str, str)
    def createBranch(self, name, from_branch):
        self._run_git(["branch", name, from_branch])
        self.requestRefresh()
        self.branchUpdated.emit(self.getBranches())

    @Slot(str, bool)
    def deleteBranch(self, name, force=False):
        self._run_git(["branch", "-d" if not force else "-D", name])
        self.requestRefresh()
        self.branchUpdated.emit(self.getBranches())

    @Slot(str, str)
    def renameBranch(self, old_name, new_name):
        self._run_git(["branch", "-m", old_name, new_name])
        self.requestRefresh()
        self.branchUpdated.emit(self.getBranches())

    # ============== STASH MANAGEMENT ==============

    @Slot(result=str)
    def getStashList(self):
        stdout = self._run_git(["stash", "list", "--format=%gd%x1f%gs%x1f%H"])
        stashes = []
        if stdout:
            for line in stdout.splitlines():
                parts = line.split('\x1f')
                stashes.append({
                    "index": len(stashes),
                    "name": parts[0] if len(parts) > 0 else "",
                    "subject": parts[1] if len(parts) > 1 else "",
                    "hash": parts[2] if len(parts) > 2 else "",
                })
        return json.dumps(stashes)

    @Slot(str)
    def stashPush(self, msg):
        self._run_git(["stash", "push", "-m", msg])
        self.requestRefresh()
        self.stashUpdated.emit(self.getStashList())

    @Slot(int)
    def stashApply(self, index):
        self._run_git(["stash", "apply", f"stash@{{{index}}}"])
        self.requestRefresh()
        self.stashUpdated.emit(self.getStashList())

    @Slot(int)
    def stashDrop(self, index):
        self._run_git(["stash", "drop", f"stash@{{{index}}}"])
        self.requestRefresh()
        self.stashUpdated.emit(self.getStashList())

    # ============== BLAME ANNOTATIONS ==============

    @Slot(str, result=str)
    def blameFile(self, path):
        ok, stdout, stderr = self._run_git_cmd(["blame", "--line-porcelain", path], timeout=30)
        if not ok:
            return json.dumps({"error": stderr})
        commits = {}
        lines_data = []
        current_commit = None
        current_line = None
        for line in stdout.splitlines():
            if line.startswith('\t'):
                if current_commit and current_line is not None:
                    lines_data.append({
                        "line": current_line,
                        "commit": current_commit["hash"],
                        "author": current_commit.get("author", "Unknown"),
                        "authorMail": current_commit.get("author-mail", ""),
                        "time": current_commit.get("author-time", ""),
                        "summary": current_commit.get("summary", ""),
                        "content": line[1:],
                    })
                continue
            sp = line.find(' ')
            if sp <= 0:
                continue
            first = line[:sp]
            rest = line[sp + 1:]
            if len(first) == 40:
                commit_hash = first
                nums = rest.split()
                current_line = int(nums[0]) if nums else None
                current_commit = commits.get(commit_hash)
                if current_commit is None:
                    current_commit = {"hash": commit_hash}
                    commits[commit_hash] = current_commit
            elif current_commit is not None:
                if first == "author":
                    current_commit["author"] = rest
                elif first == "author-mail":
                    current_commit["author-mail"] = rest
                elif first == "author-time":
                    current_commit["author-time"] = rest
                elif first == "summary":
                    current_commit["summary"] = rest
        return json.dumps(lines_data)

    @Slot(str)
    def openBlame(self, path):
        blame_data = self.blameFile(path)
        self.blameReady.emit(path, blame_data)

    # ============== REMOTE MANAGEMENT ==============

    @Slot(result=str)
    def getRemotes(self):
        stdout = self._run_git(["remote", "-v"])
        remotes = []
        seen = set()
        if stdout:
            for line in stdout.splitlines():
                parts = line.split()
                if len(parts) >= 2:
                    name = parts[0]
                    url = parts[1]
                    if name not in seen:
                        seen.add(name)
                        op = "fetch" if "(fetch)" in line else "push" if "(push)" in line else ""
                        remotes.append({"name": name, "url": url, "op": op})
        return json.dumps(remotes)

    # ============== TAG MANAGEMENT ==============

    @Slot(result=str)
    def getTags(self):
        stdout = self._run_git(["tag", "--list", "--format=%(refname:short)%x1f%(objectname:short)"])
        tags = []
        if stdout:
            for line in stdout.splitlines():
                parts = line.split('\x1f')
                tags.append({"name": parts[0], "hash": parts[1] if len(parts) > 1 else ""})
        return json.dumps(tags)

    @Slot(str, str)
    def createTag(self, name, hash_ref):
        self._run_git(["tag", name, hash_ref])
        self.requestRefresh()
        self.tagsUpdated.emit(self.getTags())

    @Slot(str)
    def deleteTag(self, name):
        self._run_git(["tag", "-d", name])
        self.requestRefresh()
        self.tagsUpdated.emit(self.getTags())

    # ============== AMEND & SIGN-OFF & CONVENTIONAL COMMITS ==============

    @Slot(str)
    def amendCommit(self, msg):
        self._run_git(["commit", "--amend", "-m", msg])
        self.requestRefresh()

    @Slot(str)
    def commitSigned(self, msg):
        self._run_git(["commit", "-s", "-m", msg])
        self.requestRefresh()

    @Slot(str, str, str, bool, bool)
    def commitConventional(self, type_, scope, msg, breaking, signoff):
        header = type_
        if scope:
            header += f"({scope})"
        if breaking:
            header += "!"
        header += f": {msg}"
        args = ["commit", "-m", header]
        if signoff:
            args.insert(1, "-s")
        self._run_git(args)
        self.requestRefresh()

    # ============== REVERT / CHERRY-PICK / REBASE ==============

    @Slot(str)
    def revertCommit(self, hash_):
        ok, stdout, stderr = self._run_git_cmd(["revert", "--no-edit", hash_], timeout=30)
        self.requestRefresh()
        if not ok:
            self.syncStatus.emit(stderr.strip() or f"Revert of {hash_} failed")
        else:
            self.syncStatus.emit(f"Reverted {hash_}")

    @Slot(str)
    def cherryPick(self, hash_):
        ok, stdout, stderr = self._run_git_cmd(["cherry-pick", hash_], timeout=30)
        self.requestRefresh()
        if not ok:
            self.syncStatus.emit(stderr.strip() or f"Cherry-pick of {hash_} failed")
        else:
            self.syncStatus.emit(f"Cherry-picked {hash_}")

    @Slot(str)
    def rebaseOnto(self, target):
        ok, stdout, stderr = self._run_git_cmd(["rebase", target], timeout=60)
        self.requestRefresh()
        if not ok:
            self.syncStatus.emit(stderr.strip() or f"Rebase onto {target} failed")
        else:
            self.syncStatus.emit(f"Rebased onto {target}")

    # ============== CONFLICT DETECTION ==============

    @Slot(result=str)
    def getConflicted(self):
        stdout = self._run_git(["diff", "--name-only", "--diff-filter=U"])
        if not stdout:
            return "[]"
        files = [{"path": p.strip(), "name": os.path.basename(p.strip())} for p in stdout.splitlines() if p.strip()]
        return json.dumps(files)

    # ============== GUTTER CHANGE INDICATORS ==============

    @Slot(str, result=str)
    def getGutterChanges(self, path):
        ok, stdout, stderr = self._run_git_cmd(["diff", "-U0", "--", path], timeout=10)
        if not ok or not stdout:
            return "[]"
        changes = []
        for line in stdout.splitlines():
            if line.startswith('@@'):
                parts = line.split()
                if len(parts) >= 3:
                    new_info = parts[2].lstrip('+')
                    new_parts = new_info.split(',')
                    start = int(new_parts[0])
                    count = int(new_parts[1]) if len(new_parts) > 1 else 1
                    changes.append({"start": start, "count": count})
        return json.dumps(changes)

    # ============== MULTI-FILE STAGING ==============

    @Slot(str)
    def stageFiles(self, paths_json):
        paths = json.loads(paths_json)
        for p in paths:
            self._run_git(["add", "--", p])
        self.requestRefresh()

    @Slot(str)
    def unstageFiles(self, paths_json):
        paths = json.loads(paths_json)
        for p in paths:
            self._run_git(["restore", "--staged", "--", p])
        self.requestRefresh()

    # ============== AUTO-FETCH CONTROL ==============

    @Slot()
    def startAutoFetch(self):
        if self._workspace:
            self._auto_fetch_timer.start()

    @Slot()
    def stopAutoFetch(self):
        self._auto_fetch_timer.stop()

    # ============== CURRENT BRANCH ==============

    @Slot(result=str)
    def getCurrentBranch(self):
        return self._run_git(["rev-parse", "--abbrev-ref", "HEAD"]).strip()
