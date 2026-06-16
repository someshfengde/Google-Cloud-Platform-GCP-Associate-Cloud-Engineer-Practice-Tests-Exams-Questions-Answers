const APP_VERSION = '2.0.0';
const PROGRESS_API_URL = 'https://gcp-ace-progress.someshfengde.workers.dev';
const AUTOSAVE_INTERVAL_MS = 60 * 1000;

const DEFAULT_REPO = {
  owner: 'someshfengde',
  repo: 'Google-Cloud-Platform-GCP-Associate-Cloud-Engineer-Practice-Tests-Exams-Questions-Answers',
  branch: 'main',
};

const state = {
  questions: [],
  progress: createEmptyProgress(),
  syncSettings: loadSyncSettings(),
  filter: 'all',
  search: '',
  shuffled: false,
  shuffledIds: [],
  hasUnsavedChanges: false,
  saveInFlight: false,
  lastSavedAt: null,
};

const els = {
  list: document.querySelector('#questionList'),
  status: document.querySelector('#statusMessage'),
  template: document.querySelector('#questionTemplate'),
  total: document.querySelector('#totalQuestions'),
  answered: document.querySelector('#answeredQuestions'),
  correct: document.querySelector('#correctQuestions'),
  mistakes: document.querySelector('#mistakeCount'),
  score: document.querySelector('#scorePercent'),
  search: document.querySelector('#searchInput'),
  filter: document.querySelector('#filterSelect'),
  shuffle: document.querySelector('#shuffleButton'),
  next: document.querySelector('#nextUnanswered'),
  reset: document.querySelector('#resetProgress'),
  syncProfile: document.querySelector('#syncProfile'),
  syncPathPreview: document.querySelector('#syncPathPreview'),
  syncBadge: document.querySelector('#syncBadge'),
  syncStatus: document.querySelector('#syncStatus'),
  load: document.querySelector('#loadProgress'),
  save: document.querySelector('#saveProgress'),
};

init();

async function init() {
  bindControls();
  bindSyncControls();
  hydrateSyncForm();

  try {
    const response = await fetch('README.md', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`README.md returned ${response.status}`);
    const markdown = await response.text();
    state.questions = parseQuestions(markdown);
    if (!state.questions.length) throw new Error('No checkbox-based questions found in README.md');
    els.status.hidden = true;
    render();
  } catch (error) {
    els.status.textContent = `Could not load questions: ${error.message}. Run this through GitHub Pages or a local web server.`;
  }
}

function bindControls() {
  els.search.addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });

  els.filter.addEventListener('change', (event) => {
    state.filter = event.target.value;
    render();
  });

  els.shuffle.addEventListener('click', () => {
    state.shuffled = !state.shuffled;
    state.shuffledIds = state.shuffled ? shuffleIds(state.questions.map((question) => question.id)) : [];
    els.shuffle.textContent = state.shuffled ? 'Original order' : 'Shuffle';
    render();
  });

  els.next.addEventListener('click', () => {
    const next = state.questions.find((question) => !getAnswer(question.id));
    if (!next) {
      setSyncStatus('All questions have an answer.', 'synced');
      return;
    }
    scrollToQuestion(next.id);
  });

  els.reset.addEventListener('click', () => {
    if (!confirm('Clear the progress currently loaded on this page? Save afterward if you want GitHub to store the reset.')) return;
    state.progress = createEmptyProgress();
    markProgressChanged();
    render();
    setSyncStatus('Progress cleared on this page. Autosave will store the reset in GitHub.');
  });
}

function bindSyncControls() {
  els.syncProfile.addEventListener('input', () => {
    readSyncSettingsFromForm();
    updateSyncPathPreview();
  });

  els.load.addEventListener('click', loadProgressFromGitHub);
  els.save.addEventListener('click', () => saveProgressToGitHub({ automatic: false }));
  window.setInterval(() => {
    saveProgressToGitHub({ automatic: true });
  }, AUTOSAVE_INTERVAL_MS);
}

function hydrateSyncForm() {
  els.syncProfile.value = state.syncSettings.profile;
  updateSyncPathPreview();
}

function parseQuestions(markdown) {
  const lines = markdown.split('\n');
  const questions = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (current?.options.length) questions.push(current);
      current = {
        question: cleanMarkdown(line.replace(/^###\s+/, '')),
        media: [],
        options: [],
      };
      continue;
    }

    const option = line.match(/^\s*-\s+\[( |x|X)\]\s+(.+)$/);
    if (current && option) {
      current.options.push({
        text: cleanMarkdown(option[2]),
        correct: option[1].toLowerCase() === 'x',
      });
      continue;
    }

    const image = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (current && image) {
      current.media.push({ alt: cleanMarkdown(image[1]) || 'Question image', src: image[2].trim() });
      continue;
    }

    if (current && line.startsWith('**[⬆ Back to Top]')) {
      if (current.options.length) questions.push(current);
      current = null;
    }
  }

  if (current?.options.length) questions.push(current);

  return questions.map((question, index) => ({
    ...question,
    id: `q${index + 1}`,
    number: index + 1,
    slug: slugify(question.question),
  }));
}

function cleanMarkdown(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function render() {
  updateStats();
  els.list.replaceChildren();

  const visibleQuestions = getVisibleQuestions();
  const fragment = document.createDocumentFragment();
  visibleQuestions.forEach((question) => fragment.appendChild(renderQuestion(question)));
  els.list.appendChild(fragment);

  els.status.hidden = visibleQuestions.length > 0;
  if (!els.status.hidden) els.status.textContent = 'No questions match the current filters.';
}

function renderQuestion(question) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const answer = getAnswer(question.id);
  const flagged = Boolean(state.progress.flags[question.id]);
  const status = getQuestionStatus(answer);

  node.dataset.questionId = question.id;
  node.dataset.status = status;
  node.querySelector('.question-number').textContent = `Question ${question.number}`;
  node.querySelector('.question-state').textContent = answer ? getAnswerSummary(answer) : 'Unanswered';
  node.querySelector('.question-text').textContent = question.question;

  const media = node.querySelector('.question-media');
  question.media.forEach((item) => {
    const image = document.createElement('img');
    image.src = item.src;
    image.alt = item.alt;
    image.loading = 'lazy';
    media.appendChild(image);
  });

  const flagButton = node.querySelector('.flag-button');
  flagButton.setAttribute('aria-pressed', String(flagged));
  flagButton.textContent = flagged ? 'Flagged' : 'Flag';
  flagButton.addEventListener('click', () => {
    state.progress.flags[question.id] = !state.progress.flags[question.id];
    if (!state.progress.flags[question.id]) delete state.progress.flags[question.id];
    markProgressChanged();
    render();
  });

  const options = node.querySelector('.options');
  question.options.forEach((option, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.textContent = `${String.fromCharCode(65 + index)}. ${option.text}`;
    button.setAttribute('aria-pressed', String(answer?.selectedIndex === index));

    if (answer) {
      if (answer.selectedIndex === index) button.classList.add('selected', option.correct ? 'correct' : 'incorrect');
      if (option.correct && answer.selectedIndex !== index) button.classList.add('missed');
    }

    button.addEventListener('click', () => chooseAnswer(question, index));
    options.appendChild(button);
  });

  const feedback = node.querySelector('.feedback');
  if (answer) {
    feedback.textContent = answer.correct
      ? `Correct. Attempts: ${answer.attempts}.`
      : `Incorrect. Correct answer is highlighted. Attempts: ${answer.attempts}.`;
    feedback.classList.add(answer.correct ? 'correct' : 'incorrect');
  }

  return node;
}

function chooseAnswer(question, index) {
  const selected = question.options[index];
  const previous = getAnswer(question.id);
  const now = new Date().toISOString();
  const attempts = (previous?.attempts || 0) + 1;
  const mistakes = (previous?.mistakes || 0) + (selected.correct ? 0 : 1);

  state.progress.answers[question.id] = {
    selectedIndex: index,
    correct: selected.correct,
    attempts,
    mistakes,
    firstAnsweredAt: previous?.firstAnsweredAt || now,
    lastAnsweredAt: now,
  };

  markProgressChanged();
  render();
  scrollToQuestion(question.id, false);
  setSyncStatus('Unsaved changes. Autosave runs every minute.');
}

function getVisibleQuestions() {
  const filtered = state.questions.filter((question) => {
    const answer = getAnswer(question.id);
    const flagged = state.progress.flags[question.id];
    const searchable = [question.question, ...question.options.map((option) => option.text)].join(' ').toLowerCase();
    const matchesSearch = !state.search || searchable.includes(state.search);
    const matchesFilter = state.filter === 'all'
      || (state.filter === 'unanswered' && !answer)
      || (state.filter === 'correct' && answer?.correct)
      || (state.filter === 'incorrect' && answer && !answer.correct)
      || (state.filter === 'needs-review' && answer?.mistakes > 0)
      || (state.filter === 'flagged' && flagged);
    return matchesSearch && matchesFilter;
  });

  if (!state.shuffled) return filtered;
  const order = new Map(state.shuffledIds.map((id, index) => [id, index]));
  return [...filtered].sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));
}

function updateStats() {
  const answers = Object.values(state.progress.answers);
  const answered = answers.length;
  const correct = answers.filter((answer) => answer.correct).length;
  const mistakes = answers.reduce((sum, answer) => sum + (answer.mistakes || 0), 0);

  els.total.textContent = state.questions.length;
  els.answered.textContent = answered;
  els.correct.textContent = correct;
  els.mistakes.textContent = mistakes;
  els.score.textContent = answered ? `${Math.round((correct / answered) * 100)}%` : '0%';
}

function getAnswer(questionId) {
  return state.progress.answers[questionId];
}

function getQuestionStatus(answer) {
  if (!answer) return 'unanswered';
  return answer.correct ? 'correct' : 'incorrect';
}

function getAnswerSummary(answer) {
  const mistakes = answer.mistakes ? `, ${answer.mistakes} wrong` : '';
  return `${answer.correct ? 'Correct' : 'Incorrect'} (${answer.attempts} attempt${answer.attempts === 1 ? '' : 's'}${mistakes})`;
}

function scrollToQuestion(questionId, clearFilters = true) {
  if (clearFilters && !document.querySelector(`[data-question-id="${questionId}"]`)) {
    state.filter = 'all';
    state.search = '';
    els.filter.value = 'all';
    els.search.value = '';
    render();
  }

  document.querySelector(`[data-question-id="${questionId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function touchProgress() {
  state.progress.meta = {
    ...state.progress.meta,
    appVersion: APP_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

function markProgressChanged() {
  touchProgress();
  state.hasUnsavedChanges = true;
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
  };

  return normalized;
}

function loadSyncSettings() {
  const inferred = inferRepoFromLocation();
  return {
    profile: 'somesh',
    owner: inferred.owner,
    repo: inferred.repo,
    branch: inferred.branch,
  };
}

function inferRepoFromLocation() {
  const host = window.location.hostname;
  const pathRepo = window.location.pathname.split('/').filter(Boolean)[0];

  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    return {
      owner,
      repo: pathRepo || `${owner}.github.io`,
      branch: DEFAULT_REPO.branch,
    };
  }

  return { ...DEFAULT_REPO };
}

function readSyncSettingsFromForm() {
  state.syncSettings = {
    ...state.syncSettings,
    profile: els.syncProfile.value.trim() || 'somesh',
  };
}

function getSyncConfig() {
  readSyncSettingsFromForm();
  return {
    ...state.syncSettings,
    apiUrl: PROGRESS_API_URL,
    path: `progress/${sanitizeProfile(state.syncSettings.profile)}.json`,
  };
}

function updateSyncPathPreview() {
  const profile = sanitizeProfile(els.syncProfile.value.trim() || 'default');
  els.syncPathPreview.textContent = `progress/${profile}.json`;
}

async function loadProgressFromGitHub() {
  const config = getSyncConfig();
  if (!validateSyncConfig(config)) return;

  setSyncStatus('Loading progress from cloud...');
  setSyncBusy(true);

  try {
    const remote = await getCloudProgressFile(config);
    if (!remote?.progress) {
      setSyncStatus(`No progress file found at ${config.path}.`, 'error');
      return;
    }

    state.progress = mergeProgress(state.progress, remote.progress);
    touchProgress();
    state.hasUnsavedChanges = false;
    render();
    setSyncStatus(`Loaded and merged ${config.path}.`, 'synced');
  } catch (error) {
    setSyncStatus(error.message, 'error');
  } finally {
    setSyncBusy(false);
  }
}

async function saveProgressToGitHub({ automatic = false } = {}) {
  if (state.saveInFlight) return;
  if (!state.hasUnsavedChanges) {
    if (!automatic) setSyncStatus('No new changes to save.', 'synced');
    return;
  }

  const config = getSyncConfig();
  if (!validateSyncConfig(config)) return;

  const saveStartedAt = state.progress.meta.updatedAt;
  setSyncStatus(automatic ? 'Autosaving progress to cloud...' : 'Saving progress to cloud...');
  state.saveInFlight = true;
  setSyncBusy(true);

  try {
    touchProgress();
    const payload = createProgressPayload(config, state.progress);
    const saved = await putCloudProgressFile(config, payload);
    const noNewerChanges = state.progress.meta.updatedAt === payload.progress.meta.updatedAt
      || state.progress.meta.updatedAt === saveStartedAt;
    if (saved?.progress && noNewerChanges) state.progress = normalizeProgress(saved.progress);
    if (noNewerChanges) {
      state.hasUnsavedChanges = false;
      state.lastSavedAt = new Date().toISOString();
    }
    render();
    setSyncStatus(noNewerChanges ? `Saved ${config.path} to GitHub.` : 'Saved older changes. New changes will autosave on the next tick.', noNewerChanges ? 'synced' : 'pending');
  } catch (error) {
    setSyncStatus(error.message, 'error');
  } finally {
    state.saveInFlight = false;
    setSyncBusy(false);
  }
}

function validateSyncConfig(config) {
  if (!config.apiUrl) {
    setSyncStatus('Progress API is not configured.', 'error');
    return false;
  }
  return true;
}

async function getCloudProgressFile(config) {
  const response = await fetch(progressApiUrl(config), {
    headers: { Accept: 'application/json' },
  });

  if (response.status === 404) return null;
  return parseJsonResponse(response);
}

async function putCloudProgressFile(config, payload) {
  const response = await fetch(progressApiUrl(config), {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse(response);
}

function progressApiUrl(config) {
  return `${config.apiUrl.replace(/\/+$/, '')}/progress/${encodeURIComponent(sanitizeProfile(config.profile))}`;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.message || `Progress API returned ${response.status}`);
  }

  return data;
}

function createProgressPayload(config, progress) {
  const normalizedProgress = normalizeProgress(progress);
  return {
    schema: 'gcp-ace-practice-progress-v1',
    profile: config.profile,
    repository: `${config.owner}/${config.repo}`,
    branch: config.branch,
    exportedAt: new Date().toISOString(),
    totals: calculateTotals(normalizedProgress),
    progress: normalizedProgress,
  };
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

function calculateTotals(progress = state.progress) {
  const normalized = normalizeProgress(progress);
  const answers = Object.values(normalized.answers);
  const answered = answers.length;
  const correct = answers.filter((answer) => answer.correct).length;
  const mistakes = answers.reduce((sum, answer) => sum + (answer.mistakes || 0), 0);

  return {
    totalQuestions: state.questions.length,
    answered,
    correct,
    incorrect: answered - correct,
    mistakes,
    flagged: Object.keys(normalized.flags).length,
    scorePercent: answered ? Math.round((correct / answered) * 100) : 0,
  };
}

function setSyncBusy(isBusy) {
  [els.load, els.save].forEach((control) => {
    control.disabled = isBusy;
  });
}

function setSyncStatus(message, tone = 'pending') {
  els.syncStatus.textContent = message;
  els.syncBadge.classList.toggle('synced', tone === 'synced');
  els.syncBadge.classList.toggle('error', tone === 'error');
  els.syncBadge.textContent = tone === 'synced' ? 'Saved' : tone === 'error' ? 'Check' : 'Unsaved';
}

function sanitizeProfile(value) {
  return (value || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'default';
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function shuffleIds(ids) {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function earliestDate(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}
