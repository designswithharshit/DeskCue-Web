(() => {
  'use strict';

  const cfg = window.DESKCUE_CONFIG || {};
  const configReady = typeof cfg.supabaseUrl === 'string' &&
    cfg.supabaseUrl.startsWith('https://') &&
    typeof cfg.supabasePublishableKey === 'string' &&
    cfg.supabasePublishableKey.length > 20 &&
    !cfg.supabaseUrl.includes('PASTE_') &&
    !cfg.supabasePublishableKey.includes('PASTE_');

  const $ = (id) => document.getElementById(id);
  const authView = $('authView');
  const appView = $('appView');
  const setupBanner = $('setupBanner');
  const authForm = $('authForm');
  const taskForm = $('taskForm');
  const taskList = $('taskList');
  const emptyTasks = $('emptyTasks');
  const loadingTasks = $('loadingTasks');
  const authSubmit = $('authSubmit');
  const toast = $('toast');
  let supabaseClient = null;
  let currentUser = null;
  let tasks = [];
  let filter = 'all';
  let authMode = 'signin';
  let toastTimer = null;
  let busy = false;

  function setConnection(text, connected = false) {
    $('connectionText').textContent = text;
    $('connectionDot').parentElement.classList.toggle('connected', connected);
  }

  function showMessage(element, message, success = false) {
    element.textContent = message || '';
    element.classList.toggle('success', Boolean(success));
  }

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function safeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function todayText() {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
  }

  function formatDailyTime(minutes) {
    const n = Number(minutes);
    if (!Number.isFinite(n)) return '—';
    const d = new Date();
    d.setHours(Math.floor(n / 60), n % 60, 0, 0);
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
  }

  function formatOneTime(epoch) {
    const n = Number(epoch);
    if (!Number.isFinite(n) || n <= 0) return 'Set time';
    const d = new Date(n * 1000);
    const today = new Date();
    const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    return new Intl.DateTimeFormat(undefined, sameDay
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
  }

  function describeTask(task) {
    const kind = task.daily ? 'Daily' : 'One-time';
    const duration = task.untilNext ? 'Until next task' : `${Number(task.durationMinutes) || 30} min`;
    return `${kind} · ${duration}${task.enabled ? '' : ' · Paused'}`;
  }

  function sortTasks(list) {
    return [...list].sort((a, b) => {
      if (Boolean(a.enabled) !== Boolean(b.enabled)) return a.enabled ? -1 : 1;
      if (Boolean(a.daily) !== Boolean(b.daily)) return a.daily ? -1 : 1;
      const aTime = a.daily ? Number(a.startMinute) : Number(a.startEpoch);
      const bTime = b.daily ? Number(b.startMinute) : Number(b.startEpoch);
      return aTime - bTime || String(a.title).localeCompare(String(b.title));
    });
  }

  function renderTasks() {
    $('totalCount').textContent = String(tasks.length);
    $('enabledCount').textContent = String(tasks.filter(t => t.enabled).length);
    $('dailyCount').textContent = String(tasks.filter(t => t.daily).length);
    $('taskCountChip').textContent = String(tasks.length);

    let visible = sortTasks(tasks);
    if (filter === 'daily') visible = visible.filter(t => t.daily);
    if (filter === 'once') visible = visible.filter(t => !t.daily);
    loadingTasks.classList.add('hidden');
    const hasTasks = visible.length > 0;
    taskList.classList.toggle('hidden', !hasTasks);
    emptyTasks.classList.toggle('hidden', hasTasks);
    if (!hasTasks) {
      const isFiltered = tasks.length > 0;
      emptyTasks.querySelector('h3').textContent = isFiltered ? 'No tasks in this view' : 'No tasks yet';
      emptyTasks.querySelector('p').textContent = isFiltered ? 'Try another filter to see your tasks.' : 'Start small. Add one thing you want to remember.';
      $('emptyAddBtn').classList.toggle('hidden', isFiltered);
      return;
    }

    taskList.innerHTML = visible.map((task) => {
      const time = task.daily ? formatDailyTime(task.startMinute) : formatOneTime(task.startEpoch);
      const tag = task.daily ? '<span class="tag daily">Daily</span>' : '<span class="tag">One-time</span>';
      const activeClass = task.enabled ? '' : ' disabled-task';
      return `<article class="task-item${activeClass}" data-id="${Number(task.id)}">
        <div class="task-time"><strong>${safeText(time)}</strong><small>${task.daily ? 'EVERY DAY' : 'SCHEDULED'}</small></div>
        <div class="task-main"><div class="task-title">${safeText(task.title)}</div><div class="task-meta">${tag}<span class="tag">${task.untilNext ? 'Until next task' : `${Number(task.durationMinutes) || 30} min`}</span>${task.enabled ? '' : '<span class="tag off">Paused</span>'}</div></div>
        <div class="task-actions"><button class="mini-action" type="button" data-action="toggle" title="${task.enabled ? 'Pause reminders' : 'Enable reminders'}" aria-label="${task.enabled ? 'Pause reminders' : 'Enable reminders'}">${task.enabled ? 'Ⅱ' : '▶'}</button><button class="mini-action" type="button" data-action="edit" title="Edit task" aria-label="Edit task">✎</button><button class="mini-action delete" type="button" data-action="delete" title="Delete task" aria-label="Delete task">×</button></div>
      </article>`;
    }).join('');
  }

  async function loadTasks() {
    if (!currentUser || !supabaseClient) return;
    loadingTasks.classList.remove('hidden');
    taskList.classList.add('hidden');
    emptyTasks.classList.add('hidden');
    setConnection('Syncing…');
    try {
      const { data, error } = await supabaseClient
        .from('task_lists')
        .select('tasks, updated_at')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        const { error: insertError } = await supabaseClient.from('task_lists').insert({ user_id: currentUser.id, tasks: [] });
        if (insertError && insertError.code !== '23505') throw insertError;
        tasks = [];
      } else {
        tasks = Array.isArray(data.tasks) ? data.tasks : [];
        if (data.updated_at) $('lastSynced').textContent = `Last saved ${new Date(data.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      }
      tasks = tasks.map(normalizeTask).filter(Boolean);
      renderTasks();
      setConnection('Cloud connected', true);
      $('lastSynced').textContent = `Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch (error) {
      loadingTasks.classList.add('hidden');
      renderTasks();
      setConnection('Sync error');
      notify(errorMessage(error));
      showMessage($('taskMessage'), `${errorMessage(error)} Check that the task_lists table is exposed in Supabase Data API and that its RLS policies are enabled.`);
    }
  }

  function normalizeTask(task) {
    if (!task || typeof task !== 'object') return null;
    const id = Number(task.id);
    const startMinute = Number(task.startMinute);
    const startEpoch = Number(task.startEpoch);
    const durationMinutes = Number(task.durationMinutes);
    if (!Number.isFinite(id) || typeof task.title !== 'string') return null;
    return {
      id,
      title: task.title.slice(0, 80),
      daily: Boolean(task.daily),
      startMinute: Number.isFinite(startMinute) ? Math.max(0, Math.min(1439, Math.trunc(startMinute))) : 0,
      startEpoch: Number.isFinite(startEpoch) ? Math.max(0, Math.trunc(startEpoch)) : 0,
      durationMinutes: Number.isFinite(durationMinutes) ? Math.max(1, Math.min(1440, Math.trunc(durationMinutes))) : 30,
      untilNext: Boolean(task.untilNext),
      enabled: task.enabled !== false
    };
  }

  async function persistTasks(nextTasks, successText = 'Tasks saved') {
    if (!currentUser || !supabaseClient) throw new Error('Please sign in first.');
    const normalized = nextTasks.map(normalizeTask).filter(Boolean);
    const { error } = await supabaseClient.from('task_lists').update({ tasks: normalized, updated_at: new Date().toISOString() }).eq('user_id', currentUser.id);
    if (error) throw error;
    tasks = normalized;
    renderTasks();
    $('lastSynced').textContent = `Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    setConnection('Cloud connected', true);
    notify(successText);
  }

  function errorMessage(error) {
    const msg = error && error.message ? error.message : String(error || 'Unknown error');
    if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) return 'Could not reach Supabase. Check your internet connection and project URL.';
    if (/Invalid API key|apikey/i.test(msg)) return 'Supabase key not accepted. Check the publishable key in config.js.';
    if (/row-level security|permission denied|not allowed/i.test(msg)) return 'Supabase blocked this action. Check that you are signed in and your SQL policies are set correctly.';
    return msg;
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === 'signup';
    $('authTitle').textContent = signup ? 'Create your account' : 'Sign in to your planner';
    $('authSubtitle').textContent = signup ? 'One account for your private task list.' : 'Pick up where you left off.';
    authSubmit.innerHTML = signup ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
    $('switchPrompt').textContent = signup ? 'Already registered?' : 'New here?';
    $('authModeBtn').textContent = signup ? 'Sign in instead' : 'Create an account';
    $('authPassword').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    showMessage($('authMessage'), '');
  }

  async function handleAuth(event) {
    event.preventDefault();
    if (!supabaseClient) return;
    if (busy) return;
    busy = true;
    authSubmit.disabled = true;
    authSubmit.textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';
    showMessage($('authMessage'), '');
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          showMessage($('authMessage'), 'Account created. Check your email to confirm it, then sign in.', true);
        } else {
          showMessage($('authMessage'), 'Account created. Opening your planner…', true);
        }
      } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      showMessage($('authMessage'), errorMessage(error));
    } finally {
      busy = false;
      authSubmit.disabled = false;
      authSubmit.innerHTML = authMode === 'signup' ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
    }
  }

  async function enterApp(user) {
    currentUser = user;
    if (!user) {
      authView.classList.remove('hidden');
      appView.classList.add('hidden');
      $('signOutBtn').classList.add('hidden');
      setConnection('Not connected');
      return;
    }
    authView.classList.add('hidden');
    appView.classList.remove('hidden');
    $('signOutBtn').classList.remove('hidden');
    $('todayLabel').textContent = todayText();
    showMessage($('taskMessage'), '');
    await loadTasks();
  }

  function resetTaskForm() {
    taskForm.reset();
    $('editId').value = '';
    $('taskType').value = 'daily';
    $('dailyTime').value = '18:00';
    $('durationMinutes').value = '30';
    $('taskEnabled').checked = true;
    $('untilNext').checked = false;
    $('editorTitle').textContent = 'Add a task';
    $('editorKicker').textContent = 'MAKE A PLAN';
    $('saveTaskBtn').innerHTML = 'Save task <span>→</span>';
    $('cancelEditBtn').classList.add('hidden');
    showMessage($('taskMessage'), '');
    updateTaskTypeFields();
  }

  function updateTaskTypeFields() {
    const daily = $('taskType').value === 'daily';
    $('dailyTimeWrap').classList.toggle('hidden', !daily);
    $('onceTimeWrap').classList.toggle('hidden', daily);
    $('dailyTime').required = daily;
    $('onceDateTime').required = !daily;
  }

  function editTask(id) {
    const task = tasks.find(t => Number(t.id) === id);
    if (!task) return;
    $('editId').value = String(task.id);
    $('taskTitle').value = task.title;
    $('taskType').value = task.daily ? 'daily' : 'once';
    $('dailyTime').value = `${String(Math.floor(task.startMinute / 60)).padStart(2, '0')}:${String(task.startMinute % 60).padStart(2, '0')}`;
    if (task.startEpoch > 0) {
      const date = new Date(task.startEpoch * 1000);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      $('onceDateTime').value = local;
    } else {
      $('onceDateTime').value = '';
    }
    $('durationMinutes').value = String(task.durationMinutes);
    $('untilNext').checked = task.untilNext;
    $('taskEnabled').checked = task.enabled;
    $('editorTitle').textContent = 'Edit task';
    $('editorKicker').textContent = 'UPDATE YOUR PLAN';
    $('saveTaskBtn').innerHTML = 'Update task <span>→</span>';
    $('cancelEditBtn').classList.remove('hidden');
    updateTaskTypeFields();
    $('editorPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('taskTitle').focus({ preventScroll: true });
  }

  async function saveTask(event) {
    event.preventDefault();
    if (!currentUser) return;
    const title = $('taskTitle').value.trim();
    if (!title) return showMessage($('taskMessage'), 'Enter a task name first.');
    const daily = $('taskType').value === 'daily';
    const durationMinutes = Number($('durationMinutes').value);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      return showMessage($('taskMessage'), 'Duration must be between 1 and 1440 minutes.');
    }
    let startMinute = 0;
    let startEpoch = 0;
    if (daily) {
      const bits = $('dailyTime').value.split(':').map(Number);
      if (bits.length !== 2 || bits.some(v => !Number.isFinite(v))) return showMessage($('taskMessage'), 'Choose a valid daily reminder time.');
      startMinute = bits[0] * 60 + bits[1];
    } else {
      const rawDate = $('onceDateTime').value;
      const date = new Date(rawDate);
      if (!rawDate || !Number.isFinite(date.getTime())) return showMessage($('taskMessage'), 'Choose a valid date and time.');
      if (date.getTime() <= Date.now()) return showMessage($('taskMessage'), 'Choose a future date and time for a one-time task.');
      startEpoch = Math.floor(date.getTime() / 1000);
      startMinute = date.getHours() * 60 + date.getMinutes();
    }

    const editId = $('editId').value ? Number($('editId').value) : null;
    const id = editId ?? (tasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1);
    const item = { id, title, daily, startMinute, startEpoch, durationMinutes, untilNext: $('untilNext').checked, enabled: $('taskEnabled').checked };
    const next = editId === null ? [...tasks, item] : tasks.map(t => Number(t.id) === editId ? item : t);
    const btn = $('saveTaskBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    showMessage($('taskMessage'), '');
    try {
      await persistTasks(next, editId === null ? 'Task added' : 'Task updated');
      resetTaskForm();
    } catch (error) {
      showMessage($('taskMessage'), errorMessage(error));
    } finally {
      btn.disabled = false;
      btn.innerHTML = $('editId').value ? 'Update task <span>→</span>' : 'Save task <span>→</span>';
    }
  }

  async function handleTaskAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const card = button.closest('[data-id]');
    if (!card) return;
    const id = Number(card.dataset.id);
    const task = tasks.find(t => Number(t.id) === id);
    if (!task) return;
    const action = button.dataset.action;
    if (action === 'edit') return editTask(id);
    if (action === 'toggle') {
      const next = tasks.map(t => Number(t.id) === id ? { ...t, enabled: !t.enabled } : t);
      try { await persistTasks(next, task.enabled ? 'Reminders paused' : 'Reminders enabled'); }
      catch (error) { notify(errorMessage(error)); }
    }
    if (action === 'delete') {
      if (!confirm(`Delete “${task.title}”?`)) return;
      try {
        await persistTasks(tasks.filter(t => Number(t.id) !== id), 'Task deleted');
        if (Number($('editId').value) === id) resetTaskForm();
      } catch (error) { notify(errorMessage(error)); }
    }
  }

  async function signOut() {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) return notify(errorMessage(error));
    tasks = [];
    resetTaskForm();
    await enterApp(null);
    notify('Signed out');
  }

  function init() {
    $('todayLabel').textContent = todayText();
    $('onceDateTime').min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    if (!configReady || !window.supabase || typeof window.supabase.createClient !== 'function') {
      setupBanner.classList.remove('hidden');
      setConnection('Setup needed');
      authSubmit.disabled = true;
      authSubmit.title = 'Add Supabase settings in config.js first';
    } else {
      supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      setConnection('Connecting…');
      supabaseClient.auth.getSession().then(({ data, error }) => {
        if (error) { setConnection('Connection issue'); showMessage($('authMessage'), errorMessage(error)); }
        enterApp(data?.session?.user || null);
      });
      supabaseClient.auth.onAuthStateChange((_event, session) => {
        if (session?.user && (!currentUser || currentUser.id !== session.user.id)) enterApp(session.user);
        else if (!session?.user && currentUser) enterApp(null);
      });
    }

    authForm.addEventListener('submit', handleAuth);
    $('authModeBtn').addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));
    $('signOutBtn').addEventListener('click', signOut);
    taskForm.addEventListener('submit', saveTask);
    $('taskType').addEventListener('change', updateTaskTypeFields);
    $('cancelEditBtn').addEventListener('click', resetTaskForm);
    $('newTaskBtn').addEventListener('click', () => { resetTaskForm(); $('editorPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('taskTitle').focus({ preventScroll: true }); });
    $('emptyAddBtn').addEventListener('click', () => { resetTaskForm(); $('editorPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('taskTitle').focus({ preventScroll: true }); });
    $('refreshBtn').addEventListener('click', loadTasks);
    taskList.addEventListener('click', handleTaskAction);
    document.querySelectorAll('.filter-tab').forEach(btn => btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderTasks();
    }));
    $('taskForm').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') { /* Keep the native form behaviour. */ } });
  }

  init();
})();
