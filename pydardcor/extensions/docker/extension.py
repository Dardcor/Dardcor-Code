import json, os

def activate(api):
    api.register_command("docker.hello", "docker extension active", lambda: api.show_info("docker extension loaded"))

def deactivate():
    pass