import json, os

def activate(api):
    api.register_command("dart.hello", "dart extension active", lambda: api.show_info("dart extension loaded"))

def deactivate():
    pass