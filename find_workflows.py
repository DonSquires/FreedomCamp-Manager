import yaml
import os
import glob

def check_workflow(filepath):
    with open(filepath, 'r') as f:
        try:
            data = yaml.safe_load(f)
        except Exception:
            return None
    
    if not data or 'on' not in data:
        return None
    
    on = data['on']
    
    # Normalize 'on' field
    if isinstance(on, str):
        if on != 'pull_request':
            return None
        # on: pull_request (no branch filter means all branches, including main)
        trigger = {}
    elif isinstance(on, list):
        if 'pull_request' not in on:
            return None
        trigger = {}
    elif isinstance(on, dict):
        if 'pull_request' not in on:
            return None
        trigger = on['pull_request'] or {}
    else:
        return None

    # Check for main branch
    branches = trigger.get('branches', [])
    if isinstance(branches, str):
        branches = [branches]
    
    # If branches is empty, it triggers on all branches (including main)
    # If branches is specified, it must contain 'main'
    triggers_on_main = not branches or 'main' in branches or any(b.startswith('main') for b in branches) # Simplified

    if not triggers_on_main:
        return None
    
    # Check for paths/paths-ignore
    if 'paths' in trigger or 'paths-ignore' in trigger:
        return None
    
    name = data.get('name', filepath)
    jobs = list(data.get('jobs', {}).keys())
    
    return {
        'file': filepath,
        'name': name,
        'jobs': jobs
    }

workflows = glob.glob('.github/workflows/*.yml')
results = []
for wf in workflows:
    res = check_workflow(wf)
    if res:
        results.append(res)

for res in results:
    print(f"File: {res['file']}")
    print(f"Name: {res['name']}")
    print(f"Jobs: {', '.join(res['jobs'])}")
    print("-" * 20)
