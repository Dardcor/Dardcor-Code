# AGENT.md - Dardcor Code

Ini adalah project Dardcor Code yang sudah hampir sempurna karena semua logikanya sudah hampir sempurna, anda harus hati hati dalam mengerjakan

Aturan Wajib SELALU SERING Baca keseluruhan lengkap project asli Dardcor Code : C:\Users\Dardcor\Documents\Code Editor\Dardcor-Code

Aturan Wajib SELALU SERING Baca keseluruhan lengkap project asli Visual Studio Code : C:\Users\Dardcor\Documents\Code Editor\Visual Studio Code

ATURAN YANG WAJIB SELALU DIINGAT :
1. Aturan wajib dilarang keras membuat file implementasi_plan.md , task.md , wolkthrough.md dilarang keras pokonya. dilarang keras menjelaskan sama sekali. dan dilarang keras kode nya ada penjelasan. jika ada komentar di code wajib hapus agar terlihat bersih
2. Ketika membuat file testing/file sampai, jangan lupa untuk hapus

ATURAN WAJIB UNTUK MENGERJAKAN TUGAS :
BACA PROJECT ASLI -> LALU KERJAKAN PROJECT Dardcor Code -> cari lagi fitur, menu, tampilan, ukuran, dan lainnya yang masih belum ada di Dardcor Code -> baca lagi project asli -> kerjakan lagi Dardcor Code sampai sama persis dengan Visual Studio Code asli -> dilarang berhenti sampai fitur selesai -> looping kerjakan lagi

ATURAN WAJIB UNTUK PROJECT :
jika ada code file/folder bernama vscode ganti menjadi dardcor, tapi jika fungsi tersebut penting jangan diganti agar berfungsi di Dardcor Code

Saya ingin : semua fitur, semua menu, semua icon, semua tampilan, semua fungsi, semua systemnya sama persis dengan Visual Studio Code asli
- ATURAN WAJIB : fitur, menu, icon, fungsi, struktur folder, ukuran, animasi, shortcut, setting tetap 100% sama persis dengan Visual Studio Code asli. Yang berbeda HANYA warna default tema : background hitam + semua garis ungu gelap

## tempat asset icon buat di sini : C:\Users\Dardcor\Documents\Code Editor\Dardcor-Code-New\assets

## tempat logo aplikasi Dardcor Code : C:\Users\Dardcor\Documents\Code Editor\Dardcor-Code\public\dardcor-code.ico dan C:\Users\Dardcor\Documents\Code Editor\Dardcor-Code\public\dardcor-code.png

## ATURAN WAJIB UNTUK DESAIN TAMPILAN & TEMA DARDCOR CODE AGAR BERBEDA WARNA UNTUK GARIS UNGU GELAP, DAN BACKGROUND HITAM

Desain warna default Dardcor Code :
- Warna background (latar) seluruh aplikasi : hitam pekat #000000
- Semua garis di aplikasi berwarna ungu gelap : garis pembatas antar panel/sidebar/editor/panel bawah, garis pemisah di menu, garis tepi (border) tombol dan input box, garis fokus (focus border), garis selection, garis ruler editor, garis indent guide, garis scrollbar, garis pemisah antar tab, garis bawah titlebar/statusbar, garis outline, garis bracket, garis pemisah di quick pick dan dropdown, garis tepi dialog dan notification
- Palet ungu gelap yang dipakai (semua turunan ungu tua) : #6A1B9A (ungu gelap utama untuk garis), #6A1B9A (ungu paling gelap untuk garis halus/pemisah tipis), #6A1B9A (ungu gelap terang untuk garis aktif/hover), #7C4DFF (ungu terang HANYA untuk garis focus aktif saat keyboard focus agar terlihat jelas)
- hanya warna scroll yang abu-abu untuk digunakan

## DAFTAR TUGAS BARU DARDCOR CODE:
1. [x] Perbaikan Notifikasi Error Terminal (terminalInstance.ts): Menghilangkan popup notifikasi error saat proses internal/feature terminal berjalan di latar belakang (hideFromUser/isFeatureTerminal).
2. [x] Dukungan Shell Windows PowerShell (chatAgents.ts): Menjalankan perintah terminal di Windows menggunakan powershell.exe (-NoProfile -ExecutionPolicy Bypass -Command) agar cmdlet seperti Remove-Item dan binary CLI dieksekusi tanpa error cmd.exe exit code 1.
3. [x] Implementasi Tool Terminal Lengkap (chatAgents.ts):
   - run_in_terminal / run_command: Eksekusi terminal interaktif/background dengan format terminal card UI.
   - send_to_terminal: Pengiriman perintah/teks langsung ke terminal aktif.
   - get_terminal_output: Pembacaan buffer output terminal aktif (xterm buffer).
   - kill_terminal: Penghentian proses terminal aktif atau instance tertentu.
4. [x] Integrasi Konfirmasi Interaktif Terminal ("Allow | Skip") (chatTerminalToolConfirmationSubPart.ts & confirmationTool.ts):
   - Menampilkan card konfirmasi "Allow | Skip" sebelum perintah terminal dieksekusi secara otomatis saat model meminta konfirmasi.
   - Menampilkan opsi Auto-Approve rule per sesi, per workspace, atau per user.
5. [x] Tool Inspeksi Terminal Tambahan:
   - terminal_selection: Tool untuk membaca teks yang sedang diseleksi user di terminal aktif sebagai konteks prompt.
   - terminal_last_command: Tool untuk mengambil perintah dan output command terakhir yang dijalankan di terminal.
6. [x] Tool Task Runner (Task Management):
   - create_and_run_task: Membuat task runner sementara (build, test, watch) dan mengeksekusinya.
   - get_task_output: Memantau output dari task runner yang sedang berjalan.
   - run_task: Menjalankan task yang telah dikonfigurasi di tasks.json.
7. [x] Built-in Agent Tools Lanjutan (Sesuai VS Code Asli):
   - askQuestions (AskQuestionsTool): Tampilan modal / card pertanyaan interaktif (single select, multi select, teks bebas) agar AI dapat meminta klarifikasi ke user di tengah proses.
   - reviewPlan (ReviewPlanTool): Tampilan review rencana implementasi interaktif yang dapat disetujui atau dikoreksi user.
   - runSubagent (RunSubagentTool): Dukungan orkestrasi subagent otonom bercabang untuk tugas modular berskala besar.
   - setArtifacts & setArtifactRules (SetArtifactsTool): Penyimpanan dan manajemen artefak interaktif serta rules editor.
8. [x] Terminal Sandbox & Security Engine:
   - Integrasi terminalSandboxMxcRuntime / Sandbox isolasi proses terminal.
   - Analisa risiko perintah (chatToolRiskAssessmentService) untuk memberikan badge High/Medium/Low Risk pada perintah berbahaya (rm -rf, format disk, dsb.).
   - Network domain filtering (izinkan/blokir akses jaringan luar saat terminal berjalan).
9. [x] Terminal Output Compaction & Rewriter:
   - consoleCompactor: Peringkasan output terminal yang sangat panjang agar hemat token LLM tanpa kehilangan log error penting.
   - commandLineAutoApproveAnalyzer: Otomatis mengizinkan perintah aman (seperti git status, dir, ls, pwd, cat) tanpa memunculkan prompt konfirmasi berulang.
   - commandLineRewriter: Penyesuaian otomatis prefix cd, operator chain && pada PowerShell, dan background detaching rewriter.

## DAFTAR TUGAS TAHAP 2 (FITUR, UI & FUNGSI DARI VISUAL STUDIO CODE ASLI UNTUK DARDCOR CODE):
10. [x] Modern UI & Layout Density Engine (workbench/contrib/modernUI):
    - modernUI.contribution.ts: Registrasi pengaturan layout density (Default vs Compact) di Global Activity menu dan switcher cepat.
    - Metrik dimensi Modern UI: Scrollbar ramping 8px, pane header tinggi 28px dengan ikon modern, baris notifikasi ringkas.
    - Suite CSS Modern UI lengkap: activityBar.css, commandCenter.css, editorBorder.css, fontRamp.css, keyboardFocusOnly.css, notificationsDialogs.css, padding.css, paneHeaders.css, roundedCorners.css, sashHandles.css, shadows.css, statusBar.css, tabs.css, titlebar.css.
    - Penyesuaian tema warna khas Dardcor: background hitam pekat #000000, seluruh border #6A1B9A, focus #7C4DFF, scrollbar abu-abu.
11. [x] Suite Model Picker Lengkap & Badges (chat/browser/widget/input/modelPicker):
    - modelPickerCard.ts: Detail kartu interaktif per-model yang menampilkan deskripsi, batas context window, metrik token, level reasoning effort, dan opsi pin/unpin model favorit.
    - modelPickerBadges.ts: Badge visual cerdas pada setiap baris model (Fast, Reasoning, Vision, Promo, Local Router, Retiring).
    - modelPickerTabbedWidget.ts & modelPickerTabs.ts: Tab navigasi kategori model (Semua Model, Penalaran/Reasoning, Cepat/Fast, Multimodal/Vision, Local Router).
    - modelPickerAutoRow.ts: Pilihan cerdas "Auto" model dengan seleksi otomatis berbasis tipe prompt.
    - modelPickerVariants.ts: Pemilih varian kecepatan model dan intensitas penalaran (Thinking Effort: Low, Medium, High).
    - modelPickerDetails.ts, modelPickerLineage.ts, modelPickerModelConfig.ts, modelPickerWelcome.ts: Tokenizer info, silsilah keluarga model, dan onboarding picker.
    - Bebas Login Total: Semua model otomatis ditarik dari Dardcor Router (http://127.0.0.1:25128) tanpa popup akun Microsoft/GitHub.
12. [x] Chat Find & In-Chat Search Bar (chat/browser/widget/chatFind):
    - chatFindWidget.ts & chatFindWidget.css: Widget pencarian terpadu di dalam panel Chat/Agent Session (shortcut Ctrl+F / Cmd+F).
    - chatFindModel.ts: Algoritma pencarian dan pengindeksan pesan pengguna, jawaban AI, blok kode, dan tool cards.
    - chatFindHighlights.ts: Penyorotan (highlighting) teks hasil pencarian secara real-time di antarmuka DOM chat.
    - chatFindContent.ts, chatFindCommandIds.ts, chatFindAccessibilityHelp.ts: Ekstraktor konten chat dan navigasi keyboard F3/Shift+F3.
13. [x] Chat Input Context Pills & Resource Indicators (workbench/browser/chatPills & chatInputPills):
    - chatPills.ts & chatPills.css: Kontainer dan sistem perenderan pil konteks interaktif di atas input teks chat.
    - chatChangesPill.ts: Pil perubahan berkas dengan animasi counter langsung (<icon> N Files +insertions -deletions) saat agen mengedit berkas.
    - chatDropdownPill.ts: Pil dropdown untuk pergantian cepat mode agen atau koleksi tools.
    - chatResourcePill.ts: Pil berkas dan simbol terlampir dengan ikon tema berkas VS Code asli.
    - chatInputPills.ts, sessionChatPillOptions.ts, sessionPullRequestPill.ts: Integrasi baris pil ke input composer chat.
14. [x] Inline Chat Diff Review Session (inlineChatEditReviewSession.ts & inlineChatSessionResolver.ts):
    - inlineChatEditReviewSession.ts: Sesi review interaktif langsung di editor saat AI menulis perubahan ke berkas disk, dengan tampilan diff inline, tombol Accept, Discard, Accept Next Change, serta lock read-only selama agen berjalan.
    - inlineChatSessionResolver.ts: Menghubungkan editor teks aktif dan diff editor ke sesi kerja agen AI.
15. [x] Visualisasi Thinking & Reasoning AI Models (chatThinkingStyleContentPart.ts):
    - chatThinkingStyleContentPart.ts: Komponen akordion "Thinking..." yang collapsible untuk model penalaran (Claude 3.7 Thinking, o1, o3, Gemini 2.0 Flash Thinking, DeepSeek R1).
    - Status dot dinamis, animasi judul berkilau (shimmering) saat berpikir, durasi waktu komputasi, dan toggle ekspansi detail pemikiran.
    - Border ungu gelap #6A1B9A dan latar belakang hitam #000000.
16. [x] Rich Links & Request Origin Visualization (chatRichLink.ts & chatRequestOriginPart.ts):
    - chatRichLink.ts & chatRichLink.css: Kartu preview interaktif untuk tautan berkas, tautan web, simbol kode, dan diagnostik.
    - chatRequestOriginPart.ts & chatRequestOrigin.css: Tag penanda sumber instruksi chat (Terminal error, Seleksi editor, Quick question, Subagent, Background task).
17. [x] Dynamic Chat Input Notices, Stack & Tip Presenter (chat/browser/widget/input/):
    - chatInputNoticeHost.ts, chatInputNoticeHub.ts, chatInputNoticeWidget.ts, chatInputNotice.css: Notifikasi kontekstual di dalam area input chat (kuota konteks, peringatan berkas besar).
    - chatInputStack.ts & chatInputStack.css: Antrian pesan bertumpuk saat pengguna mengetik instruksi baru saat AI sedang merespons.
    - chatInputTipPresenter.ts: Tips dinamis untuk slash commands (@workspace, #file, /fix).
    - chatSessionArchiveNudge.ts & chatSessionArchiveNudge.css: Nudge memulai sesi baru saat konteks penuh.
    - chatInputPickerResponsiveLayout.ts: Penataan responsif otomatis picker saat lebar sidebar menyempit.
18. [x] Editor Multi-Diff & Live Response File Changes Service (editorChatResponseFileChangesService.ts & multiDiffEditor):
    - editorChatResponseFileChangesService.ts: Layanan sinkronisasi perubahan berkas secara langsung saat agen AI melakukan streaming edit.
    - compressedVirtualizedScrollLayout.ts & compressedVirtualizedScrollView.ts: Virtualisasi scroll performa tinggi untuk multi-diff editor.
    - virtualizedItemManager.ts & multiDiffEditorLayoutDebug.ts: Manajemen pool DOM dan diagnostik layout multi-diff.
19. [x] Terminal Agent Session Resolver & Link Contributions (workbench/contrib/terminalContrib):
    - terminalChatSessionResolver.ts: Integrasi pemilihan teks dan buffer terminal langsung ke sesi chat agen dengan metadata shell & OS.
    - terminalOutput.ts: Parser output terminal terstruktur untuk agen AI.
    - terminalLinkContribution.ts: Deteksi tautan klik berkas, URL, baris/kolom kode, dan commit hash di buffer terminal.
20. [x] Chat Background Renderer & Ambient Styling (sessions/services/chatBackground):
    - chatBackgroundRenderer.ts, chatBackgroundService.ts, chatBackground.css: Efek background ambient elegan dengan palet warna hitam #000000 dan ungu gelap #6A1B9A khas Dardcor Code.
21. [x] Sessions Conversation Groups, Workspace Management & Sync Changes (sessions/):
    - chatGroupsView.ts, chatGroupView.ts, chatGroupDropTarget.ts: Tampilan multi-grup percakapan chat dengan tata letak split grid, drag-and-drop antar tab chat, dan persistensi sesi.
    - sessionWorkspace.ts, sessionAgentMerge.ts, sessionConversationGroups.ts: Manajemen sesi antar-workspace dan merge branch subagent.
    - sessionSyncChanges.ts & sessionChangesService.ts: Pelacakan perubahan berkas yang dibuat agen sebelum di-commit.
    - newSessionPromptOptions.ts & newSessionConfigToolbars.ts: Template instruksi cepat satu-klik pada composer sesi baru.
    - checkboxChip.ts & checkboxChip.css: Chip checkbox interaktif pada konfigurasi sesi.
22. [x] Chat Pet Companion & Achievement System (chatPet... & chatPetAchievements...):
    - chatPetWidgetService.ts, chatPetAccessoryRenderer.ts, chatPetAccessoryRig.ts: Maskot animasi interaktif di header/status chat.
    - chatPetAchievements.ts, chatPetAchievementsWidget.ts, chatPetAchievementsEditor.ts, chatPetAchievements.contribution.ts: Sistem pencapaian milestone coding dan aksesoris kostumisasi.
23. [x] Zero-Login Architecture Enforcement (Dardcor Router Exclusive Mode):
    - Memastikan seluruh modul chat, model picker, sessions, dan agent host 100% bebas dari prompt login, sign-in dialog, Microsoft account, atau GitHub Copilot auth flow.
    - Seluruh AI requests otomatis terhubung ke http://127.0.0.1:25128 (Dardcor Router) tanpa login sama sekali.
24. [x] Agent Host Automation Engine & Channels Pipeline (platform/agentHost/):
    - channels-automation/ dan channels-automation-run/: Pipeline eksekusi otomatisasi tugas agen AI otonom di latar belakang.
    - agentHostAutomationService.ts & automationMigration.ts: Layanan orkestrasi skrip otomatisasi, event dispatcher, dan migrasi state otomatisasi.
25. [x] Agent Worktree & Multi-Root Git Merge Operations (platform/agentHost/node/):
    - agentMerge.ts & agentMergePrompt.ts: Logika resolusi merge branch otonom untuk agen AI saat menyelesaikan fitur.
    - agentHostMergeOperationHandler.ts & agentHostCheckoutOperationHandler.ts: Handler operasional checkout dan merge git tanpa mengganggu workspace utama user.
    - worktreePaths.ts & agentHostMultiRootDiff.ts: Pengelolaan jalur git worktree terisolasi dan perbandingan diff multi-root workspace.
26. [x] In-Editor Browser View & Agent Web Automation Tools (workbench/contrib/browserView/):
    - browserWelcome.ts, browserWelcome.css, browserViewModel.ts, browserEditorInput.ts: Tab peramban web interaktif di dalam editor.
    - navigateBrowserTool.ts, openBrowserTool.ts, browserToolHelpers.ts: Tools agen bawaan untuk membuka URL, navigasi DOM, dan ekstraksi konten halaman web.
27. [x] Chat Card & Content Parts Styling Suite (workbench/contrib/chat/browser/widget/):
    - media/chatCard.css: Styling kartu pesan chat dengan transisi halus, bayangan minimalis, dan border ungu gelap #6A1B9A.
    - chatAgentMergeContentPart.ts & media/chatAgentMergeContent.css: Komponen visual kartu konfirmasi dan review merge hasil kerja agen.
    - media/chatSystemNotificationContentPart.css: Notifikasi sistem ringkas di dalam alur pesan chat.
28. [x] Global Composite Bar & Modern Action Buttonbar Styling:
    - workbench/browser/parts/media/globalCompositeBar.css: Tampilan modern bar komposit global untuk switcher sidebar.
    - platform/actions/browser/buttonbar.css: Tata letak tombol aksi terpadu dengan transisi hover responsif.
29. [x] Agent Host Prompt Cache & Persistent Database Engine (platform/agentHost/node/):
    - agentHostPromptCache.ts: Sistem caching prompt interaktif untuk meminimalkan latensi dan pengulangan token ke Dardcor Router.
    - agentHostDatabase.ts & agentHostClientConnectionService.ts: Manajemen database lokal sesi kerja agen tanpa ketergantungan cloud.
30. [x] Remote & Tunnel Agent Host Connector (platform/agentHost/node/):
    - tunnelAgentHostConnector.ts, tunnelGatewaySelection.ts, webSocketOverDuplex.ts: Konektor tunnel agent host berbasis WebSocket/duplex stream untuk menjalankan agen di server remote atau container lokal tanpa akun cloud.
31. [x] Chat Model Feedback & Survey System Bebas Akun (workbench/contrib/chat/browser/feedbackSurvey/):
    - chatModelFeedbackSurvey.ts & media/chatModelFeedbackSurvey.css: Komponen rating jempol dan survei kepuasan model yang tersimpan di penyimpanan lokal tanpa mengirim data keluar atau meminta login.
32. [x] Local Git Pull Request & SCM External Session UI (sessions/contrib/):
    - sessions/contrib/github/browser/media/pullRequestPicker.css: Pemilih pull request dan branch git lokal yang diadaptasi murni untuk git lokal tanpa otentikasi akun GitHub.
    - sessions/contrib/chat/browser/media/externalSessionBanner.css: Banner sesi kerja eksternal untuk sesi yang dimulai dari terminal atau CLI luar.
33. [x] AI Image Generation Tool & Subpart Renderer (workbench/contrib/chat/browser/widget/chatContentParts/toolInvocationParts/):
    - chatGeneratedImageResultSubPart.ts: Render hasil pembuatan gambar AI (generate_image) langsung di dalam chat card dengan tombol pratinjau resolusi tinggi, salin gambar ke clipboard, simpan berkas, dan kontrol rasio aspek (1:1, 16:9, 9:16).
34. [x] Voice-to-Code & Live Speech-to-Text Transcription Engine (workbench/contrib/chat/browser/speechToText/ & voiceClient/):
    - voiceCodeTranscriptionClient.ts, voiceEndpoint.ts, voiceCloseCodes.ts: Klien transkripsi suara langsung ke teks di composer chat menggunakan WebSocket audio stream lokal tanpa dependensi cloud luar atau login akun.
35. [x] In-Editor Reference Decorations & Token Pills (workbench/contrib/chat/browser/widget/input/editor/):
    - chatInputReferenceDecorations.ts: Dekorasi visual interaktif di editor teks dan input chat saat simbol referensi konteks (#file, #selection, #codebase, @agent) diketik, lengkap dengan pill styling ungu gelap #6A1B9A dan quick definition peek.
36. [x] Rich Clipboard Paste Target & Transcript Context Attachment (workbench/contrib/chat/browser/attachments/):
    - chatPasteTargetService.ts & chatWidgetPasteTarget.ts: Layanan penanganan clipboard cerdas untuk paste multi-file, gambar tangkapan layar, potongan diff, dan seleksi terminal langsung menjadi lampiran pil di input composer.
    - transcriptContextAttachmentWidget.contribution.ts: Widget pelampiran riwayat transkrip sesi percakapan agen untuk konteks berantai.
37. [x] AI Customizations Catalog & Migration Engine (workbench/contrib/chat/browser/aiCustomization/):
    - aiCustomizationPresentation.ts, customizationCardList.ts, customizationMigrationCategories.ts, customizationMigrationAvailabilityService.ts, customizationMigrationServiceImpl.ts, mcpServerCustomizationMigration.ts: Antarmuka katalog kartu visual untuk mengelola Skills, Rules, Agents kustom, dan Server MCP dengan migrasi format konfigurasi otomatis.
38. [x] Auto-Mode Explainability Badge & Decision Breakdown (workbench/contrib/chat/common/):
    - chatAutoModeExplainability.ts: Komponen visual header chat yang menjelaskan alasan sistem memilih model AI tertentu, subagent tertentu, atau tool spesifik saat user berada di mode Auto.
39. [x] Single-Pane Adaptive Layout Engine (sessions/contrib/layout/browser/singlePane/):
    - singlePaneDetailPanelCoordinator.ts, singlePaneDockedTabsCoordinator.ts, singlePaneExistingSessionStrategy.ts, singlePaneNewSessionStrategy.ts, singlePaneQuickChatStrategy.ts, singlePaneSharedHelpers.ts, singlePaneVisibilityProfileStore.ts: Mesin penataan tata letak responsif untuk panel chat tunggal, tab docking dinamis, floating quick chat, dan profil visibilitas otomatis saat sidebar diubah ukurannya.
40. [x] Multi-Host Sandbox & Container Agent Providers (sessions/contrib/providers/remoteAgentHost/):
    - cloudSandboxSessionsProvider.ts, devContainerAgentHostService.ts, sshAgentHost.contribution.ts, webSocketAgentHost.contribution.ts, tunnelAgentHostStorage.ts, devContainerAgentHostConnector.contribution.ts: Penyedia eksekusi agen terisolasi di dalam Docker Dev Container, SSH host remote, atau WebSocket sandbox lokal tanpa akun cloud.
41. [x] Autonomous Scheduled Automations & Cron Engine (sessions/contrib/automations/ & platform/agentHost/node/):
    - automationInputCompletions.ts, automationModelConfiguration.ts, providerAutomationService.ts, automationCron.ts, reconnectableAgentHostAutomationStore.ts, automationsConstants.ts, automationsNewBadge.ts: Mesin eksekusi tugas coding otomatis terjadwal (cron-based automated tests, daily lint checks, repo maintenance) dengan penyimpanan background task persisten dan badge notifikasi.
42. [x] Agent Git Merge Autonomous Resolution Tools (platform/agentHost/node/ & platform/agentHost/common/):
    - agentMergeTools.ts, agentMergeController.ts, agentMergeServerTools.ts, agentMergeToolRestrictions.ts, agentMerge.ts, agentMergePrompt.ts: Rangkaian tool dan controller otonom bagi agen untuk melakukan checkout branch sementara, auto-merge branch kerja ke branch utama, kalkulasi konflik git, dan verifikasi batas keamanan merge.
43. [x] Agent Artifacts Interactive Management Suite (platform/agentHost/node/shared/ & sessions/contrib/chat/browser/):
    - artifactServerTools.ts, artifactToolsContribution.ts, sessionArtifacts.ts: Layanan server dan UI untuk pembuatan artefak interaktif (dokumen rencana, diff, laporan, diagram), manipulasi chunk artefak secara real-time, dan pratinjau di panel samping.
44. [x] Model Context Protocol (MCP) Server Discovery & Working Directory Engine (platform/agentHost/node/shared/ & workbench/contrib/chat/browser/agentSessions/agentHost/):
    - sessionMcpDiscovery.ts, mcpServerWorkingDirectory.ts, agentHostMcpServerSupport.ts, agentHostMcpServerSupportScope.ts: Deteksi otomatis server MCP lokal di direktori kerja proyek, registrasi tool dinamis, dan penyediaan konteks MCP untuk agen.
45. [x] Multi-Agent Turn Delegation & Worktree Announcements (platform/agentHost/node/chatContributions/ & platform/agentHost/common/state/):
    - turnDelegationContribution.ts, worktreeAnnouncementContribution.ts, legacyProtocolCompatibility.ts, channels-automation protocol reducers: Protokol orkestrasi serah-terima giliran tugas antar subagent spesialis dan pengumuman pembuatan/pemindahan git worktree terisolasi.
46. [x] Chat Session Empty States, Illustrations & Connection Error UI (sessions/browser/parts/):
    - sessionsEmptyState.ts, remoteHostUnavailableEmptyState.ts, media/sessionsEmptyState.css, media/remoteHostUnavailableEmptyState.css: Tampilan visual ilustrasi ambient minimalis saat belum ada sesi chat aktif atau saat koneksi ke router lokal terputus.
47. [x] Typing Character Tracker & OS Application Badges (sessions/contrib/sessions/):
    - sessionsTypedCharactersTracker.ts, sessionsWindowNotifier.ts, sessionsApplicationBadge.ts: Pelacak kecepatan dan volume ketikan interaksi coding, notifikasi OS saat agen menyelesaikan tugas latar belakang, dan badge angka pada taskbar / dock.
48. [x] Codebase Checkpoint & Changeset Telemetry Engine (platform/agentHost/node/chatContributions/checkpointAndChangeset/):
    - checkpointAndChangesetContribution.ts: Mesin pembuat snapshot checkpoint kode otomatis sebelum modifikasi besar dilakukan oleh AI, memungkinkan rollback aman satu-klik per turn percakapan.
49. [x] In-Editor Browser Tabs & DOM Web Automation Engine (workbench/contrib/browserView/):
    - browserViewModel.ts, browserEditorInput.ts, browserWelcome.ts, browserWelcome.css, openBrowserTool.ts, navigateBrowserTool.ts, browserToolHelpers.ts: Tab peramban web interaktif di dalam editor code dengan tool navigasi DOM, pengujian halaman, dan otomasi web terpadu.
50. [x] Zero-Login Full Offline Mode & Local Router Interceptor (platform/agentHost/common/ & platform/agentHost/node/):
    - Memblokir 100% semua upaya sign-in, login prompt Microsoft / GitHub / Copilot token, dan mengarahkan seluruh AI endpoints secara eksklusif ke Dardcor Router (http://127.0.0.1:25128) dalam mode offline / lokal murni.