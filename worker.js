const DEFAULT_OWNER = 'someshfengde';
const DEFAULT_REPO = 'Google-Cloud-Platform-GCP-Associate-Cloud-Engineer-Practice-Tests-Exams-Questions-Answers';
const DEFAULT_BRANCH = 'main';
const APP_VERSION = '2.0.0';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = getCorsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (!env.GITHUB_TOKEN) {
        return json({ message: 'Worker is missing GITHUB_TOKEN.' }, 500, corsHeaders);
      }

      const match = url.pathname.match(/^\/progress\/([a-z0-9_-]+)$/i);
      if (!match) {
        return json({ message: 'Not found.' }, 404, corsHeaders);
      }

      const profile = sanitizeProfile(match[1]);
      if (request.method === 'GET') return getProgress(env, profile, corsHeaders);
      if (request.method === 'PUT') {
        const payload = await request.json();
        return putProgress(env, profile, payload, corsHeaders);
      }

      return json({ message: 'Method not allowed.' }, 405, corsHeaders);
    } catch (error) {
      return json({ message: error.message || 'Unexpected error.' }, 500, corsHeaders);
    }
  },
};

async function getProgress(env, profile, headers) {
  const file = await getGitHubFile(env, progressPath(profile));
  if (!file) return json({ message: 'Progress file not found.' }, 404, headers);
  return json({
    profile,
    path: progressPath(profile),
    progress: normalizeProgress(file.payload.progress || file.payload),
    payload: file.payload,
  }, 200, headers);
}

async function putProgress(env, profile, payload, headers) {
  const path = progressPath(profile);
  const existing = await getGitHubFile(env, path);
  const incomingProgress = normalizeProgress(payload.progress || payload);
  const mergedProgress = existing
    ? mergeProgress(existing.payload.progress || existing.payload, incomingProgress)
    : incomingProgress;
  const output = {
    schema: 'gcp-ace-practice-progress-v1',
    profile,
    repository: `${githubOwner(env)}/${githubRepo(env)}`,
    branch: githubBranch(env),
    exportedAt: new Date().toISOString(),
    totals: payload.totals || calculateTotals(mergedProgress, payload.totals?.totalQuestions || 179),
    progress: mergedProgress,
  };

  await putGitHubFile(env, path, output, existing?.sha);
  return json({
    profile,
    path,
    progress: mergedProgress,
    payload: output,
  }, 200, headers);
}

async function getGitHubFile(env, path) {
  const response = await fetch(`${contentsUrl(env, path)}?ref=${encodeURIComponent(githubBranch(env))}`, {
    headers: githubHeaders(env),
  });

  if (response.status === 404) return null;
  const data = await parseGitHubResponse(response);
  return {
    sha: data.sha,
    payload: JSON.parse(atob(data.content.replace(/\s/g, ''))),
  };
}

async function putGitHubFile(env, path, payload, sha) {
  const body = {
    message: `Update ${payload.profile} quiz progress`,
    branch: githubBranch(env),
    content: btoa(JSON.stringify(payload, null, 2)),
  };

  if (sha) body.sha = sha;

  const response = await fetch(contentsUrl(env, path), {
    method: 'PUT',
    headers: githubHeaders(env),
    body: JSON.stringify(body),
  });

  await parseGitHubResponse(response);
}

function contentsUrl(env, path) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(githubOwner(env))}/${encodeURIComponent(githubRepo(env))}/contents/${encodedPath}`;
}

function githubHeaders(env) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'gcp-ace-practice-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function parseGitHubResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message ? `GitHub: ${data.message}` : `GitHub returned ${response.status}`);
  }
  return data;
}

function normalizeProgress(input) {
  const source = input?.progress || input || {};
  const normalized = createEmptyProgress();

  Object.entries(source.answers || {}).forEach(([id, answer]) => {
    const selectedIndex = Number.isInteger(answer.selectedIndex) ? answer.selectedIndex : answer.index;
    if (!Number.isInteger(selectedIndex)) return;
    const correct = Boolean(answer.correct);
    const answeredAt = answer.lastAnsweredAt || answer.answeredAt || answer.firstAnsweredAt || new Date().toISOString();

    normalized.answers[id] = {
      selectedIndex,
      correct,
      attempts: Math.max(1, Number(answer.attempts) || 1),
      mistakes: Math.max(0, Number(answer.mistakes) || (correct ? 0 : 1)),
      firstAnsweredAt: answer.firstAnsweredAt || answer.answeredAt || answeredAt,
      lastAnsweredAt: answeredAt,
    };
  });

  Object.entries(source.flags || {}).forEach(([id, flagged]) => {
    if (flagged) normalized.flags[id] = true;
  });

  normalized.meta = {
    ...normalized.meta,
    ...(source.meta || {}),
    appVersion: APP_VERSION,
    updatedAt: source.meta?.updatedAt || new Date().toISOString(),
  };

  return normalized;
}

function mergeProgress(base, incoming) {
  const merged = normalizeProgress(base);
  const other = normalizeProgress(incoming);

  Object.entries(other.answers).forEach(([id, incomingAnswer]) => {
    const current = merged.answers[id];
    if (!current) {
      merged.answers[id] = incomingAnswer;
      return;
    }

    const currentTime = Date.parse(current.lastAnsweredAt || '') || 0;
    const incomingTime = Date.parse(incomingAnswer.lastAnsweredAt || '') || 0;
    const winner = incomingTime >= currentTime ? incomingAnswer : current;

    merged.answers[id] = {
      ...winner,
      attempts: Math.max(current.attempts || 1, incomingAnswer.attempts || 1),
      mistakes: Math.max(current.mistakes || 0, incomingAnswer.mistakes || 0),
      firstAnsweredAt: earliestDate(current.firstAnsweredAt, incomingAnswer.firstAnsweredAt),
    };
  });

  Object.entries(other.flags).forEach(([id, flagged]) => {
    if (flagged) merged.flags[id] = true;
  });

  merged.meta = {
    ...merged.meta,
    updatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
  };

  return merged;
}

function createEmptyProgress() {
  return {
    answers: {},
    flags: {},
    meta: {
      appVersion: APP_VERSION,
      updatedAt: null,
    },
  };
}

function calculateTotals(progress, totalQuestions) {
  const normalized = normalizeProgress(progress);
  const answers = Object.values(normalized.answers);
  const answered = answers.length;
  const correct = answers.filter((answer) => answer.correct).length;
  const mistakes = answers.reduce((sum, answer) => sum + (answer.mistakes || 0), 0);
  return {
    totalQuestions,
    answered,
    correct,
    incorrect: answered - correct,
    mistakes,
    flagged: Object.keys(normalized.flags).length,
    scorePercent: answered ? Math.round((correct / answered) * 100) : 0,
  };
}

function getCorsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || 'https://someshfengde.github.io').split(',').map((value) => value.trim());
  const allowedOrigin = allowed.includes(origin) || !origin ? origin || allowed[0] : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function progressPath(profile) {
  return `progress/${sanitizeProfile(profile)}.json`;
}

function sanitizeProfile(value) {
  return (value || 'somesh')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'somesh';
}

function earliestDate(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function githubOwner(env) {
  return env.GITHUB_OWNER || DEFAULT_OWNER;
}

function githubRepo(env) {
  return env.GITHUB_REPO || DEFAULT_REPO;
}

function githubBranch(env) {
  return env.GITHUB_BRANCH || DEFAULT_BRANCH;
}
