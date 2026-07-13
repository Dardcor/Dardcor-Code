import json, os, subprocess

def activate(api):
    api.register_command("extension-editing.hello", "Extension Editing active", lambda: api.show_info("Extension Editing loaded"))

def deactivate():
    pass