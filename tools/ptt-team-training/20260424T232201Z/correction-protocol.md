# PTT Team Correction Protocol

Use this file to retrain Bob, Dr Bob, and Human Test after each run.

## Rule

If any team member is wrong, log the mistake and the corrected approach before the next implementation pass.

## Correction Entries

### Entry Template

1. Agent: Bob | Dr Bob | Human Test
2. Wrong Output:
3. Root Cause:
4. Correct Method:
5. Repo Evidence:
6. Guardrail Added:
7. Verification Step:

### Checklist

1. Convert each blocker into a concrete code or config task.
2. Add a test or diagnostic that would catch the same mistake next time.
3. Update architecture docs if a pattern changed.
4. Re-run Dr Bob and Human Test after fixes.
