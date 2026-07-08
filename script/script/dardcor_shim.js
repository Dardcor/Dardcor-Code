const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

let requestSeq = 0;
const pendingRequests = new Map();
const bridgeEvents = new EventEmitter();

function sendNotification(method, params) {
  try { process.stdout.write(JSON.stringify({jsonrpc:"2.0",method,params})+"\n"); } catch(_) {}
}
function sendRequest(method, params) {
  const id = ++requestSeq;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, {resolve,reject});
    try { process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n"); } catch(_) { reject(new Error("write failed")); }
  });
}

process.stdin.on("data", (data) => {
  for (const line of data.toString().split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pendingRequests.has(msg.id)) {
        const p = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else if (msg.method === "executeCommand") {
        commands._dispatch(msg.params.command, msg.params.args || []);
      } else if (msg.method === "fireEvent") {
        bridgeEvents.emit(msg.params.event, msg.params.data);
      }
    } catch(_) {}
  }
});

const commandHandlers = new Map();
const commands = {
  registerCommand(cmd, cb, ctx) {
    const h = typeof cb === "function" ? cb.bind(ctx) : cb;
    commandHandlers.set(cmd, h);
    sendNotification("commands.registerCommand", { command: cmd });
    return { dispose() { commandHandlers.delete(cmd); } };
  },
  registerTextEditorCommand(cmd, cb, ctx) {
    const h = typeof cb === "function" ? cb.bind(ctx) : cb;
    commandHandlers.set(cmd, (args) => h(window.activeTextEditor, ...args));
    sendNotification("commands.registerCommand", { command: cmd });
    return { dispose() { commandHandlers.delete(cmd); } };
  },
  async executeCommand(cmd, ...args) {
    if (commandHandlers.has(cmd)) return commandHandlers.get(cmd)(...args);
    return sendRequest("commands.executeCommand", { command: cmd, args });
  },
  async getCommands() { return sendRequest("commands.getCommands", {}); },
  _dispatch(cmd, args) {
    if (commandHandlers.has(cmd)) try { commandHandlers.get(cmd)(args); } catch(e) {}
  },
  executeRegisteredCommand(cmd, args) {
    this._dispatch(cmd, args);
  }
};

class OutputChannel {
  constructor(n, lang) { this.name = n; this.language = lang || ""; }
  append(v) { sendNotification("window.outputAppend", { name: this.name, value: v }); }
  appendLine(v) { this.append(v + "\n"); }
  clear() { sendNotification("window.outputClear", { name: this.name }); }
  show() { sendNotification("window.outputShow", { name: this.name }); }
  hide() { sendNotification("window.outputHide", { name: this.name }); }
  replace(v) { sendNotification("window.outputReplace", { name: this.name, value: v }); }
  dispose() { sendNotification("window.outputDispose", { name: this.name }); }
}

class StatusBarItem {
  constructor(a, p) {
    this.alignment = a || 0; this.priority = p || 100;
    this._text = ""; this._tooltip = ""; this._command = ""; this._color = "";
    this._id = "sb_" + (++requestSeq);
  }
  get text() { return this._text; }
  set text(v) { this._text = v; this._update(); }
  get tooltip() { return this._tooltip; }
  set tooltip(v) { this._tooltip = v; }
  get command() { return this._command; }
  set command(v) { this._command = v; }
  get color() { return this._color; }
  set color(v) { this._color = v; }
  show() { this._update(); }
  hide() { sendNotification("window.statusBarHide", { id: this._id }); }
  dispose() { this.hide(); }
  _update() {
    sendNotification("window.statusBarShow", {
      id: this._id, text: this._text, tooltip: this._tooltip,
      command: this._command, priority: this.priority, color: this._color
    });
  }
}

class Uri {
  constructor(scheme, authority, p, query, fragment) {
    this.scheme = scheme || "file"; this.authority = authority || "";
    this.path = p || ""; this.query = query || ""; this.fragment = fragment || "";
    this.fsPath = p || "";
  }
  static file(p) { return new Uri("file", "", p); }
  static parse(v) { return new Uri("file", "", v); }
  static join(base, ...paths) { return new Uri("file", "", path.join(base.path || base, ...paths)); }
  static from(c) { return new Uri(c.scheme, c.authority, c.path, c.query, c.fragment); }
  toString() { return this.scheme + "://" + this.authority + this.path; }
  with(c) { return new Uri(c.scheme||this.scheme, c.authority||this.authority, c.path||this.path, c.query||this.query, c.fragment||this.fragment); }
}

class Position {
  constructor(line, char) { this.line = line; this.character = char; }
  compareTo(o) { return this.line===o.line ? this.character-o.character : this.line-o.line; }
  isBefore(o) { return this.compareTo(o)<0; }
  isBeforeOrEqual(o) { return this.compareTo(o)<=0; }
  isAfter(o) { return this.compareTo(o)>0; }
  isAfterOrEqual(o) { return this.compareTo(o)>=0; }
  isEqual(o) { return this.line===o.line && this.character===o.character; }
  translate(ld, cd) { return new Position(this.line+(ld||0), this.character+(cd||0)); }
}

class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a,b); this.end = new Position(c,d); }
    else { this.start = a; this.end = b; }
  }
  isEmpty() { return this.start.isEqual(this.end); }
  isSingleLine() { return this.start.line === this.end.line; }
  contains(p) { return false; }
  intersect(r) { return null; }
}

class Selection extends Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { super(a,b,c,d); this.anchor = new Position(a,b); this.active = new Position(c,d); }
    else { super(a,b); this.anchor = a; this.active = b; }
  }
  isReversed() { return this.anchor.isAfter(this.active); }
}

class TextEdit {
  static insert(pos, text) { return { range: new Range(pos, pos), newText: text }; }
  static delete(r) { return { range: r, newText: "" }; }
  static replace(r, text) { return { range: r, newText: text }; }
}

class Diagnostic {
  constructor(r, msg, sev) { this.range = r; this.message = msg; this.severity = sev || 1; this.source = ""; this.code = ""; }
}

class SnippetString { constructor(v) { this.value = v || ""; } }

class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind || 1; this.detail = ""; this.documentation = ""; this.insertText = ""; this.sortText = ""; this.filterText = ""; this.preselect = false; this.commitCharacters = []; this.additionalTextEdits = []; this.command = null; this.range = null; }
}

class Hover { constructor(contents, range) { this.contents = contents; this.range = range; } }

class DocumentLink { constructor(range, target) { this.range = range; this.target = target; this.tooltip = ""; } }

class CodeAction { constructor(title, kind) { this.title = title; this.kind = kind; this.command = null; this.diagnostics = []; } }

class CodeActionKind { static SourceFixAll = "source.fixAll"; static QuickFix = "quickfix"; static Refactor = "refactor"; }

class DiagnosticSeverity { static Error = 0; static Warning = 1; static Information = 2; static Hint = 3; }
const DiagnosticSeverityVals = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

class CompletionItemKind {
  static Text=1;static Method=2;static Function=3;static Constructor=4;static Field=5;static Variable=6;
  static Class=7;static Interface=8;static Module=9;static Property=10;static Unit=11;static Value=12;
  static Enum=13;static Keyword=14;static Snippet=15;static Color=16;static File=17;static Reference=18;
  static Folder=19;static EnumMember=20;static Constant=21;static Struct=22;static Event=23;static Operator=24;static TypeParameter=25;
}

const _languageProviders = { completion: [], hover: [], definition: [], codeAction: [] };
const languages = {
  registerCompletionItemProvider(sel, prov, ...triggers) {
    const id = "cmp_" + (++requestSeq);
    _languageProviders.completion.push({id,sel,prov,triggers});
    sendNotification("languages.registerCompletion", { id, selector: sel, triggers });
    return { dispose() { _languageProviders.completion = _languageProviders.completion.filter(p=>p.id!==id); } };
  },
  registerHoverProvider(sel, prov) { const id="hov_"+(++requestSeq); sendNotification("languages.registerHover",{id,selector:sel}); return {dispose(){}}; },
  registerDefinitionProvider(sel, prov) { const id="def_"+(++requestSeq); sendNotification("languages.registerDefinition",{id,selector:sel}); return {dispose(){}}; },
  registerSignatureHelpProvider(sel, prov, ...triggers) { sendNotification("languages.registerSignatureHelp",{selector:sel,triggers}); return {dispose(){}}; },
  registerDocumentFormattingEditProvider(sel, prov) { sendNotification("languages.registerDocumentFormatting",{selector:sel}); return {dispose(){}}; },
  registerCodeActionsProvider(sel, prov, meta) { sendNotification("languages.registerCodeActions",{selector:sel}); return {dispose(){}}; },
  registerReferenceProvider(sel, prov) { return {dispose(){}}; },
  registerRenameProvider(sel, prov) { return {dispose(){}}; },
  registerCodeLensProvider(sel, prov) { return {dispose(){}}; },
  registerTypeDefinitionProvider(sel, prov) { return {dispose(){}}; },
  registerImplementationProvider(sel, prov) { return {dispose(){}}; },
  registerDocumentLinkProvider(sel, prov) { return {dispose(){}}; },
  registerColorProvider(sel, prov) { return {dispose(){}}; },
  registerDocumentSemanticTokensProvider(sel, legend) { return {dispose(){}}; },
  setLanguageConfiguration(langId, config) { sendNotification("languages.setLanguageConfiguration",{languageId:langId,configuration:config}); return {dispose(){}}; },
  createDiagnosticCollection(name) {
    const _d = {};
    return {
      set(uri, diags) { const k=typeof uri==="string"?uri:(uri&&uri.fsPath)||""; _d[k]=diags; sendNotification("languages.setDiagnostics",{uri:k,diagnostics:diags||[]}); },
      delete(uri) { const k=typeof uri==="string"?uri:(uri&&uri.fsPath)||""; delete _d[k]; sendNotification("languages.setDiagnostics",{uri:k,diagnostics:[]}); },
      clear() { Object.keys(_d).forEach(k=>delete _d[k]); },
      dispose() { this.clear(); }
    };
  },
  getDiagnostics(uri) { return []; },
  onDidChangeDiagnostics(l) { return {dispose(){}}; }
};

class Task {
  constructor(def, scope, name, source, exec, pm) {
    this.definition=def||{}; this.scope=scope; this.name=name||""; this.source=source||"";
    this.execution=exec||null; this.problemMatchers=pm||[]; this.isBackground=false;
    this.presentationOptions={reveal:2,focus:false,echo:true,clear:false}; this.group=null;
  }
}
class TaskGroup { constructor(id,label){this.id=id;this.label=label;} }
TaskGroup.Build=new TaskGroup("build","Build"); TaskGroup.Test=new TaskGroup("test","Test");
TaskGroup.Clean=new TaskGroup("clean","Clean"); TaskGroup.Rebuild=new TaskGroup("rebuild","Rebuild");
class ShellExecution { constructor(cmd,args,opts){this.commandLine=cmd||"";this.args=Array.isArray(args)?args:[];this.options=opts||{};} }
class ProcessExecution { constructor(proc,args,opts){this.process=proc||"";this.args=args||[];this.options=opts||{};} }

const tasks = {
  async fetchTasks(f) { return sendRequest("tasks.fetchTasks",{filter:f}); },
  async executeTask(t) { return sendRequest("tasks.executeTask",{name:t.name,commandLine:t.execution?(t.execution.commandLine||""):"",args:t.execution?(t.execution.args||[]):[]}); },
  registerTaskProvider(type, prov) { return {dispose(){}}; },
  onDidStartTask(l) { bridgeEvents.on("taskStarted",l); return {dispose(){}}; },
  onDidEndTask(l) { bridgeEvents.on("taskEnded",l); return {dispose(){}}; },
  Task, TaskGroup, ShellExecution, ProcessExecution
};

class DebugConfiguration { constructor(type,name,req){this.type=type||"";this.name=name||"";this.request=req||"launch";} }
const debug = {
  registerDebugConfigurationProvider(dt,prov,tk) { return {dispose(){}}; },
  registerDebugAdapterDescriptorFactory(dt,f) { return {dispose(){}}; },
  async startDebugging(folder,cfg) {
    const c = typeof cfg==="string" ? {name:cfg,type:"default",request:"launch"} : cfg;
    return sendRequest("debug.startDebugging",{config:c,folder:folder?folder.uri.fsPath:""});
  },
  async stopDebugging() { return sendRequest("debug.stopDebugging",{}); },
  get activeDebugSession() { return null; },
  get activeDebugConsole() { return {append(){},appendLine(){},clear(){},show(){}}; },
  get breakpoints() { return []; },
  onDidStartDebugSession(l) { bridgeEvents.on("debugSessionStarted",l); return {dispose(){}}; },
  onDidTerminateDebugSession(l) { bridgeEvents.on("debugSessionTerminated",l); return {dispose(){}}; },
  onDidChangeActiveDebugSession(l) { return {dispose(){}}; },
  onDidReceiveDebugSessionCustomEvent(l) { return {dispose(){}}; },
  onDidChangeBreakpoints(l) { bridgeEvents.on("breakpointsChanged",l); return {dispose(){}}; },
  async addBreakpoints(bp) { sendNotification("debug.addBreakpoints",{breakpoints:bp}); return bp; },
  async removeBreakpoints(bp) { sendNotification("debug.removeBreakpoints",{breakpoints:bp}); },
  DebugConfiguration,
  DebugAdapterExecutable: class { constructor(c,a){this.command=c;this.args=a||[];} },
  DebugConfigurationProviderTriggerKind: {Initial:1,Dynamic:2}
};

const _cfgCache = {};
let _activeEditor = null;
let _terminals = [];

// TreeDataProvider registry for extension-contributed views
const _treeProviders = new Map();
const _treeNodes = new Map();
let _treeNodeSeq = 0;

function _serializeTreeItem(item, element) {
  // A TreeItem may be the item itself, or getTreeItem returned an object
  let label = "";
  let description = "";
  let tooltip = "";
  let collapsibleState = 0;
  let contextValue = "";
  let command = null;
  let iconHint = "";

  if (item && typeof item === "object") {
    if (typeof item.label === "string") label = item.label;
    else if (item.label && typeof item.label.label === "string") label = item.label.label;
    if (!label && typeof item.id === "string") label = item.id;
    description = typeof item.description === "string" ? item.description : "";
    tooltip = typeof item.tooltip === "string" ? item.tooltip : (item.tooltip && item.tooltip.value) || "";
    collapsibleState = item.collapsibleState || 0;
    contextValue = item.contextValue || "";
    command = item.command || null;
    if (item.iconPath) {
      if (typeof item.iconPath === "string") iconHint = item.iconPath;
      else if (item.iconPath.id) iconHint = item.iconPath.id;      // ThemeIcon
      else if (item.iconPath.fsPath) iconHint = item.iconPath.fsPath;
      else if (item.iconPath.dark) iconHint = (item.iconPath.dark.fsPath || item.iconPath.dark);
    }
  } else if (typeof item === "string") {
    label = item;
  }

  const nodeId = "node_" + (++_treeNodeSeq);
  _treeNodes.set(nodeId, element);
  return {
    id: nodeId,
    label: String(label || ""),
    description: String(description || ""),
    tooltip: String(tooltip || ""),
    collapsibleState,
    contextValue: String(contextValue || ""),
    icon: String(iconHint || ""),
    command: command ? {
      command: command.command || "",
      title: command.title || "",
      arguments: command.arguments || []
    } : null
  };
}

async function getTreeChildren(viewId, elementId) {
  const provider = _treeProviders.get(viewId);
  if (!provider || typeof provider.getChildren !== "function") return [];
  let element;
  if (elementId) element = _treeNodes.get(elementId);
  let children = await Promise.resolve(provider.getChildren(element));
  if (!Array.isArray(children)) children = children ? [children] : [];
  const out = [];
  for (const child of children) {
    let item = child;
    if (typeof provider.getTreeItem === "function") {
      try { item = await Promise.resolve(provider.getTreeItem(child)); } catch (_) { item = child; }
    }
    out.push(_serializeTreeItem(item, child));
  }
  return out;
}

const workspace = {
  get workspaceFolders() { return global.dardcorWorkspaceFolders || []; },
  get name() { const f=this.workspaceFolders; return f.length>0?f[0].name:""; },
  get rootPath() { const f=this.workspaceFolders; return f.length>0?f[0].uri.fsPath:""; },
  get textDocuments() { return []; },
  getConfiguration(section) {
    return {
      get(key, def) { const k=section?section+"."+key:key; return _cfgCache[k]!==undefined?_cfgCache[k]:def; },
      has(key) { return false; },
      inspect(key) { return undefined; },
      update(sKey, val, target) { const k=section?section+"."+sKey:sKey; _cfgCache[k]=val; return sendRequest("workspace.updateConfiguration",{section:sKey,value:val}); }
    };
  },
  onDidChangeConfiguration(l) { bridgeEvents.on("configChanged",l); return {dispose(){}}; },
  onDidChangeTextDocument(l) { bridgeEvents.on("documentChanged",l); return {dispose(){}}; },
  onDidSaveTextDocument(l) { bridgeEvents.on("documentSaved",l); return {dispose(){}}; },
  onDidOpenTextDocument(l) { bridgeEvents.on("documentOpened",l); return {dispose(){}}; },
  onDidCloseTextDocument(l) { bridgeEvents.on("documentClosed",l); return {dispose(){}}; },
  onDidChangeWorkspaceFolders(l) { return {dispose(){}}; },
  getWorkspaceFolder(uri) { const p=typeof uri==="string"?uri:(uri&&uri.fsPath)||""; for(const f of this.workspaceFolders){if(p.startsWith(f.uri.fsPath))return f;} return null; },
  asRelativePath(p) { return typeof p==="string"?p:(p&&p.fsPath)||""; },
  findFiles(inc, exc, max) { return sendRequest("workspace.findFiles",{include:inc,exclude:exc,maxResults:max||10000}); },
  applyEdit() { return Promise.resolve(true); },
  openTextDocument(uri) { return sendRequest("workspace.openTextDocument",{uri:typeof uri==="string"?uri:(uri&&uri.fsPath||"")}); },
  fs: {
    readFile(uri) { return sendRequest("workspace.fsReadFile",{path:typeof uri==="string"?uri:uri.fsPath}); },
    writeFile(uri, content) { return sendRequest("workspace.fsWriteFile",{path:typeof uri==="string"?uri:uri.fsPath,content}); },
    stat(uri) { return sendRequest("workspace.fsStat",{path:typeof uri==="string"?uri:uri.fsPath}); },
    readDirectory(uri) { return sendRequest("workspace.fsReadDirectory",{path:typeof uri==="string"?uri:uri.fsPath}); },
    createDirectory(uri) { return sendRequest("workspace.fsCreateDirectory",{path:typeof uri==="string"?uri:uri.fsPath}); },
    delete(uri) { return sendRequest("workspace.fsDelete",{path:typeof uri==="string"?uri:uri.fsPath}); },
    rename(oldUri, newUri) { return sendRequest("workspace.fsRename",{old:typeof oldUri==="string"?oldUri:oldUri.fsPath,new:typeof newUri==="string"?newUri:newUri.fsPath}); },
    copy(src, dest) { return sendRequest("workspace.fsCopy",{source:typeof src==="string"?src:src.fsPath,destination:typeof dest==="string"?dest:dest.fsPath}); }
  },
  registerTextDocumentContentProvider(scheme, prov) { return {dispose(){}}; }
};

const window = {
  showInformationMessage(msg, ...items) { return sendRequest("window.showInformationMessage",{message:msg,items}); },
  showWarningMessage(msg, ...items) { return sendRequest("window.showWarningMessage",{message:msg,items}); },
  showErrorMessage(msg, ...items) { return sendRequest("window.showErrorMessage",{message:msg,items}); },
  showQuickPick(items, opts) { return sendRequest("window.showQuickPick",{items,options:opts}); },
  showInputBox(opts) { return sendRequest("window.showInputBox",{options:opts}); },
  showOpenDialog(opts) { return sendRequest("window.showOpenDialog",{options:opts}); },
  showSaveDialog(opts) { return sendRequest("window.showSaveDialog",{options:opts}); },
  createOutputChannel(nameOrObj, lang) {
    const n = typeof nameOrObj==="string"?nameOrObj:(nameOrObj&&nameOrObj.name)||"Output";
    sendNotification("window.createOutputChannel",{name:n}); return new OutputChannel(n,lang);
  },
  createStatusBarItem(alignment, priority) { return new StatusBarItem(alignment, priority); },
  createTerminal(optsOrName, shellPath, shellArgs) {
    let o = typeof optsOrName==="string"?{name:optsOrName,shellPath,shellArgs}:(optsOrName||{});
    const id = "term_" + (++requestSeq);
    sendNotification("window.createTerminal",{id,...o});
    return {
      name: o.name||"Terminal", id,
      sendText(text, addNL) { sendNotification("terminal.sendText",{id,text,addNewLine:addNL!==false}); },
      show(pf) { sendNotification("terminal.show",{id,preserveFocus:pf}); },
      hide() { sendNotification("terminal.hide",{id}); },
      dispose() { sendNotification("terminal.dispose",{id}); }
    };
  },
  get activeTextEditor() { return _activeEditor; },
  get visibleTextEditors() { return _activeEditor ? [_activeEditor] : []; },
  get terminals() { return _terminals; },
  onDidChangeActiveTextEditor(l) { bridgeEvents.on("activeEditorChanged",l); return {dispose(){bridgeEvents.removeListener("activeEditorChanged",l);}}; },
  onDidChangeVisibleTextEditors(l) { return {dispose(){}}; },
  onDidCloseTerminal(l) { bridgeEvents.on("terminalClosed",l); return {dispose(){}}; },
  onDidChangeWindowState(l) { return {dispose(){}}; },
  registerTreeDataProvider(vid, tdp) {
    _treeProviders.set(vid, tdp);
    if (tdp && typeof tdp.onDidChangeTreeData === "function") {
      try {
        tdp.onDidChangeTreeData(() => sendNotification("window.treeDataChanged", { viewId: vid }));
      } catch (_) {}
    }
    sendNotification("window.registerTreeDataProvider", { viewId: vid });
    return { dispose() { _treeProviders.delete(vid); } };
  },
  createTreeView(vid, opts) {
    const tdp = opts && opts.treeDataProvider;
    if (tdp) window.registerTreeDataProvider(vid, tdp);
    return {
      visible: true, selection: [], message: "", title: vid,
      onDidChangeSelection() { return { dispose() {} }; },
      onDidChangeVisibility() { return { dispose() {} }; },
      onDidCollapseElement() { return { dispose() {} }; },
      onDidExpandElement() { return { dispose() {} }; },
      reveal() { return Promise.resolve(); },
      dispose() { _treeProviders.delete(vid); }
    };
  },
  registerUriHandler(h) { return {dispose(){}}; },
  withProgress(opts, task) { return sendRequest("window.withProgress",{options:{location:opts.location,title:opts.title}}); },
  createWebviewPanel(vt, title, so, opts) {
    return { webview:{html:"",postMessage(){},onDidReceiveMessage(){return {dispose(){}}}}, dispose(){}, reveal(){} };
  },
  ProgressLocation: {Notification:15,SourceControl:1,Window:10},
  StatusBarAlignment: {Left:1,Right:2},
  TextEditorRevealType: {Default:0,InCenter:1,InCenterIfOutsideViewport:2,AtTop:3}
};

bridgeEvents.on("activeEditorChanged", (info) => {
  _activeEditor = info ? {
    document: {
      uri: Uri.file(info.path), fileName: info.path||"", languageId: info.language||"",
      lineCount: info.lineCount||0,
      getText() { return sendRequest("workspace.getEditorText",{}); },
      positionAt(off) { return {line:0,character:off}; },
      offsetAt(pos) { return 0; },
      save() { return sendRequest("workspace.saveFile",{path:info.path}); },
      isDirty:true, isUntitled:!info.path, isClosed:false
    },
    selection: {active:{line:0,character:0},anchor:{line:0,character:0}},
    edit(cb) { return sendRequest("workspace.editorEdit",{}); },
    revealLine(line, rt) { sendNotification("editor.revealLine",{line,revealType:rt||1}); },
    setDecorations() {}
  } : null;
  _terminals = [];
});

bridgeEvents.on("terminalCreated", (info) => {
  _terminals.push({name:info.name,id:info.id,sendText(t){sendNotification("terminal.sendText",{id:info.id,text:t});}});
});
bridgeEvents.on("terminalClosed", (info) => { _terminals = _terminals.filter(t=>t.id!==info.id); });

module.exports = {
  commands, window, workspace, languages, tasks, debug, bridgeEvents, sendNotification, sendRequest,
  getTreeChildren,
  Uri, Position, Range, Selection, TextEdit, Diagnostic, DiagnosticSeverity: DiagnosticSeverityVals,
  SnippetString, CompletionItem, CompletionItemKind, Hover, DocumentLink, CodeAction, CodeActionKind,
  EventEmitter,
  events: bridgeEvents
};
