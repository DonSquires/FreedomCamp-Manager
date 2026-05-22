const DANGEROUS_PATTERNS: RegExp[] = [
  /DROP\s+TABLE/i,
  /rm\s+-rf/i,
  /process\.exit/i,
  /DELETE\s+FROM/i,
  /TRUNCATE\s+TABLE/i,
  /exec\s*\(/i,
  /eval\s*\(/i,
  /child_process/i,
  /require\s*\(\s*['"]child_process['"]\s*\)/i,
  /fs\.unlink|fs\.rmdir|fs\.rm\b/i,
  /__import__\s*\(\s*['"]os['"]\s*\)/i,
];

export async function runInSandboxEmulator(
  patchValue: string,
  variableName: string
): Promise<boolean> {
  const combined = `${variableName}=${patchValue}`;

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(combined)) {
      console.warn(
        `[SandboxEmulator] BLOCKED — dangerous pattern "${pattern}" matched in variable "${variableName}"`
      );
      return false;
    }
  }

  return true;
}
