const STORAGE_KEY = 'gcp-ace-progress-v1';

const state = {
  questions: [],
  progress: loadProgress(),
  filter: 'all',
  search: '',
  shuffled: false,
};

const els = {
  list: document.querySelector('#questionList'),
  status: document.querySelector('#statusMessage'),
  template: document.querySelector('#questionTemplate'),
  total: document.querySelector('#totalQuestions'),
  answered: document.querySelector('#answeredQuestions'),
  correct: document.querySelector('#correctQuestions'),
  score: document.querySelector('#scorePercent'),
  search: document.querySelector('#searchInput'),
  filter: document.querySelector('#filterSelect'),
  shuffle: document.querySelector('#shuffleButton'),
  next: document.querySelector('#nextUnanswered'),
  reset: document.querySelector('#resetProgress'),
};

init();

async function init() {
  bindControls();
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
    els.shuffle.textContent = state.shuffled ? 'Original order' : 'Shuffle';
    render();
  });
  els.next.addEventListener('click', () => {
    const next = state.questions.find((question) => !state.progress.answers[question.id]);
    if (next) document.querySelector(`[data-question-id="${next.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  els.reset.addEventListener('click', () => {
    if (!confirm('Reset all saved answers and flags for this browser?')) return;
    state.progress = { answers: {}, flags: {} };
    saveProgress();
    render();
  });
}

function parseQuestions(markdown) {
  const lines = markdown.split('\n');
  const questions = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (current?.options.length) questions.push(current);
      current = { question: cleanMarkdown(line.replace(/^###\s+/, '')), options: [] };
      continue;
    }

    const option = line.match(/^- \[( |x|X)\] (.+)$/);
    if (current && option) {
      current.options.push({ text: cleanMarkdown(option[2]), correct: option[1].toLowerCase() === 'x' });
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
  }));
}

function cleanMarkdown(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function render() {
  updateStats();
  els.list.replaceChildren();

  const fragment = document.createDocumentFragment();
  getVisibleQuestions().forEach((question) => fragment.appendChild(renderQuestion(question)));
  els.list.appendChild(fragment);
  els.status.hidden = els.list.children.length > 0;
  if (!els.status.hidden) els.status.textContent = 'No questions match the current filters.';
}

function renderQuestion(question) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const answer = state.progress.answers[question.id];
  const flagged = Boolean(state.progress.flags[question.id]);
  node.dataset.questionId = question.id;
  node.querySelector('.question-number').textContent = `Question ${question.number}`;
  node.querySelector('.question-text').textContent = question.question;

  const flagButton = node.querySelector('.flag-button');
  flagButton.setAttribute('aria-pressed', String(flagged));
  flagButton.textContent = flagged ? '★ Flagged' : '☆ Flag';
  flagButton.addEventListener('click', () => {
    state.progress.flags[question.id] = !state.progress.flags[question.id];
    saveProgress();
    render();
  });

  const options = node.querySelector('.options');
  question.options.forEach((option, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.textContent = `${String.fromCharCode(65 + index)}. ${option.text}`;
    if (answer) {
      if (option.correct) button.classList.add(answer.index === index ? 'correct' : 'missed');
      if (answer.index === index && !option.correct) button.classList.add('incorrect');
    }
    button.addEventListener('click', () => chooseAnswer(question, index));
    options.appendChild(button);
  });

  const feedback = node.querySelector('.feedback');
  if (answer) {
    feedback.textContent = answer.correct ? 'Correct' : 'Incorrect — the correct answer is highlighted.';
    feedback.classList.add(answer.correct ? 'correct' : 'incorrect');
  }
  return node;
}

function chooseAnswer(question, index) {
  const selected = question.options[index];
  state.progress.answers[question.id] = { index, correct: selected.correct, answeredAt: new Date().toISOString() };
  saveProgress();
  render();
  document.querySelector(`[data-question-id="${question.id}"]`)?.scrollIntoView({ block: 'center' });
}

function getVisibleQuestions() {
  const filtered = state.questions.filter((question) => {
    const answer = state.progress.answers[question.id];
    const flagged = state.progress.flags[question.id];
    const matchesSearch = !state.search || [question.question, ...question.options.map((option) => option.text)].join(' ').toLowerCase().includes(state.search);
    const matchesFilter = state.filter === 'all'
      || (state.filter === 'unanswered' && !answer)
      || (state.filter === 'correct' && answer?.correct)
      || (state.filter === 'incorrect' && answer && !answer.correct)
      || (state.filter === 'flagged' && flagged);
    return matchesSearch && matchesFilter;
  });
  return state.shuffled ? [...filtered].sort(() => Math.random() - 0.5) : filtered;
}

function updateStats() {
  const answers = Object.values(state.progress.answers);
  const correct = answers.filter((answer) => answer.correct).length;
  els.total.textContent = state.questions.length;
  els.answered.textContent = answers.length;
  els.correct.textContent = correct;
  els.score.textContent = answers.length ? `${Math.round((correct / answers.length) * 100)}%` : '0%';
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { answers: {}, flags: {} };
  } catch {
    return { answers: {}, flags: {} };
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}
