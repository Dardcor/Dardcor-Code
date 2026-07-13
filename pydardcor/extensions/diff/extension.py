import json, os

def activate(api):
    api.register_command("diff.hello", "diff extension active", lambda: api.show_info("diff extension loaded"))

def deactivate():
    pass