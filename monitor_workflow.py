import sys, json, time, os, subprocess

RUN_ID = "26150428700"
REPO = "DonSquires/FreedomCamp-Manager"
TOKEN = os.environ.get("GITHUB_TOKEN")

def get_run_status():
    cmd = f"curl -s -H 'Authorization: Bearer {TOKEN}' https://api.github.com/repos/{REPO}/actions/runs/{RUN_ID}"
    res = subprocess.check_output(cmd, shell=True)
    return json.loads(res)['status'], json.loads(res)['conclusion']

def get_jobs():
    cmd = f"curl -s -H 'Authorization: Bearer {TOKEN}' https://api.github.com/repos/{REPO}/actions/runs/{RUN_ID}/jobs"
    res = subprocess.check_output(cmd, shell=True)
    return json.loads(res)['jobs']

start_time = time.time()
while time.time() - start_time < 300:
    status, conclusion = get_run_status()
    print(f"Current status: {status} ({conclusion})")
    if status == "completed":
        break
    time.sleep(15)

jobs = get_jobs()
relevant_jobs = ["web-build-gate", "api-edge-gate", "inference-self-contained-gate", "mobile-expo-gate"]
results = {}

print(f"\nWorkflow Run ID: {RUN_ID}")
for job in jobs:
    name = job['name']
    # Check if any of our relevant job names are in the job['name']
    # GitHub job names might have prefixes or indices like "3) Mobile Expo Gate"
    for target in relevant_jobs:
        if target in name.lower().replace(" ", "-") or target.replace("-", " ") in name.lower():
            results[target] = f"{job['status']} ({job['conclusion']})"

for target in relevant_jobs:
    status = results.get(target, "Not Found")
    print(f"  - {target}: {status}")

if results.get("mobile-expo-gate") == "completed (success)":
    print("\nVictory! The fix worked.")
else:
    print("\nThe fix did not work or the job failed/was skipped.")
