import os
import sys

# Get all files tracked by git that contain 'Microsoft Corporation'
import subprocess
try:
    result = subprocess.run(['git', 'grep', '-l', 'Microsoft Corporation'], stdout=subprocess.PIPE, text=True, check=True)
    files = result.stdout.splitlines()
except subprocess.CalledProcessError:
    print("No files found or error running git grep.")
    sys.exit(0)

count = 0
for file in files:
    try:
        with open(file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if 'Microsoft Corporation' in content:
            new_content = content.replace('Microsoft Corporation', 'Dardcor Corporation')
            with open(file, 'w', encoding='utf-8', newline='') as f:
                f.write(new_content)
            count += 1
    except Exception as e:
        print(f"Failed to process {file}: {e}")

print(f"Successfully updated {count} files.")
