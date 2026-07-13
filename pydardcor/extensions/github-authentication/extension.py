import json, os, subprocess

def activate(api):
    api.register_command("github-authentication.hello", "GitHub Authentication active", lambda: api.show_info("GitHub Authentication loaded"))

def deactivate():
    pass