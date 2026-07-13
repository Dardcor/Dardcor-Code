import json, os

def activate(api):
    api.register_command("csharp.hello", "csharp extension active", lambda: api.show_info("csharp extension loaded"))

def deactivate():
    pass