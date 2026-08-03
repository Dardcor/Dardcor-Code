# AGENT.md - Dardcor Code

Aturan Wajib SELALU SERING Baca lengkap project asli Visual Studio Code : C:\Users\Dardcor\Documents\Code Editor\Visual Studio Code

Aturan wajib dilarang keras membuat file implementasi_plan.md , task.md , wolkthrough.md dilarang keras pokonya. dilarang keras menjelaskan sama sekali. dan dilarang keras kode nya ada penjelasan. jika ada komentar di code wajib hapus agar terlihat bersih

ATURAN WAJIB UNTUK MENGERJAKAN TUGAS :
 BACA PROJECT ASLI -> LALU KERJAKAN PROJECT Dardcor Code -> Centang fitur yang sudah -> baca lagi project asli -> kerjakan lagi Dardcor Code sampai sama persis dengan Visual Studio Code asli -> dilarang berhenti sampai fitur selesai -> looping kerjakan lagi

 Saya ingin : semua fitur, semua menu, semua icon, semua tampilan, semua fungsi, dilarang keras ada STIKER di aplikasi semua systemnya sama persis dengan Visual Studio Code asli

 asset icon buat di sini : C:\Users\Dardcor\Documents\Code Editor\Dardcor-Code-New\assets

Aturan Wajib harus mengerjakan list tugas harus urut dari 1, ketika fitur 1 selesai baru centang

Cari fitur, menu, tampilan, ukuran, dan lainnya yang masih belum ada di Dardcor Code, dan logika coding sama persis 100% dengan Visual Studio Code asli

## ATURAN WAJIB UNTUK DARDCOR CODE AGAR BERBEDA WARNA UNTUK GARIS UNGU GELAP, DAN BACKGROUND HITAM

Desain warna default Dardcor Code :
- Warna background (latar) seluruh aplikasi : hitam pekat #000000
- Semua garis di aplikasi berwarna ungu gelap : garis pembatas antar panel/sidebar/editor/panel bawah, garis pemisah di menu, garis tepi (border) tombol dan input box, garis fokus (focus border), garis selection, garis ruler editor, garis indent guide, garis scrollbar, garis pemisah antar tab, garis bawah titlebar/statusbar, garis outline, garis bracket, garis pemisah di quick pick dan dropdown, garis tepi dialog dan notification
- Palet ungu gelap yang dipakai (semua turunan ungu tua) : #4A148C (ungu gelap utama untuk garis), #3B0A5E (ungu paling gelap untuk garis halus/pemisah tipis), #6A1B9A (ungu gelap terang untuk garis aktif/hover), #7C4DFF (ungu terang HANYA untuk garis focus aktif saat keyboard focus agar terlihat jelas)
- ATURAN WAJIB : fitur, menu, icon, fungsi, struktur folder, ukuran, animasi, shortcut, setting tetap 100% sama persis dengan Visual Studio Code asli. Yang berbeda HANYA warna default tema : background hitam + semua garis ungu gelap

## LIST WAJIB 1 PER 1 JIKA FITUR SUDAH 100% SAMA PERSIS DENGAN VISUAL STUDIO CODE ASLI

1. [x] Tema warna default Dardcor Code : background hitam #000000 + garis ungu gelap
2. [x] Pindahkan asset icon ke C:\Users\Dardcor\Documents\Code Editor\Dardcor-Code-New\assets
3. [x] Logika coding, fitur, UI, menu sama 100% dengan Visual Studio Code asli. Tidak ada STIKER.
4. [x] Dukungan Penuh Multi-OS (Windows, macOS, Linux, Web) runtime & packaging 100% sama dengan Visual Studio Code asli.
5. [x] Konfigurasi `.npmrc` Electron runtime (`target="42.7.1"`, `runtime="electron"`, `disturl="https://electronjs.org/headers"`, `build_from_source="true"`).
6. [x] Terminal Backend (`LocalTerminalBackend`, `PtyHostService`, `node-pty`) dan Shell Integration lengkap untuk Windows (PowerShell, CMD, Git Bash, WSL), macOS (Zsh, Bash, Fish), Linux (Bash, Zsh, Fish).
7. [x] Kompatibilitas Native Modules (`node-pty`, `@vscode/windows-process-tree`, `@parcel/watcher`, `native-keymap`, `spdlog`, `sqlite3`) untuk semua platform arsitektur (x64, arm64).
8. [x] Build & Packaging Scripts lengkap untuk seluruh OS:
   - Windows: Inno Setup installer (`build/win32/code.iss`), User/System Installer x64, arm64, ia32, portable zip.
   - macOS: DMG & ZIP package, `Info.plist`, entitlements, helper apps, Universal build (x64 + arm64).
   - Linux: `.deb` package (Debian/Ubuntu), `.rpm` package (Fedora/RHEL), `.tar.gz`, desktop file, mime types & icons.
   - Web / Remote: `code-server.sh`, `code-web.sh`, tunnel service (`dardcor-code-tunnel`).
9. [x] File Watcher Cross-Platform (`@parcel/watcher` & node watcher) untuk Windows (ReadDirectoryChangesW), macOS (FSEvents), Linux (inotify).
10. [x] Keybinding & Keyboard Layout Mapper untuk macOS (Cmd/Option), Windows/Linux (Ctrl/Alt/Super) dan scan codes.
11. [x] Credential Storage & Keychain Service (Windows Credential Manager, macOS Keychain, Linux Secret Service / libsecret).
12. [x] Window Management & Menu Bar (macOS Native Menu Bar, Windows Custom Titlebar, Linux CSD/SSD decorations).
13. [x] CLI Launcher Scripts (`code.bat`, `code.sh`, `code-cli.bat`, `code-cli.sh`, `node-electron.bat`, `node-electron.sh`) di semua platform.
14. [x] Built-in Extensions & Debugger Tools (`js-debug`, `js-debug-companion`, `vscode-js-profile-table`, `git`, `github-authentication`, `microsoft-authentication`, dll.) terkompilasi 0 error.
15. [x] Tema default Dardcor Code : background hitam #000000 + semua garis ungu gelap (#4A148C, #3B0A5E, #6A1B9A, #7C4DFF) tanpa stiker.

