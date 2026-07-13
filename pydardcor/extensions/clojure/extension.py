import json, os

def activate(api):
    api.register_command("clojure.hello", "clojure extension active", lambda: api.show_info("clojure extension loaded"))

def deactivate():
    pass