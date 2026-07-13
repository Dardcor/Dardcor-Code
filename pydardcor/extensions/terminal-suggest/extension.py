import json, os, subprocess

def activate(api):
    api.register_command("terminal-suggest.hello", "Terminal Suggest active", lambda: api.show_info("Terminal Suggest loaded"))

def deactivate():
    pass