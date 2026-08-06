# AGENT.md - Dardcor Code

Aturan Wajib SELALU SERING Baca keseluruhan lengkap project asli Dardcor Code : C:\Users\Dardcor\Documents\Code Editor\Dardcor-Code

Aturan Wajib SELALU SERING Baca keseluruhan lengkap project asli Visual Studio Code : C:\Users\Dardcor\Documents\Code Editor\Visual Studio Code

ATURAN YANG WAJIB SELALU DIINGAT :
1. Aturan wajib dilarang keras membuat file implementasi_plan.md , task.md , wolkthrough.md dilarang keras pokonya. dilarang keras menjelaskan sama sekali. dan dilarang keras kode nya ada penjelasan. jika ada komentar di code wajib hapus agar terlihat bersih
2. Ketika membuat file testing/file sampai, jangan lupa untuk hapus

ATURAN WAJIB UNTUK MENGERJAKAN TUGAS :
BACA PROJECT ASLI -> LALU KERJAKAN PROJECT Dardcor Code -> cari lagi fitur, menu, tampilan, ukuran, dan lainnya yang masih belum ada di Dardcor Code -> baca lagi project asli -> kerjakan lagi Dardcor Code sampai sama persis dengan Visual Studio Code asli -> dilarang berhenti sampai fitur selesai -> looping kerjakan lagi

ATURAN WAJIB UNTUK PROJECT :
jika ada code file/folder bernama vscode ganti menjadi dardcor, tapi jika fungsi tersebut penting jangan diganti agar berfungsi di Dardcor Code

Saya ingin : semua fitur, semua menu, semua icon, semua tampilan, semua fungsi, dilarang keras ada STIKER di aplikasi semua systemnya sama persis dengan Visual Studio Code asli

## tempat asset icon buat di sini : C:\Users\Dardcor\Documents\Code Editor\Dardcor-Code-New\assets

## tempat logo aplikasi Dardcor Code : C:\Users\Dardcor\Documents\Code Editor\Dardcor-Code\public\dardcor-code.ico

## ATURAN WAJIB UNTUK DESAIN TAMPILAN & TEMA DARDCOR CODE AGAR BERBEDA WARNA UNTUK GARIS UNGU GELAP, DAN BACKGROUND HITAM

Desain warna default Dardcor Code :
- Warna background (latar) seluruh aplikasi : hitam pekat #000000
- Semua garis di aplikasi berwarna ungu gelap : garis pembatas antar panel/sidebar/editor/panel bawah, garis pemisah di menu, garis tepi (border) tombol dan input box, garis fokus (focus border), garis selection, garis ruler editor, garis indent guide, garis scrollbar, garis pemisah antar tab, garis bawah titlebar/statusbar, garis outline, garis bracket, garis pemisah di quick pick dan dropdown, garis tepi dialog dan notification
- Palet ungu gelap yang dipakai (semua turunan ungu tua) : #4A148C (ungu gelap utama untuk garis), #3B0A5E (ungu paling gelap untuk garis halus/pemisah tipis), #6A1B9A (ungu gelap terang untuk garis aktif/hover), #7C4DFF (ungu terang HANYA untuk garis focus aktif saat keyboard focus agar terlihat jelas)
- ATURAN WAJIB : fitur, menu, icon, fungsi, struktur folder, ukuran, animasi, shortcut, setting tetap 100% sama persis dengan Visual Studio Code asli. Yang berbeda HANYA warna default tema : background hitam + semua garis ungu gelap

## LIST WAJIB 1 PER 1 JIKA FITUR SUDAH 100% SAMA PERSIS DENGAN VISUAL STUDIO CODE ASLI

- [x] 1. `PANEL_BORDER` di `src/dc/workbench/common/theme.ts` masih menggunakan warna abu-abu `#808080`, seharusnya warna ungu gelap `#4A148C`.
- [x] 2. `SIDE_BAR_BORDER` di `src/dc/workbench/common/theme.ts` masih menggunakan `null`, belum menggunakan warna ungu gelap `#4A148C`.
- [x] 3. `TAB_BORDER` di `src/dc/workbench/common/theme.ts` masih menggunakan warna hitam `#000000`, seharusnya menggunakan warna ungu gelap `#4A148C` sebagai garis pemisah.
- [x] 4. `STATUS_BAR_BORDER` di `src/dc/workbench/common/theme.ts` masih `null`, belum menggunakan ungu gelap `#4A148C`.
- [x] 5. `menu.separatorBackground` di `src/dc/platform/theme/common/colors/menuColors.ts` masih menggunakan `transparent(foreground, 0.2)` bukan ungu gelap `#3B0A5E`.
- [x] 6. `EDITOR_GROUP_HEADER_TABS_BORDER` di `src/dc/workbench/common/theme.ts` masih bernilai `null`, belum menggunakan ungu gelap `#4A148C`.
- [x] 7. `editorBracketMatchBorder` di `src/dc/editor/common/core/editorColorRegistry.ts` masih menggunakan `#888` (abu-abu), seharusnya ungu gelap `#4A148C`.
- [x] 8. `editorRuler.foreground` di `src/dc/editor/common/core/editorColorRegistry.ts` masih menggunakan `#5A5A5A` (abu-abu), seharusnya ungu gelap `#4A148C`.
- [x] 9. `editorIndentGuide.background` di `src/dc/editor/common/core/editorColorRegistry.ts` masih memakai warna putih transparan (turunan `editorWhitespaces`), seharusnya warna ungu gelap `#3B0A5E`.
- [x] 10. `inputBorder` di `src/dc/platform/theme/common/colors/inputColors.ts` masih bernilai `null`, belum menggunakan ungu gelap `#4A148C` untuk garis tepi input box.
- [x] 11. `buttonBorder` di `src/dc/platform/theme/common/colors/inputColors.ts` masih `contrastBorder` (`null`), belum menggunakan ungu gelap `#4A148C`.
- [x] 12. `pickerGroupBorder` di `src/dc/platform/theme/common/colors/quickpickColors.ts` masih `#3F3F46` (abu-abu tua), seharusnya ungu gelap `#4A148C` untuk pemisah quick pick.
- [x] 13. `widgetBorder` (dipakai untuk `dialogBorder`) di `src/dc/platform/theme/common/colors/editorColors.ts` masih `null`, seharusnya ungu gelap `#4A148C` untuk tepi dialog dan notification.
- [x] 14. `listInactiveFocusOutline` di `src/dc/platform/theme/common/colors/listColors.ts` masih `null`, belum menggunakan ungu gelap `#4A148C`.
- [x] 15. `NOTIFICATIONS_BORDER` di `src/dc/workbench/common/theme.ts` masih menggunakan warna turunan background, seharusnya ungu gelap `#4A148C` untuk batas pemisah notifikasi.
- [x] 16. `scrollbarSliderBackground` di `src/dc/platform/theme/common/colors/miscColors.ts` masih menggunakan `#797979` transparan (abu-abu), seharusnya menggunakan ungu gelap `#3B0A5E`.
- [x] 17. CSS hardcoded untuk scrollbar di `src/dc/workbench/browser/style.ts` (baris 24-26) masih menggunakan `rgba(121, 121, 121)` (abu-abu), belum menggunakan ungu gelap `#3B0A5E`.
- [x] 18. `TITLE_BAR_BORDER` di `src/dc/workbench/common/theme.ts` masih `null`, belum menggunakan ungu gelap `#4A148C` untuk garis bawah titlebar.
- [x] 19. `selectBorder` (`dropdown.border`) di `src/dc/platform/theme/common/colors/inputColors.ts` masih menggunakan `selectBackground` (abu-abu gelap), seharusnya ungu gelap `#4A148C`.
- [x] 20. `menuBorder` di `src/dc/platform/theme/common/colors/menuColors.ts` masih `null`, belum menggunakan ungu gelap `#4A148C` untuk tepi luar menu.
- [x] 21. `notebook.cellToolbarSeparator` di `src/dc/workbench/contrib/notebook/browser/notebookEditorWidget.ts` masih menggunakan warna abu-abu `#808080`, seharusnya warna ungu gelap `#4A148C`.
- [x] 22. CSS scrollbar `rgba(121, 121, 121, 0.4)` (abu-abu) di `src/dc/workbench/contrib/issue/browser/media/issueReporterOverlay.css` belum menggunakan ungu gelap `#3B0A5E`.
- [x] 23. Hardcoded background color `#8080802B` (abu-abu) pada label versi ekstensi di `src/dc/workbench/contrib/extensions/browser/extensionsWidgets.ts` seharusnya menggunakan `#3B0A5E2B`.
- [x] 24. Folder struktur `.eslint-plugin-local` hilang di root Dardcor Code; disalin ulang dari Visual Studio Code.
- [x] 25. File `CodeQL.yml` dan `ThirdPartyNotices.txt` belum ada di Dardcor Code; disalin ulang.
- [x] 26. Direktori `.devcontainer` (termasuk Dockerfile, sh) tidak ada di Dardcor Code; disalin ulang dari VS Code.
- [x] 27. File core test `test/monaco/dist/core.html` terhapus/hilang di Dardcor Code; dikembalikan seperti versi asli.
- [x] 28. Direktori `.github` kehilangan puluhan file aslinya (workflow, action, template instruksi, dll) yang tidak dibawa ke Dardcor Code; struktur ini sudah disalin seluruhnya (kecuali menimpa yang sudah dimodifikasi khusus).
- [x] 29. Pengecekan menyeluruh `src/dc` vs `src/vs` menunjukkan kode sudah 100% identik strukturnya (tidak ada script yang kurang).
