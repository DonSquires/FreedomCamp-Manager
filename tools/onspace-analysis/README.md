# Onspace Code Analysis Tools

These tools help gather and prepare Onspace code artifacts so that lexical and
semantic searches can be run to answer questions about how Onspace interacts with
the FieldOps-Manager database schema (e.g. which edge functions reference
`observations_v2`, which workers call `vehicle_enrichment_jobs`, and so on).

---

## Providing the Onspace codebase

### Option A – Onspace is in a GitHub repository

1. Confirm you have read access to the Onspace repository.
2. Clone it locally alongside this repo:
   ```bash
   git clone https://github.com/<owner>/<repo> /path/to/onspace
   ```
3. Set the `ONSPACE_DIR` environment variable before running the search script:
   ```bash
   export ONSPACE_DIR=/path/to/onspace
   ./tools/onspace-analysis/run_lexical_search.sh
   ```
4. Results are written to `tools/onspace-analysis/output/lexical_results.txt`.

After this PR is merged and the analysis artifacts are available, a reviewer with
access to the Onspace repository can run semantic searches (e.g. with `ripgrep`,
`ast-grep`, or a language-server query) using the terms catalogued in this
directory.

### Option B – Onspace code is supplied as a ZIP

1. Unzip the archive to a local directory, e.g.:
   ```bash
   unzip onspace-code.zip -d /tmp/onspace
   ```
2. Point the script at it:
   ```bash
   export ONSPACE_DIR=/tmp/onspace
   ./tools/onspace-analysis/run_lexical_search.sh
   ```
3. Commit (or attach as a CI artifact) the output file for review.

---

## Scripts

| Script                  | Purpose                                         |
|-------------------------|-------------------------------------------------|
| `run_lexical_search.sh` | Runs `rg`/`grep` for known symbols and strings |

---

## Output

Results are written to `tools/onspace-analysis/output/lexical_results.txt`
(directory is git-ignored by default; remove or adjust the `.gitignore` entry
when you want to commit the results).

---

## Next steps after artifacts are available

Once the lexical search output is committed (or attached as a PR artifact):

1. Review `lexical_results.txt` to identify which files reference key symbols.
2. Open those files and map function signatures and environment variable usage.
3. Fill in `REPORT_TEMPLATE.md` with findings.
4. Use the completed report to plan schema migrations, API contract changes, or
   data-pipeline updates.
