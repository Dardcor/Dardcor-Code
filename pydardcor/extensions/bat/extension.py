import json, os

def activate(api):
    api.register_command("bat.hello", "bat extension active", lambda: api.show_info("bat extension loaded"))

def deactivate():
    pass