import os
import subprocess
import json
import time

REPO = "DonSquires/FreedomCamp-Manager"
PRS = [740, 739, 726]
TOKEN = os.environ.get("GH_API")
BASE_URL = f"https://api.github.com/repos/{REPO}"

def github_api(method, path, data=None, include_headers=False):
    cmd = [
        "curl", "-s", "-X", method,
        "-H", f"Authorization: Bearer {TOKEN}",
        "-H", "Accept: application/vnd.github+json",
        "-H", "X-GitHub-Api-Version: 2022-11-28",
    ]
    if include_headers:
        cmd += ["-i"]
    
    cmd.append(f"{BASE_URL}{path}")
    
    if data:
        cmd += ["-d", json.dumps(data)]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if include_headers:
        return result.stdout
    else:
        try:
            return json.loads(result.stdout)
        except:
            return {"error": "Failed to parse JSON", "output": result.stdout}

results = {}

for pr_num in PRS:
    print(f"Updating PR #{pr_num}...")
    # Use PUT and get headers to check status
    raw_resp = github_api("PUT", f"/pulls/{pr_num}/update-branch", include_headers=True)
    status_line = raw_resp.splitlines()[0] if raw_resp else "Unknown"
    print(f"PR #{pr_num} update status: {status_line}")
    
    # Wait for the update to reflect
    time.sleep(10)
    
    details = github_api("GET", f"/pulls/{pr_num}")
    head_sha = details.get('head', {}).get('sha')
    mergeable_state = details.get('mergeable_state')
    
    results[pr_num] = {
        "head_sha": head_sha,
        "mergeable_state": mergeable_state,
        "check_status": "Not Found",
        "check_conclusion": "N/A"
    }
    print(f"PR #{pr_num} head sha: {head_sha}, mergeable state: {mergeable_state}")

poll_start = time.time()
POLL_TIMEOUT = 480
while time.time() - poll_start < POLL_TIMEOUT:
    all_done = True
    print(f"\nPolling checks... (Elapsed: {int(time.time() - poll_start)}s)")
    for pr_num in PRS:
        sha = results[pr_num]["head_sha"]
        if not sha: 
            # Re-fetch PR details if SHA was missing
            details = github_api("GET", f"/pulls/{pr_num}")
            sha = details.get('head', {}).get('sha')
            results[pr_num]["head_sha"] = sha
            results[pr_num]["mergeable_state"] = details.get('mergeable_state')
            if not sha:
                print(f" PR #{pr_num}: Still no head SHA")
                all_done = False
                continue
        
        check_runs_resp = github_api("GET", f"/commits/{sha}/check-runs")
        target_check = None
        target_names = ["3) Mobile Expo Gate", "mobile-expo-gate"]
        
        runs = check_runs_resp.get('check_runs', [])
        for run in runs:
            for target in target_names:
                if target.lower() in run['name'].lower():
                    target_check = run
                    break
            if target_check: break
            
        if target_check:
            results[pr_num]["check_status"] = target_check["status"]
            results[pr_num]["check_conclusion"] = target_check.get("conclusion") or "N/A"
            print(f" PR #{pr_num}: {target_check['status']} ({target_check.get('conclusion')})")
            if target_check["status"] != "completed":
                all_done = False
        else:
            print(f" PR #{pr_num}: Check not found yet for {sha[:7]}")
            all_done = False
            
    if all_done:
        break
    time.sleep(45)

print("\n--- Summary ---")
for pr_num in PRS:
    res = results[pr_num]
    print(f"PR #{pr_num}:")
    print(f"  Head SHA: {res['head_sha']}")
    print(f"  Mergeable State: {res['mergeable_state']}")
    print(f"  Mobile Expo Gate: {res['check_status']} ({res['check_conclusion']})")
