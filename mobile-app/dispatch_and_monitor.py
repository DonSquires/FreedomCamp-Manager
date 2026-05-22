import os
import time
import sys
import json
import urllib.request
import urllib.error

# Configuration
REPO = "DonSquires/FreedomCamp-Manager"
WORKFLOW_FILE = "deploy-mobile.yml"
BRANCH = "main"
TOKEN = os.environ.get("GH_API") or os.environ.get("GITHUB_TOKEN")

def make_request(url, method="GET", data=None):
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Python-urllib"
    }
    req_data = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            if res.status == 204:
                return True, None
            return True, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return False, f"{e.code}: {e.read().decode('utf-8')}"
    except Exception as e:
        return False, str(e)

def dispatch_workflow():
    url = f"https://api.github.com/repos/{REPO}/actions/workflows/{WORKFLOW_FILE}/dispatches"
    data = {"ref": BRANCH, "inputs": {"mobile_platform": "android", "mobile_profile": "preview"}}
    success, result = make_request(url, method="POST", data=data)
    if success:
        print(f"Successfully dispatched {WORKFLOW_FILE} on {BRANCH}")
    else:
        print(f"Failed to dispatch workflow: {result}")
        sys.exit(1)

def get_latest_run_id():
    url = f"https://api.github.com/repos/{REPO}/actions/workflows/{WORKFLOW_FILE}/runs"
    success, result = make_request(url)
    if success:
        runs = result.get("workflow_runs", [])
        if runs:
            return runs[0]["id"]
    return None

def monitor_run(run_id):
    print(f"Monitoring Run ID: {run_id}")
    url = f"https://api.github.com/repos/{REPO}/actions/runs/{run_id}"
    start_time = time.time()
    while time.time() - start_time < 900: # 15 mins
        success, data = make_request(url)
        if not success:
            print(f"Error: {data}")
            time.sleep(10)
            continue
        status = data.get("status")
        conclusion = data.get("conclusion")
        print(f"Status: {status}, Conclusion: {conclusion}")
        if status == "completed":
            return data
        time.sleep(30)
    return None

def make_raw_request(url):
    headers = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github.v3+json", "User-Agent": "Python-urllib"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as res:
            return True, res.read().decode("utf-8")
    except Exception as e:
        return False, str(e)

if __name__ == "__main__":
    dispatch_workflow()
    print("Waiting for run to appear...")
    time.sleep(15)
    run_id = get_latest_run_id()
    if not run_id:
        print("Could not find the new run ID.")
        sys.exit(1)
    final_data = monitor_run(run_id)
    if final_data:
        print(f"Run {run_id} finished with conclusion: {final_data['conclusion']}")
        if final_data["conclusion"] == "failure":
            url = f"https://api.github.com/repos/{REPO}/actions/runs/{run_id}/jobs"
            s, res = make_request(url)
            if s:
                for job in res.get("jobs", []):
                    if job["conclusion"] == "failure":
                        print(f"Failing job: {job['name']}")
                        for step in job["steps"]:
                            if step["conclusion"] == "failure":
                                print(f"Failing step: {step['name']}")
                                l_s, logs = make_raw_request(f"https://api.github.com/repos/{REPO}/actions/jobs/{job['id']}/logs")
                                if l_s:
                                    lines = logs.splitlines()
                                    excerpt = "\n".join(lines[-20:])
                                    print("\n--- Log Excerpt ---\n" + excerpt + "\n-------------------\n")
