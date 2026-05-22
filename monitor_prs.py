import os
import time
import json
import urllib.request
import urllib.error

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
REPO = "DonSquires/FreedomCamp-Manager"
PRS = [745, 736]

def github_api(endpoint, method="GET", data=None):
    url = f"https://api.github.com/repos/{REPO}/{endpoint}"
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"token {GITHUB_TOKEN}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    if data:
        req.data = json.dumps(data).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return json.loads(body)
        except:
            return {"message": body, "status": e.code}
    except Exception as e:
        return {"message": str(e), "status": 500}

def get_pr_details(pr_num):
    return github_api(f"pulls/{pr_num}")

def get_check_runs(ref):
    return github_api(f"commits/{ref}/check-runs")

def monitor():
    timeout = 15 * 60
    start_time = time.time()
    
    pr_info = {}
    for pr_num in PRS:
        pr = get_pr_details(pr_num)
        pr_info[pr_num] = {"head": pr["head"]["sha"], "settled": False}
    
    while time.time() - start_time < timeout:
        all_settled = True
        for pr_num in PRS:
            if pr_info[pr_num]["settled"]: continue
            
            pr = get_pr_details(pr_num)
            checks = get_check_runs(pr_info[pr_num]["head"])
            
            runs = checks.get("check_runs", [])
            in_progress = [r for r in runs if r["status"] != "completed"]
            
            if not in_progress and runs:
                pr_info[pr_num]["settled"] = True
            else:
                all_settled = False
                
        if all_settled: break
        time.sleep(30)

    for pr_num in PRS:
        pr = get_pr_details(pr_num)
        checks = get_check_runs(pr_info[pr_num]["head"])
        runs = checks.get("check_runs", [])
        
        failed_checks = [r["name"] for r in runs if r["conclusion"] not in ["success", "skipped", "neutral"]]
        
        print(f"PR #{pr_num}: State={pr['state']}, Mergeable={pr.get('mergeable_state')}, Draft={pr['draft']}")
        if failed_checks:
            print(f"  Failing checks: {', '.join(failed_checks)}")
        
        if pr["state"] == "open" and not pr["draft"] and not failed_checks and pr.get("mergeable_state") in ["clean", "unstable"]:
            print(f"  Attempting squash merge...")
            res = github_api(f"pulls/{pr_num}/merge", method="PUT", data={"merge_method": "squash"})
            if "merged" in res and res["merged"]:
                print(f"  Result: Merged successfully.")
            else:
                print(f"  Result: Merge blocked. Message: {res.get('message')}")
        else:
            reason = "Draft" if pr["draft"] else "Closed" if pr["state"] != "open" else "Checks failing" if failed_checks else f"Mergeable state: {pr.get('mergeable_state')}"
            print(f"  Result: Blocked. Reason: {reason}")

monitor()
