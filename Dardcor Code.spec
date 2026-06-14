# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['dardcor.py'],
    pathex=[],
    binaries=[],
    datas=[('image', 'image'), ('pydardcor/assets', 'pydardcor/assets')],
    hiddenimports=['PySide6.QtWebEngineWidgets', 'PySide6.QtWebEngineCore', 'pydardcor.cli'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Dardcor Code',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['image\\dardcor.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Dardcor Code',
)
