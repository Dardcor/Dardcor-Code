import json, os

def activate(api):
    api.register_command("git-base.hello", "Git Base active", lambda: api.show_info("Git Base loaded"))

def deactivate():
    pass