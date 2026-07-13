import json, os

def activate(api):
    api.register_command("powershell.hello", "powershell extension active", lambda: api.show_info("powershell extension loaded"))

def deactivate():
    pass