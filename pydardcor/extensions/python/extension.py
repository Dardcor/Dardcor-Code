import json, os

def activate(api):
    api.register_command("python.hello", "python extension active", lambda: api.show_info("python extension loaded"))

def deactivate():
    pass