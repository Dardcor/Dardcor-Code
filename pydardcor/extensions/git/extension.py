import json, os, subprocess

def activate(api):
    api.register_command("git.hello", "Git active", lambda: api.show_info("Git loaded"))

def deactivate():
    pass