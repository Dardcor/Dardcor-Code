import json, os

def activate(api):
    api.register_command("log.hello", "log extension active", lambda: api.show_info("log extension loaded"))

def deactivate():
    pass