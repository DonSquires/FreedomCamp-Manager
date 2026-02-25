# How to Run the Bash Scripts

> **No experience needed.** Follow this guide step-by-step. Every command is copy-paste ready.

---

## What is "Bash" / a "Terminal"?

A **terminal** (also called a shell, command line, or console) is a text-based window where you type commands to run programs.  
**Bash** is the language those commands are written in — it's the default on Mac and Linux, and available on Windows too.

You don't need to understand the scripts. You just need to:
1. Open a terminal.
2. Navigate to the project folder.
3. Paste the commands below.

---

## Step 1 — Open a Terminal

### 🍎 Mac

1. Press **Command (⌘) + Space** to open Spotlight.  
2. Type `Terminal` and press **Enter**.  
3. A black (or white) window opens — that's your terminal.

> **Tip:** You can also find it at *Applications → Utilities → Terminal*.

---

### 🪟 Windows

You need **Git Bash** (free, installs in 2 minutes):

1. Download from: https://git-scm.com/download/win  
2. Run the installer — click **Next** through all screens.
3. After install, right-click on your Desktop → **Git Bash Here**.  
4. A terminal window opens.

> **Alternative:** If you have Windows 11 you can use **WSL** (Windows Subsystem for Linux), but Git Bash is easier to start with.

---

### 🐧 Linux

Press **Ctrl + Alt + T** — that opens a terminal on most Linux desktops.

---

## Step 2 — Navigate to the Project Folder

Once your terminal is open, you need to move into the FreedomCamp-Manager project.

Find where GitHub cloned (or where you unzipped) the project on your computer.  
It will be a folder named `FreedomCamp-Manager`.

```bash
# Replace the path below with where YOUR folder actually is.

# Common Mac location:
cd ~/Documents/FreedomCamp-Manager

# Common Windows (Git Bash) location:
cd /c/Users/YourName/Documents/FreedomCamp-Manager

# If you cloned it to Desktop:
cd ~/Desktop/FreedomCamp-Manager
```

> **How to find the path on Mac:** Open Finder, navigate to the folder, then drag the folder icon onto the terminal window — the path will appear automatically.

> **How to find the path on Windows:** Open File Explorer, navigate to the folder, click the address bar at the top — copy that path, then replace backslashes `\` with forward slashes `/` when typing in Git Bash.

Confirm you're in the right place by typing:

```bash
ls
```

You should see files like `package.json`, `src/`, `supabase/`, `tools/` etc.

---

## Step 3 — Make Scripts Executable (one-time only)

Before running a script for the first time you need to give it permission to execute.  
Run these three commands once:

```bash
chmod +x tools/schema-extract/run_extract.sh
chmod +x tools/onspace-analysis/run_lexical_search.sh
chmod +x inference-service/test-local.sh
```

> **chmod +x** means "make this file executable". You only need to do this once.

---

## Step 4 — Run the Scripts

### 📦 Script 1: Extract Database Schema

This pulls the database structure out of Supabase and saves it to files so you can review it.

```bash
# Set your database connection details (get these from Supabase → Settings → Database)
export PGHOST=db.xxxx.supabase.co        # replace with your Supabase host
export PGPORT=5432
export PGUSER=postgres                   # or your read-only user if you have one
export PGPASSWORD='your-db-password'     # from Supabase Settings → Database
export PGDATABASE=postgres

# Run the script
./tools/schema-extract/run_extract.sh
```

Results are saved to: `tools/schema-extract/output/`

---

### 🔍 Script 2: Search the Onspace Codebase

This searches through code to find specific function names, table names, and other symbols.

```bash
# Point to where the Onspace code is on your computer
export ONSPACE_DIR=/path/to/onspace-code

# Run the search
./tools/onspace-analysis/run_lexical_search.sh
```

Results are saved to: `tools/onspace-analysis/output/lexical_results.txt`

---

### 🧪 Script 3: Test the Inference Service Locally

This tests whether the AI vehicle-recognition service is running correctly.

```bash
# Make sure the inference service is running first (in a separate terminal):
cd inference-service
npm install      # first time only
npm start        # keep this terminal open

# Then in a NEW terminal, run the test:
cd /path/to/FreedomCamp-Manager
./inference-service/test-local.sh
```

---

## Common Errors and Fixes

### ❌ `Permission denied`

```
bash: ./tools/schema-extract/run_extract.sh: Permission denied
```

**Fix:** Run `chmod +x` on the script (see Step 3 above).

---

### ❌ `No such file or directory`

```
bash: cd: FreedomCamp-Manager: No such file or directory
```

**Fix:** You're not in the right folder. Double-check your path in Step 2. Use `ls` to list what's in your current folder.

---

### ❌ `command not found: psql`

```
[ERROR] psql: command not found
```

**Fix:** You need to install the PostgreSQL client tools.

- **Mac:** `brew install postgresql` (requires Homebrew — install from https://brew.sh)  
- **Windows (Git Bash):** Download from https://www.postgresql.org/download/windows/ and install "Command Line Tools"  
- **Linux:** `sudo apt install postgresql-client`

---

### ❌ `export: not valid in this context` (Windows Command Prompt)

**Fix:** You're using the wrong terminal. Use **Git Bash**, not Windows Command Prompt or PowerShell. See Step 1 for how to open Git Bash.

---

### ❌ Script runs but shows `[ERROR] Required environment variable $PGPASSWORD is not set`

**Fix:** You forgot the `export` commands. Make sure you run all five `export` lines before running the script (they must be in the same terminal session).

---

## How to Find Your Supabase Database Details

1. Go to https://supabase.com and sign in.  
2. Click on your project (FreedomCamp-Manager).  
3. Go to **Settings** (gear icon) → **Database**.  
4. Scroll to **Connection Info** — copy the values for Host, Port, User, and Password.

---

## Need Help?

If you see an error not listed above:

1. Copy the **full error message** from your terminal.  
2. Share it in the project chat or GitHub issue.  
3. Include what command you ran and what operating system you're on.

---

**That's it!** You don't need to understand what the scripts do internally — just follow the steps above and the scripts handle everything else.
