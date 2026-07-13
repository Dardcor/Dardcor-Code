import json, os

def activate(api):
    api.register_command("sql.hello", "sql extension active", lambda: api.show_info("sql extension loaded"))

def deactivate():
    pass