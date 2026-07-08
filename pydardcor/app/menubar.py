"""
Menu Bar — TASK-0029 + menus TASK-0032-0040
=============================================
Full VS Code style menu bar dengan semua menus.
Mendukung native menu (QMenuBar) dengan semua items persis VS Code.
"""

from __future__ import annotations

from typing import Optional, TYPE_CHECKING

try:
    from PySide6.QtWidgets import QMenuBar, QMenu, QApplication
    from PySide6.QtGui import QAction, QKeySequence, QIcon
    from PySide6.QtCore import Qt
    HAS_QT = True
except ImportError:
    HAS_QT = False

if HAS_QT:
    class DardcorMenuBar(QMenuBar):
        """
        Full VS Code-parity menu bar.
        All menus and actions match VS Code exactly.
        """

        def __init__(self, main_window=None, parent=None):
            super().__init__(parent)
            self._main_window = main_window
            self._setup_menus()

        def _setup_menus(self) -> None:
            self._build_file_menu()
            self._build_edit_menu()
            self._build_selection_menu()
            self._build_view_menu()
            self._build_go_menu()
            self._build_run_menu()
            self._build_terminal_menu()
            self._build_help_menu()

        def _mw(self):
            return self._main_window

        def _act(self, label: str, shortcut: str = "", slot=None, checkable: bool = False) -> QAction:
            action = QAction(label, self)
            if shortcut:
                action.setShortcut(QKeySequence(shortcut))
            if slot:
                action.triggered.connect(slot)
            if checkable:
                action.setCheckable(True)
            return action

        # ------------------------------------------------------------------
        # File Menu — TASK-0032
        # ------------------------------------------------------------------
        def _build_file_menu(self) -> None:
            menu = self.addMenu("&File")

            menu.addAction(self._act("New Text File", "Ctrl+N", self._cmd("workbench.action.files.newUntitledFile")))
            menu.addAction(self._act("New File...", "Ctrl+Alt+Win+N", self._cmd("workbench.action.newWindow")))
            menu.addAction(self._act("New Window", "Ctrl+Shift+N", self._cmd("workbench.action.newWindow")))
            menu.addSeparator()
            menu.addAction(self._act("Open File...", "Ctrl+O", self._cmd("workbench.action.files.openFile")))
            menu.addAction(self._act("Open Folder...", "Ctrl+K Ctrl+O", self._cmd("workbench.action.files.openFolder")))
            menu.addAction(self._act("Open Workspace from File...", "", self._cmd("workbench.action.openWorkspace")))
            menu.addAction(self._act("Open Recent", "Ctrl+R", self._cmd("workbench.action.openRecent")))
            menu.addSeparator()
            menu.addAction(self._act("Add Folder to Workspace...", "", self._cmd("workbench.action.addRootFolder")))
            menu.addAction(self._act("Save Workspace As...", "", self._cmd("workbench.action.saveWorkspaceAs")))
            menu.addAction(self._act("Duplicate Workspace", "", self._cmd("workbench.action.duplicateWorkspaceInNewWindow")))
            menu.addSeparator()
            menu.addAction(self._act("Save", "Ctrl+S", self._cmd("workbench.action.files.save")))
            menu.addAction(self._act("Save As...", "Ctrl+Shift+S", self._cmd("workbench.action.files.saveAs")))
            menu.addAction(self._act("Save All", "Ctrl+K S", self._cmd("workbench.action.files.saveAll")))
            menu.addSeparator()
            # Auto Save (checkable)
            auto_save = self._act("Auto Save", "", self._cmd("workbench.action.toggleAutoSave"), checkable=True)
            menu.addAction(auto_save)
            menu.addSeparator()
            menu.addAction(self._act("Revert File", "", self._cmd("workbench.action.files.revert")))
            menu.addAction(self._act("Close Editor", "Ctrl+W", self._cmd("workbench.action.closeActiveEditor")))
            menu.addAction(self._act("Close Folder", "Ctrl+K F", self._cmd("workbench.action.closeFolder")))
            menu.addAction(self._act("Close Window", "Alt+F4", self._cmd("workbench.action.closeWindow")))
            menu.addSeparator()
            menu.addAction(self._act("Share", "", self._cmd("workbench.action.share")))
            menu.addSeparator()
            menu.addAction(self._act("Exit", "Alt+F4", self._cmd("workbench.action.quit")))

        # ------------------------------------------------------------------
        # Edit Menu — TASK-0033
        # ------------------------------------------------------------------
        def _build_edit_menu(self) -> None:
            menu = self.addMenu("&Edit")

            menu.addAction(self._act("Undo", "Ctrl+Z", self._cmd("undo")))
            menu.addAction(self._act("Redo", "Ctrl+Y", self._cmd("redo")))
            menu.addSeparator()
            menu.addAction(self._act("Cut", "Ctrl+X", self._cmd("editor.action.clipboardCutAction")))
            menu.addAction(self._act("Copy", "Ctrl+C", self._cmd("editor.action.clipboardCopyAction")))
            menu.addAction(self._act("Paste", "Ctrl+V", self._cmd("editor.action.clipboardPasteAction")))
            menu.addSeparator()
            menu.addAction(self._act("Find", "Ctrl+F", self._cmd("actions.find")))
            menu.addAction(self._act("Replace", "Ctrl+H", self._cmd("editor.action.startFindReplaceAction")))
            menu.addSeparator()
            menu.addAction(self._act("Find in Files", "Ctrl+Shift+F", self._cmd("workbench.action.findInFiles")))
            menu.addAction(self._act("Replace in Files", "Ctrl+Shift+H", self._cmd("workbench.action.replaceInFiles")))
            menu.addSeparator()
            menu.addAction(self._act("Toggle Line Comment", "Ctrl+/", self._cmd("editor.action.commentLine")))
            menu.addAction(self._act("Toggle Block Comment", "Shift+Alt+A", self._cmd("editor.action.blockComment")))
            menu.addAction(self._act("Emmet: Expand Abbreviation", "Tab", self._cmd("editor.emmet.action.expandAbbreviation")))

        # ------------------------------------------------------------------
        # Selection Menu — TASK-0034
        # ------------------------------------------------------------------
        def _build_selection_menu(self) -> None:
            menu = self.addMenu("&Selection")

            menu.addAction(self._act("Select All", "Ctrl+A", self._cmd("editor.action.selectAll")))
            menu.addAction(self._act("Expand Selection", "Shift+Alt+Right", self._cmd("editor.action.smartSelect.expand")))
            menu.addAction(self._act("Shrink Selection", "Shift+Alt+Left", self._cmd("editor.action.smartSelect.shrink")))
            menu.addSeparator()
            menu.addAction(self._act("Copy Line Up", "Shift+Alt+Up", self._cmd("editor.action.copyLinesUpAction")))
            menu.addAction(self._act("Copy Line Down", "Shift+Alt+Down", self._cmd("editor.action.copyLinesDownAction")))
            menu.addAction(self._act("Move Line Up", "Alt+Up", self._cmd("editor.action.moveLinesUpAction")))
            menu.addAction(self._act("Move Line Down", "Alt+Down", self._cmd("editor.action.moveLinesDownAction")))
            menu.addAction(self._act("Duplicate Selection", "", self._cmd("editor.action.duplicateSelection")))
            menu.addSeparator()
            menu.addAction(self._act("Add Cursor Above", "Ctrl+Alt+Up", self._cmd("editor.action.insertCursorAbove")))
            menu.addAction(self._act("Add Cursor Below", "Ctrl+Alt+Down", self._cmd("editor.action.insertCursorBelow")))
            menu.addAction(self._act("Add Cursors to Line Ends", "Shift+Alt+I", self._cmd("editor.action.insertCursorAtEndOfEachLineSelected")))
            menu.addAction(self._act("Add Next Occurrence", "Ctrl+D", self._cmd("editor.action.addSelectionToNextFindMatch")))
            menu.addAction(self._act("Add Previous Occurrence", "Ctrl+K Ctrl+D", self._cmd("editor.action.addSelectionToPreviousFindMatch")))
            menu.addAction(self._act("Select All Occurrences", "Ctrl+Shift+L", self._cmd("editor.action.selectHighlights")))
            menu.addSeparator()
            menu.addAction(self._act("Switch to Ctrl+Click for Multi-Cursor", "", self._cmd("workbench.action.switchMultiCursorModifier")))
            menu.addAction(self._act("Column Selection Mode", "", self._cmd("editor.action.toggleColumnSelection"), checkable=True))

        # ------------------------------------------------------------------
        # View Menu — TASK-0035
        # ------------------------------------------------------------------
        def _build_view_menu(self) -> None:
            menu = self.addMenu("&View")

            menu.addAction(self._act("Command Palette...", "Ctrl+Shift+P", self._cmd("workbench.action.showCommands")))
            menu.addAction(self._act("Open View...", "", self._cmd("workbench.action.openView")))
            menu.addSeparator()

            # Appearance submenu
            app_menu = QMenu("Appearance", self)
            app_menu.addAction(self._act("Full Screen", "F11", self._cmd("workbench.action.toggleFullScreen"), checkable=True))
            app_menu.addAction(self._act("Zen Mode", "Ctrl+K Z", self._cmd("workbench.action.toggleZenMode"), checkable=True))
            app_menu.addAction(self._act("Centered Layout", "", self._cmd("workbench.action.toggleCenteredLayout"), checkable=True))
            app_menu.addSeparator()
            app_menu.addAction(self._act("Menu Bar", "", self._cmd("workbench.action.toggleMenuBar"), checkable=True))
            app_menu.addAction(self._act("Activity Bar", "", self._cmd("workbench.action.toggleActivityBarVisibility"), checkable=True))
            app_menu.addAction(self._act("Status Bar", "", self._cmd("workbench.action.toggleStatusbarVisibility"), checkable=True))
            app_menu.addAction(self._act("Side Bar", "Ctrl+B", self._cmd("workbench.action.toggleSidebarVisibility"), checkable=True))
            app_menu.addAction(self._act("Panel", "Ctrl+J", self._cmd("workbench.action.togglePanel"), checkable=True))
            app_menu.addSeparator()
            app_menu.addAction(self._act("Zoom In", "Ctrl+=", self._cmd("workbench.action.zoomIn")))
            app_menu.addAction(self._act("Zoom Out", "Ctrl+-", self._cmd("workbench.action.zoomOut")))
            app_menu.addAction(self._act("Reset Zoom", "Ctrl+Numpad0", self._cmd("workbench.action.zoomReset")))
            menu.addMenu(app_menu)

            # Editor Layout submenu
            layout_menu = QMenu("Editor Layout", self)
            layout_menu.addAction(self._act("Split Up", "", self._cmd("workbench.action.splitEditorUp")))
            layout_menu.addAction(self._act("Split Down", "", self._cmd("workbench.action.splitEditorDown")))
            layout_menu.addAction(self._act("Split Left", "", self._cmd("workbench.action.splitEditorLeft")))
            layout_menu.addAction(self._act("Split Right", "Ctrl+\\", self._cmd("workbench.action.splitEditor")))
            layout_menu.addSeparator()
            layout_menu.addAction(self._act("Single", "", self._cmd("workbench.action.editorLayoutSingle")))
            layout_menu.addAction(self._act("Two Columns", "", self._cmd("workbench.action.editorLayoutTwoColumns")))
            layout_menu.addAction(self._act("Three Columns", "", self._cmd("workbench.action.editorLayoutThreeColumns")))
            layout_menu.addAction(self._act("Two Rows", "", self._cmd("workbench.action.editorLayoutTwoRows")))
            layout_menu.addAction(self._act("Three Rows", "", self._cmd("workbench.action.editorLayoutThreeRows")))
            layout_menu.addAction(self._act("Grid (2x2)", "", self._cmd("workbench.action.editorLayoutTwoByTwoGrid")))
            layout_menu.addAction(self._act("Two Rows Right", "", self._cmd("workbench.action.editorLayoutTwoRowsRight")))
            layout_menu.addAction(self._act("Two Columns Bottom", "", self._cmd("workbench.action.editorLayoutTwoColumnsBottom")))
            menu.addMenu(layout_menu)

            menu.addSeparator()
            menu.addAction(self._act("Explorer", "Ctrl+Shift+E", self._cmd("workbench.view.explorer")))
            menu.addAction(self._act("Search", "Ctrl+Shift+F", self._cmd("workbench.view.search")))
            menu.addAction(self._act("Source Control", "Ctrl+Shift+G", self._cmd("workbench.view.scm")))
            menu.addAction(self._act("Run and Debug", "Ctrl+Shift+D", self._cmd("workbench.view.debug")))
            menu.addAction(self._act("Extensions", "Ctrl+Shift+X", self._cmd("workbench.view.extensions")))
            menu.addSeparator()
            menu.addAction(self._act("Terminal", "Ctrl+`", self._cmd("workbench.action.terminal.toggleTerminal")))
            menu.addAction(self._act("Problems", "Ctrl+Shift+M", self._cmd("workbench.panel.markers.view.focus")))
            menu.addAction(self._act("Output", "Ctrl+Shift+U", self._cmd("workbench.action.output.toggleOutput")))
            menu.addAction(self._act("Debug Console", "Ctrl+Shift+Y", self._cmd("workbench.debug.action.toggleRepl")))
            menu.addSeparator()
            menu.addAction(self._act("Word Wrap", "Alt+Z", self._cmd("editor.action.toggleWordWrap"), checkable=True))
            menu.addAction(self._act("Minimap", "", self._cmd("editor.action.toggleMinimap"), checkable=True))
            menu.addAction(self._act("Breadcrumbs", "", self._cmd("breadcrumbs.toggle"), checkable=True))
            menu.addAction(self._act("Render Whitespace", "", self._cmd("editor.action.toggleRenderWhitespace"), checkable=True))
            menu.addAction(self._act("Render Control Characters", "", self._cmd("editor.action.toggleRenderControlCharacter"), checkable=True))

        # ------------------------------------------------------------------
        # Go Menu — TASK-0036
        # ------------------------------------------------------------------
        def _build_go_menu(self) -> None:
            menu = self.addMenu("&Go")

            menu.addAction(self._act("Back", "Alt+Left", self._cmd("workbench.action.navigateBack")))
            menu.addAction(self._act("Forward", "Alt+Right", self._cmd("workbench.action.navigateForward")))
            menu.addAction(self._act("Last Edit Location", "Ctrl+K Ctrl+Q", self._cmd("workbench.action.navigateToLastEditLocation")))
            menu.addSeparator()
            menu.addAction(self._act("Switch Editor", "Ctrl+Tab", self._cmd("workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup")))
            menu.addSeparator()
            menu.addAction(self._act("Go to File...", "Ctrl+P", self._cmd("workbench.action.quickOpen")))
            menu.addAction(self._act("Go to Symbol in Workspace...", "Ctrl+T", self._cmd("workbench.action.showAllSymbols")))
            menu.addAction(self._act("Go to Symbol in Editor...", "Ctrl+Shift+O", self._cmd("workbench.action.gotoSymbol")))
            menu.addSeparator()
            menu.addAction(self._act("Go to Definition", "F12", self._cmd("editor.action.revealDefinition")))
            menu.addAction(self._act("Go to Declaration", "", self._cmd("editor.action.revealDeclaration")))
            menu.addAction(self._act("Go to Type Definition", "", self._cmd("editor.action.goToTypeDefinition")))
            menu.addAction(self._act("Go to Implementation", "Ctrl+F12", self._cmd("editor.action.goToImplementation")))
            menu.addAction(self._act("Go to References", "Shift+F12", self._cmd("editor.action.goToReferences")))
            menu.addSeparator()
            menu.addAction(self._act("Go to Line/Column...", "Ctrl+G", self._cmd("workbench.action.gotoLine")))
            menu.addAction(self._act("Go to Bracket", "Ctrl+Shift+\\", self._cmd("editor.action.jumpToBracket")))
            menu.addSeparator()
            menu.addAction(self._act("Next Problem", "F8", self._cmd("editor.action.marker.nextInFiles")))
            menu.addAction(self._act("Previous Problem", "Shift+F8", self._cmd("editor.action.marker.prevInFiles")))
            menu.addSeparator()
            menu.addAction(self._act("Next Change", "Alt+F3", self._cmd("workbench.action.editor.nextChange")))
            menu.addAction(self._act("Previous Change", "Shift+Alt+F3", self._cmd("workbench.action.editor.previousChange")))

        # ------------------------------------------------------------------
        # Run Menu — TASK-0037
        # ------------------------------------------------------------------
        def _build_run_menu(self) -> None:
            menu = self.addMenu("&Run")

            menu.addAction(self._act("Start Debugging", "F5", self._cmd("workbench.action.debug.start")))
            menu.addAction(self._act("Run Without Debugging", "Ctrl+F5", self._cmd("workbench.action.debug.run")))
            menu.addAction(self._act("Stop Debugging", "Shift+F5", self._cmd("workbench.action.debug.stop")))
            menu.addAction(self._act("Restart Debugging", "Ctrl+Shift+F5", self._cmd("workbench.action.debug.restart")))
            menu.addSeparator()
            menu.addAction(self._act("Open Configurations", "", self._cmd("workbench.action.debug.configure")))
            menu.addAction(self._act("Add Configuration...", "", self._cmd("debug.addConfiguration")))
            menu.addSeparator()
            menu.addAction(self._act("Step Over", "F10", self._cmd("workbench.action.debug.stepOver")))
            menu.addAction(self._act("Step Into", "F11", self._cmd("workbench.action.debug.stepInto")))
            menu.addAction(self._act("Step Out", "Shift+F11", self._cmd("workbench.action.debug.stepOut")))
            menu.addAction(self._act("Continue", "F5", self._cmd("workbench.action.debug.continue")))
            menu.addSeparator()
            menu.addAction(self._act("Toggle Breakpoint", "F9", self._cmd("editor.debug.action.toggleBreakpoint")))
            menu.addAction(self._act("New Breakpoint", "", None))
            menu.addAction(self._act("Enable All Breakpoints", "", self._cmd("workbench.debug.viewlet.action.enableAllBreakpoints")))
            menu.addAction(self._act("Disable All Breakpoints", "", self._cmd("workbench.debug.viewlet.action.disableAllBreakpoints")))
            menu.addAction(self._act("Remove All Breakpoints", "", self._cmd("workbench.debug.viewlet.action.removeAllBreakpoints")))
            menu.addSeparator()
            menu.addAction(self._act("Install Additional Debuggers...", "", self._cmd("debug.installAdditionalDebuggers")))

        # ------------------------------------------------------------------
        # Terminal Menu — TASK-0038
        # ------------------------------------------------------------------
        def _build_terminal_menu(self) -> None:
            menu = self.addMenu("&Terminal")

            menu.addAction(self._act("New Terminal", "Ctrl+Shift+`", self._cmd("workbench.action.terminal.new")))
            menu.addAction(self._act("Split Terminal", "Ctrl+Shift+5", self._cmd("workbench.action.terminal.split")))
            menu.addSeparator()
            menu.addAction(self._act("Run Task...", "", self._cmd("workbench.action.tasks.runTask")))
            menu.addAction(self._act("Run Build Task", "Ctrl+Shift+B", self._cmd("workbench.action.tasks.build")))
            menu.addAction(self._act("Run Active File In Active Terminal", "", self._cmd("workbench.action.terminal.runActiveFile")))
            menu.addAction(self._act("Run Selected Text In Active Terminal", "", self._cmd("workbench.action.terminal.runSelectedText")))
            menu.addSeparator()
            menu.addAction(self._act("Show Running Tasks...", "", self._cmd("workbench.action.tasks.showTasks")))
            menu.addAction(self._act("Restart Running Task...", "", self._cmd("workbench.action.tasks.restartTask")))
            menu.addAction(self._act("Terminate Task...", "", self._cmd("workbench.action.tasks.terminate")))
            menu.addSeparator()
            menu.addAction(self._act("Configure Tasks...", "", self._cmd("workbench.action.tasks.configureDefaultBuildTask")))
            menu.addAction(self._act("Configure Default Build Task...", "", self._cmd("workbench.action.tasks.configureDefaultBuildTask")))
            menu.addSeparator()
            menu.addAction(self._act("Kill Active Terminal Instance", "", self._cmd("workbench.action.terminal.kill")))

        # ------------------------------------------------------------------
        # Help Menu — TASK-0039
        # ------------------------------------------------------------------
        def _build_help_menu(self) -> None:
            menu = self.addMenu("&Help")

            menu.addAction(self._act("Welcome", "", self._cmd("workbench.action.showWelcomePage")))
            menu.addAction(self._act("Show All Commands", "Ctrl+Shift+P", self._cmd("workbench.action.showCommands")))
            menu.addAction(self._act("Interactive Playground", "", self._cmd("workbench.action.showInteractivePlayground")))
            menu.addSeparator()
            menu.addAction(self._act("Documentation", "", self._cmd("workbench.action.openDocumentationUrl")))
            menu.addAction(self._act("Editor Playground", "", self._cmd("workbench.action.showInteractivePlayground")))
            menu.addSeparator()
            menu.addAction(self._act("Release Notes", "", self._cmd("workbench.action.showReleaseNotes")))
            menu.addAction(self._act("Keyboard Shortcut Reference", "", self._cmd("workbench.action.keybindingsReference")))
            menu.addAction(self._act("Video Tutorials", "", self._cmd("workbench.action.openVideoTutorialsUrl")))
            menu.addAction(self._act("Tips and Tricks", "", self._cmd("workbench.action.openTipsAndTricksUrl")))
            menu.addSeparator()
            menu.addAction(self._act("Join Us on YouTube", "", self._cmd("workbench.action.openYouTubeChannel")))
            menu.addAction(self._act("Search Feature Requests", "", self._cmd("workbench.action.openRequestFeatureUrl")))
            menu.addAction(self._act("Report Issue", "", self._cmd("workbench.action.openIssueReporter")))
            menu.addSeparator()
            menu.addAction(self._act("View License", "", self._cmd("workbench.action.openLicenseUrl")))
            menu.addAction(self._act("Privacy Statement", "", self._cmd("workbench.action.openPrivacyStatementUrl")))
            menu.addSeparator()
            menu.addAction(self._act("Toggle Developer Tools", "Ctrl+Shift+I", self._cmd("workbench.action.toggleDevTools")))
            menu.addAction(self._act("Open Process Explorer", "", self._cmd("workbench.action.openProcessExplorer")))
            menu.addSeparator()
            menu.addAction(self._act("Check for Updates...", "", self._cmd("workbench.action.checkForVSCodeUpdate")))
            menu.addAction(self._act("About", "", self._cmd("workbench.action.showAboutDialog")))

        # ------------------------------------------------------------------
        # Command binding helper
        # ------------------------------------------------------------------
        def _cmd(self, command_id: str):
            """Return a slot that executes a command."""
            def slot():
                from pydardcor.core.commands import get_command_registry
                reg = get_command_registry()
                if reg.has(command_id):
                    reg.execute(command_id)
                else:
                    # Forward to main window if it has a handler
                    mw = self._mw()
                    if mw and hasattr(mw, "_execute_command"):
                        mw._execute_command(command_id)
            return slot

else:
    class DardcorMenuBar:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass
