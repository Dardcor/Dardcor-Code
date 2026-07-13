import json, os

def activate(api):
    api.register_command("shaderlab.hello", "shaderlab extension active", lambda: api.show_info("shaderlab extension loaded"))

def deactivate():
    pass