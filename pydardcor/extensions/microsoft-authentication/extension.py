import json, os, subprocess

def activate(api):
    api.register_command("microsoft-authentication.hello", "Microsoft Authentication active", lambda: api.show_info("Microsoft Authentication loaded"))

def deactivate():
    pass