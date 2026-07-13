import json, os

def activate(api):
    api.register_command("gulp.hello", "gulp extension active", lambda: api.show_info("gulp extension loaded"))

def deactivate():
    pass