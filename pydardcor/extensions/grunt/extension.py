import json, os

def activate(api):
    api.register_command("grunt.hello", "grunt extension active", lambda: api.show_info("grunt extension loaded"))

def deactivate():
    pass