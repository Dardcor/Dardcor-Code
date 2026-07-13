import json, os

def activate(api):
    api.register_command("vb.hello", "vb extension active", lambda: api.show_info("vb extension loaded"))

def deactivate():
    pass