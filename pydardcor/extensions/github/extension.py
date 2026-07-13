import json, os, subprocess

def activate(api):
    api.register_command("github.hello", "GitHub active", lambda: api.show_info("GitHub loaded"))

def deactivate():
    pass