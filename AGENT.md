# DARDCOR CODE VS VISUAL STUDIO CODE - FEATURE PARITY ANALYSIS & ACTION PLAN

Dokumen ini berisi analisis mendalam, perbandingan lengkap, dan daftar gap fitur antara **Dardcor Code** (PySide6 Python-based IDE) dengan **Visual Studio Code** asli (`C:\Users\Dardcor\Documents\Code Editor\Visual Studio Code`). Tujuannya adalah memetakan semua fungsi, tampilan, menu, ikon, dan animasi yang masih belum sama persis agar dapat diimplementasikan secara bertahap menuju 100% parity.

---

## 1. STRUKTUR MENU (MENUBAR & CONTEXT MENUS)

### A. Menu Utama (MenuBar)
Banyak item menu di Dardcor Code saat ini masih berupa *placeholder* yang memicu Command Palette atau menampilkan pesan dialog "coming soon". Berikut adalah daftar menu yang harus diimplementasikan agar fiturnya berfungsi penuh seperti VS Code asli:

| Lokasi Menu | Item Menu VS Code | Status di Dardcor Code | Rencana Implementasi PySide6 |
| :--- | :--- | :--- | :--- |
| **File** | Open Workspace from File... | [x] Sudah sama persis | Terintegrasi parser file `.code-workspace` JSON. |
| **File** | Open Recent | [x] Sudah sama persis | Terintegrasi dinamis memuat cache list path file/folder terakhir dari config.json. |
| **File** | Add Folder to Workspace... | [x] Sudah sama persis | Terintegrasi dynamic multi-root tree view di File Explorer. |
| **File** | Save Workspace As... | [x] Sudah sama persis | Membuat dialog penyimpanan file `.code-workspace` JSON. |
| **File** | Share -> Export/Import Profile... | [x] Sudah sama persis | Membuat zip exporter dan importer untuk seluruh konfigurasi JSON. |
| **File** | Revert File | [x] Sudah sama persis | Membatalkan perubahan buffer Monaco dengan membaca ulang file asli dari disk. |
| **Edit** | Emmet: Expand Abbreviation | [x] Sudah sama persis | Terintegrasi library Emmet (JS) ke dalam instance Monaco Editor dengan custom autocomplete dan editor actions. |
| **Selection** | Switch to Ctrl+Click | [x] Sudah sama persis | Kirim konfigurasi `multiCursorModifier` ke Monaco via WebChannel. |
| **View** | Open View... | [x] Sudah sama persis | Buat QuickPick dialog berisi daftar panel (Explorer, Search, SCM, dll) dan hubungkan dengan navigasi panel. |
| **View** | Appearance -> Full Screen | [x] Sudah sama persis | Gunakan `self.showFullScreen()` / `self.showNormal()` dan sembunyikan custom title bar untuk seamless fullscreen. |
| **Go** | Go to File... | [x] Sudah sama persis | Terhubung dengan dialog QuickOpen (Ctrl+P) yang memindai seluruh root folder workspace secara asinkron. |
| **Go** | Go to Symbol in Workspace...| [x] Sudah sama persis | Gunakan LSP Client untuk mengirim request `workspace/symbol` dan tampilkan di QuickPick dengan fallback local parsing. |
| **Run** | Start Debugging (F5) | [x] Sudah sama persis | Terhubung dengan parser `launch.json` dan DAP (Debug Adapter Protocol) client. |

---

## 2. INTEGRASI SISTEM & FITUR CORE (FUNCTIONS)

### A. Multi-Root Workspaces [x] Sudah sama persis
*   **VS Code:** Mendukung pembukaan beberapa folder utama sekaligus dalam satu sidebar explorer menggunakan file konfigurasi `.code-workspace`.
*   **Dardcor Code:** Telah terintegrasi sepenuhnya dengan file `.code-workspace`, rendering multi-root asinkron, serta penyesuaian workbench primer secara dinamis.

### B. Hot Exit & Session Restore [x] Sudah sama persis
*   **VS Code:** Jika aplikasi ditutup tanpa menyimpan file (dirty), file tidak hilang. Saat dibuka kembali, tab un-saved langsung dipulihkan secara otomatis.
*   **Dardcor Code:** Menyimpan cadangan draf buffer Monaco secara berkala dan memulihkan seluruh tab sesi yang aktif beserta status dirty saat startup menggunakan manifest session.json.

### C. Workspace Trust (Kepercayaan Workspace) [x] Sudah sama persis
*   **VS Code:** Meminta konfirmasi apakah user mempercayai folder yang dibuka sebelum mengeksekusi task, debugger, atau ekstensi yang berpotensi berbahaya.
*   **Dardcor Code:** Memblokir eksekusi task, debugger, dan ekstensi secara aktif ketika workspace berstatus "Restricted Mode" (Untrusted), serta menampilkan banner warning interaktif di bagian atas workbench untuk mempercayai workspace secara langsung.
### D. Settings UI Grafis (`Ctrl+,`) [x] Sudah sama persis
*   **VS Code:** Memiliki GUI Settings yang sangat kaya dengan kategori (Commonly Used, Text Editor, Window, Features, Application), kolom pencarian, dan deteksi apakah setting telah dimodifikasi dari default.
*   **Dardcor Code:** Memiliki tab editor khusus `SettingsUIWidget` dengan categories (Text Editor, Workbench, Files, Terminal, dll), filter pencarian, scope selector (User/Workspace), input widget interaktif, dan validasi modifikasi setting secara real-time.

---

## 3. BAHASA & EDITOR (MONACO INTEGRATION)

### A. Inlay Hints & Code Lens
*   **VS Code:** Menampilkan parameter names, tipe data secara inline di antara teks kode (inlay hints) dan link perintah di atas deklarasi fungsi (code lens).
*   **Dardcor Code:** Jembatan LSP client belum sepenuhnya mengirimkan/menggambar inlay hints ke Monaco Editor.
*   **Solusi:** Daftarkan provider inlay hints di Monaco menggunakan koordinat hasil query dari LSP server (`textDocument/inlayHint`).

### B. Mini-diff & Inline Diff Editor
*   **VS Code:** Menampilkan perubahan langsung di gutter editor (garis hijau/biru/merah untuk add/change/delete) dan mendukung visualisasi komparasi split/inline.
*   **Dardcor Code:** Diff viewer masih berupa tab terpisah yang statis.
*   **Solusi:** Aktifkan model dekorasi Monaco (`editor.createDiffEditor`) dan hubungkan dengan data git diff mentah secara real-time.

---

## 4. TAMPILAN, TATA LETAK, & ANIMASI (UI & ANIMATIONS)

Untuk mencapai keindahan visual yang sama persis dengan VS Code aslinya, Dardcor Code wajib menerapkan animasi mikro dan transisi CSS/Qt berikut:

### A. Animasi Slide SideBar & Panel
*   **VS Code:** Ketika SideBar ditutup (`Ctrl+B`) atau Panel Terminal dibuka, ada animasi *sliding* horizontal/vertical yang halus.
*   **Dardcor Code:** Panel langsung muncul/hilang secara instan (`setVisible(True/False)`).
*   **Solusi:** Gunakan `QPropertyAnimation` pada properti `maximumWidth` atau `sizes` milik `QSplitter` untuk menganimasikan perpindahan ukuran panel secara *easing* (misal: `QEasingCurve.InOutQuad`, durasi 200ms).

### B. Drag-and-Drop Editor Tabs & Grid Layout
*   **VS Code:** Tab editor dapat ditarik (*drag-and-drop*) untuk diatur ulang posisinya, ditarik keluar untuk membuat split window baru, atau digabungkan ke tab group lain dengan indikator visual *drop-zone*.
*   **Dardcor Code:** Tab editor menggunakan `QTabBar` standar yang hanya mendukung reordering dasar dalam satu baris.
*   **Solusi:** Kembangkan custom Tab Widget berbasis `QDrag` dan `QDropEvent` yang mendeteksi koordinat pelepasan tab untuk melakukan split dinamis (atas, bawah, kiri, kanan).

### C. Efek Hover & Active Line pada Activity Bar
*   **VS Code:** Ikon yang aktif memiliki garis penunjuk vertikal tebal di sisi kiri. Ketika kursor mendekat, ikon bergoyang/membesar tipis (*micro-interaction*) dan menampilkan *tooltip* kustom yang melayang halus.
*   **Dardcor Code:** Menggunakan CSS hover statis.
*   **Solusi:** Terapkan transisi CSS `transition: all 0.2s ease;` pada stylesheet komponen Activity Bar dan gunakan custom tooltip berbasis frameless QWidget dengan efek fade-in (`QGraphicsOpacityEffect`).

---

## 5. EKSTRAKSI ICON DARI VS CODE (ICON EXTRACTOR FORMULA)

Dardcor Code harus mengambil kumpulan ikon asli dari VS Code (`src/vs/base/common/codiconsLibrary.ts`). Kita dapat mengkloning pemetaannya langsung menjadi framework Python.

### A. Format Pemetaan Python Codicon (Rencana Implementasi)
Kita buat file pemetaan `pydardcor/ui_shared/codicons.py` yang menampung seluruh daftar Codicon asli dari Microsoft. Contoh implementasinya:

```python
# pydardcor/ui_shared/codicons.py
# File pemetaan ikon Codicons asli dari VS Code (src/vs/base/common/codiconsLibrary.ts)

class Codicons:
    ADD = "\uea60"
    PLUS = "\uea60"
    GIST_NEW = "\uea60"
    REPO_CREATE = "\uea60"
    LIGHTBULB = "\uea61"
    LIGHT_BULB = "\uea61"
    REPO = "\uea62"
    REPO_DELETE = "\uea62"
    GIST_FORK = "\uea63"
    REPO_FORKED = "\uea63"
    GIT_PULL_REQUEST = "\uea64"
    KEYBOARD = "\uea65"
    TAG = "\uea66"
    PERSON = "\uea67"
    SOURCE_CONTROL = "\uea68"
    STAR = "\uea6a"
    COMMENT = "\uea6b"
    WARNING = "\uea6c"
    SEARCH = "\uea6d"
    SIGN_OUT = "\uea6e"
    SIGN_IN = "\uea6f"
    EYE = "\uea70"
    CLOSE = "\uea76"
    SYNC = "\uea77"
    CLONE = "\uea78"
    BEAKER = "\uea79"
    FOLDER = "\uea83"
    TERMINAL = "\uea85"
    ERROR = "\uea87"
    CHEVRON_DOWN = "\ueab4"
    CHEVRON_LEFT = "\ueab5"
    CHEVRON_RIGHT = "\ueab6"
    CHEVRON_UP = "\ueab7"
    CHROME_CLOSE = "\ueab8"
    CHROME_MAXIMIZE = "\ueab9"
    CHROME_MINIMIZE = "\ueaba"
    CHROME_RESTORE = "\ueabb"
    # ... Dan ribuan ikon lainnya dari VS Code asli

    @classmethod
    def get(cls, name: str, default: str = "") -> str:
        # Mengubah format 'git-pull-request' menjadi 'GIT_PULL_REQUEST'
        key = name.upper().replace("-", "_")
        return getattr(cls, key, default)
```

### B. Integrasi Seti File Icons
*   **VS Code:** Memiliki ribuan ikon file yang disesuaikan berdasarkan ekstensi nama file, nama file khusus (misal `.gitignore`, `package.json`), dan nama folder khusus (misal `node_modules`, `tests`).
*   **Dardcor Code:** Baru memiliki pemetaan SVG sederhana untuk beberapa ekstensi.
*   **Rencana Pemindahan:**
    1. Ekstrak data JSON dari file ekstensi Seti VS Code (`extensions/theme-seti/icons/vs-seti-icon-theme.json`).
    2. Konversi JSON tersebut menjadi pemetaan Python dictionary di `pydardcor/file_explorer/file_icons.py`.
    3. Muat font ikon Seti (`seti.woff` or SVG-nya) agar bisa digambar secara native di `QTreeView` File Explorer.

---

## 6. SIKLUS LOOPING PENGEMBANGAN (ACTION PLAN FLOW)

Sesuai instruksi, siklus pencarian gap ini akan terus berlanjut secara bergilir:

1. **Baca Project Dardcor Code:** Telusuri komponen UI, logika internal, file editor, panel, terminal, remote client, dan API.
2. **Baca Project VS Code Asli:** Analisis modularitas JS/TS di `src/vs` milik Microsoft VS Code.
3. **Pencatatan Gap:** Setiap kali ditemukan fungsi, animasi, layout, dialog, atau menu yang belum sama, catat langsung secara bertahap di file `AGENT.md`.
4. **Ekstraksi Aset:** Salin library font dan kode unicode icon dari project asli ke format Python.
5. **Perbaikan & Looping:** Lakukan pengembangan fitur secara asinkron lalu ulangi langkah analisis di atas secara terus-menerus.
