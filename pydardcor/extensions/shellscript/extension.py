import json, os

def activate(api):
    api.register_command("shellscript.hello", "shellscript extension active", lambda: api.show_info("shellscript extension loaded"))

def deactivate():
    pass