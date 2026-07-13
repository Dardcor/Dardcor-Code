import json, os

def activate(api):
    api.register_command("fsharp.hello", "fsharp extension active", lambda: api.show_info("fsharp extension loaded"))

def deactivate():
    pass