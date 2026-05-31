import axios, { AxiosInstance } from 'axios';

const TODO_FILE_PATH = 'docs/PM_HANDOFF_TODO_2026-05-18.md';

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveRepoConfig() {
  const giteaBase = String(process.env.GITEA_URL ?? process.env.GITEA_BASE_URL ?? process.env.GITEA_API_URL ?? '').trim();
  const giteaToken = String(
    process.env.GITEA_ADMIN_TOKEN ?? process.env.GITEA_TOKEN ?? process.env.GITEA_API_TOKEN ?? process.env.GITEA_ACCESS_TOKEN ?? '',
  ).trim();
  const githubApiUrl = String(process.env.GITHUB_API_URL ?? '').trim();
  const githubServerUrl = String(process.env.GITHUB_SERVER_URL ?? '').trim();
  const githubToken = String(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.BOB_WORKER_GITHUB_TOKEN ?? '').trim();
  const usingGitea = Boolean(giteaBase && giteaToken);

  const baseUrl = usingGitea
    ? giteaBase
    : (githubApiUrl || (githubServerUrl ? (githubServerUrl.includes('github.com') ? 'https://api.github.com' : `${githubServerUrl.replace(/\/+$/, '')}/api/v3`) : ''));

  const token = usingGitea ? giteaToken : githubToken;

  const repoPair = String(process.env.GITEA_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? '').trim();
  const [pairOwner, pairRepo] = repoPair.includes('/') ? repoPair.split('/', 2) : ['', ''];
  const owner = String(process.env.GITEA_OWNER ?? pairOwner ?? '').trim();
  const repo = String(process.env.GITEA_REPO ?? pairRepo ?? '').trim();
  const baseBranch = String(process.env.GITEA_BASE_BRANCH ?? 'main').trim();

  if (!baseUrl) {
    throw new Error('Missing repository API base URL (GITEA_BASE_URL/GITEA_URL or GITHUB_API_URL).');
  }
  if (!token) {
    throw new Error('Missing repository API token (GITEA_TOKEN family or GITHUB_TOKEN).');
  }
  if (!owner || !repo) {
    throw new Error('Missing repository owner/repo (GITEA_OWNER/GITEA_REPO or GITHUB_REPOSITORY).');
  }

  return { baseUrl, token, owner, repo, baseBranch, usingGitea };
}

function getGiteaClient(): AxiosInstance {
  const { baseUrl, token, usingGitea } = resolveRepoConfig();
  return axios.create({
    baseURL: usingGitea && !baseUrl.endsWith('/api/v1') ? `${baseUrl.replace(/\/$/, '')}/api/v1` : baseUrl.replace(/\/$/, ''),
    headers: {
      Authorization: usingGitea ? `token ${token}` : `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 30000,
  });
}

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function fromBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8');
}

function updateTodoMarkdownContent(existing: string, taskName: string): string {
  const timestamp = new Date().toISOString();
  const safeTaskName = String(taskName ?? '').trim() || 'Autonomous PM task';
  const lines = existing.split('\n');
  const taskLower = safeTaskName.toLowerCase();

  const toExecutedLine = (line: string): string => {
    const normalized = line.replace('[ ]', '[x]').trimEnd();
    const withoutPriorStamp = normalized
      .replace(/\s*\(Executed:\s*[^)]*\)\s*$/i, '')
      .replace(/\s*\(Completed by Bob at\s*[^)]*\)\s*$/i, '');
    return `${withoutPriorStamp} (Executed: ${timestamp})`;
  };

  const targetIndex = lines.findIndex((line) => {
    return line.includes('[ ]') && line.toLowerCase().includes(taskLower);
  });

  if (targetIndex >= 0) {
    const original = lines[targetIndex];
    lines[targetIndex] = toExecutedLine(original);
    return lines.join('\n');
  }

  const sectionHeader = '## Autonomous PM Updates';
  const sectionIndex = lines.findIndex((line) => line.trim() === sectionHeader);
  const newEntry = `- [x] ${safeTaskName} (Executed: ${timestamp})`;

  if (sectionIndex >= 0) {
    lines.splice(sectionIndex + 1, 0, newEntry);
    return lines.join('\n');
  }

  const suffix = lines.length > 0 && lines[lines.length - 1].trim().length > 0 ? '\n\n' : '\n';
  return `${existing}${suffix}${sectionHeader}\n\n${newEntry}\n`;
}

export async function createGiteaIssue(title: string, body: string): Promise<number> {
  const { owner, repo } = resolveRepoConfig();
  const gitea = getGiteaClient();

  const issueTitle = String(title ?? '').trim() || 'Bob Self-Heal Issue';
  const issueBody = String(body ?? '').trim() || 'Automated issue created by Bob autonomous PM tracker.';

  const response = await gitea.post(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
    title: issueTitle,
    body: issueBody,
  });

  const number = Number(response.data?.number ?? response.data?.id ?? NaN);
  if (!Number.isFinite(number)) {
    throw new Error('Gitea issue creation succeeded but no issue number was returned.');
  }

  return number;
}

export async function closeGiteaIssue(issueNumber: number): Promise<void> {
  const { owner, repo } = resolveRepoConfig();
  const gitea = getGiteaClient();

  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    throw new Error('issueNumber must be a positive number.');
  }

  await gitea.patch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`,
    { state: 'closed' },
  );
}

export async function updateMarkdownTodo(taskName: string): Promise<void> {
  const { owner, repo, baseBranch } = resolveRepoConfig();
  const gitea = getGiteaClient();

  const encodedPath = encodeURIComponent(TODO_FILE_PATH);
  const sourceResponse = await gitea.get(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    { params: { ref: baseBranch } },
  );

  const sha = String(sourceResponse.data?.sha ?? '').trim();
  if (!sha) {
    throw new Error('Unable to update markdown todo: source file SHA missing.');
  }

  const encodedContent = String(sourceResponse.data?.content ?? '').replace(/\n/g, '');
  const existingContent = fromBase64(encodedContent);
  const updatedContent = updateTodoMarkdownContent(existingContent, taskName);

  await gitea.put(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    {
      branch: baseBranch,
      sha,
      content: toBase64(updatedContent),
      message: `chore(pm): auto-complete todo for ${String(taskName ?? '').trim() || 'autonomous task'}`,
    },
  );
}
