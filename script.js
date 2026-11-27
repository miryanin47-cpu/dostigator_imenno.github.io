'use strict';

const DEFAULT_TASKS = [
  { id: 'homework', title: 'Сделать домашнее задание', points: 1 },
  { id: 'training', title: 'Сходить на тренировку', points: 1 },
  { id: 'grade', title: 'Получить пятерку', points: 1 },
  { id: 'book', title: 'Прочитать 10 страниц книги', points: 1 },
  { id: 'room', title: 'Убрать в комнате', points: 1 }
];
const STORAGE_KEY = 'schoolMotivatorState';
const ROLE_KEY = 'motivatorRole';
const PIN_PATTERN = /^\d{4,8}$/;

const dateKey = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const monthKey = (date = new Date()) => dateKey(date).slice(0, 7);
const monthKeyOf = key => key.slice(0, 7);
const clone = value => JSON.parse(JSON.stringify(value));

function readStorage(kind) {
  try {
    const storage = window[kind];
    const probe = '__motivator_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch (error) {
    return null;
  }
}

class StorageService {
  constructor() {
    this.storage = readStorage('localStorage');
    this.memory = null;
    this.available = Boolean(this.storage);
  }
  load() {
    if (!this.storage) return this.memory;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid state');
      return saved;
    } catch (error) {
      try { this.storage.removeItem(STORAGE_KEY); } catch (ignored) { /* хранилище недоступно */ }
      return null;
    }
  }
  save(state) {
    if (!this.storage) {
      this.memory = state;
      return false;
    }
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  }
}

class AppState {
  constructor(storage) {
    this.storage = storage;
    this.data = this.normalize(storage.load() || {});
    this.role = this.readRole();
    this.period = 'week';
    this.calendarDate = new Date();
    this.selectedDate = dateKey();
    this.ledgerCache = new Map();
    this.lastSaveOk = true;
  }
  readRole() {
    try { return sessionStorage.getItem(ROLE_KEY) === 'student' ? 'student' : null; }
    catch (error) { return null; }
  }
  normalize(saved) {
    const sourceTasks = Array.isArray(saved.tasks) ? saved.tasks : clone(DEFAULT_TASKS);
    const seen = new Set();
    const tasks = [];
    sourceTasks.forEach(task => {
      if (!task || typeof task !== 'object' || !task.id || !task.title) return;
      const id = String(task.id);
      if (seen.has(id)) return;
      seen.add(id);
      tasks.push({ id, title: String(task.title).slice(0, 120), points: this.nonNegativeInteger(task.points, 1) });
    });
    const checks = saved.checks && typeof saved.checks === 'object'
      ? Object.fromEntries(Object.entries(saved.checks).map(([key, taskIds]) => [key, Array.isArray(taskIds) ? taskIds.map(String) : []]))
      : {};
    const dailyResults = {};
    if (saved.dailyResults && typeof saved.dailyResults === 'object') {
      Object.entries(saved.dailyResults).forEach(([key, result]) => {
        if (!result || typeof result !== 'object' || Array.isArray(result)) return;
        dailyResults[key] = Object.fromEntries(Object.entries(result)
          .filter(([, task]) => task && typeof task.title === 'string')
          .map(([id, task]) => [String(id), { title: task.title, points: this.nonNegativeInteger(task.points, 0) }]));
      });
    }
    const tasksById = new Map(tasks.map(task => [task.id, task]));
    Object.entries(checks).forEach(([key, taskIds]) => {
      if (dailyResults[key]) return;
      dailyResults[key] = Object.fromEntries(taskIds.filter(id => tasksById.has(id)).map(id => {
        const task = tasksById.get(id);
        return [id, { title: task.title, points: task.points }];
      }));
    });
    return {
      tasks,
      rate: this.positiveNumber(saved.rate, 10),
      limit: this.positiveNumber(saved.limit, 1000),
      pin: typeof saved.pin === 'string' && PIN_PATTERN.test(saved.pin) ? saved.pin : null,
      checks,
      dailyResults
    };
  }
  positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }
  nonNegativeInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : fallback;
  }
  persist() {
    this.lastSaveOk = this.storage.save(this.data);
    this.ledgerCache.clear();
    return this.lastSaveOk;
  }
  setRole(role) {
    this.role = role;
    try {
      if (role === 'student') sessionStorage.setItem(ROLE_KEY, 'student');
      else sessionStorage.removeItem(ROLE_KEY);
    } catch (error) { /* приватный режим: роль живёт до перезагрузки */ }
  }
  setPin(pin) {
    this.data.pin = PIN_PATTERN.test(pin) ? pin : null;
    return this.persist();
  }
  hasPin() { return Boolean(this.data.pin); }
  getChecks(key = dateKey()) { return Array.isArray(this.data.checks[key]) ? this.data.checks[key] : []; }
  isChecked(taskId, key = dateKey()) { return this.getChecks(key).includes(taskId); }
  toggleTask(taskId) {
    const key = dateKey();
    const checked = new Set(this.getChecks(key));
    const task = this.data.tasks.find(item => item.id === taskId);
    if (!task) return true;
    if (!this.data.dailyResults[key]) this.data.dailyResults[key] = {};
    if (checked.has(taskId)) {
      checked.delete(taskId);
      delete this.data.dailyResults[key][taskId];
    } else {
      checked.add(taskId);
      this.data.dailyResults[key][taskId] = { title: task.title, points: task.points };
    }
    if (checked.size) this.data.checks[key] = [...checked];
    else delete this.data.checks[key];
    if (!Object.keys(this.data.dailyResults[key]).length) delete this.data.dailyResults[key];
    return this.persist();
  }
  tasksForDay(key = dateKey()) {
    const result = this.data.dailyResults[key];
    if (result) return Object.entries(result).map(([id, task]) => ({ id, title: task.title, points: task.points }));
    const tasksById = new Map(this.data.tasks.map(task => [task.id, task]));
    return this.getChecks(key).filter(id => tasksById.has(id)).map(id => tasksById.get(id));
  }
  completedTasksForDay(key) { return this.tasksForDay(key).length; }
  pointsForDay(key) {
    return this.tasksForDay(key).reduce((total, task) => total + task.points, 0);
  }
  monthPoints(date = new Date()) {
    const prefix = monthKey(date);
    const keys = new Set([...Object.keys(this.data.checks), ...Object.keys(this.data.dailyResults)]);
    return [...keys].reduce((total, key) => key.startsWith(prefix) ? total + this.pointsForDay(key) : total, 0);
  }
  monthLedger(prefix = monthKey()) {
    if (this.ledgerCache.has(prefix)) return this.ledgerCache.get(prefix);
    const keys = [...new Set([...Object.keys(this.data.checks), ...Object.keys(this.data.dailyResults)])]
      .filter(key => key.startsWith(prefix))
      .sort();
    let remaining = this.data.limit;
    const ledger = new Map();
    keys.forEach(key => {
      const points = this.pointsForDay(key);
      const gross = points * this.data.rate;
      const rubles = Math.max(0, Math.min(gross, remaining));
      ledger.set(key, { points, gross, rubles, capped: gross - rubles > 0.0001 });
      remaining = Math.max(0, remaining - rubles);
    });
    this.ledgerCache.set(prefix, ledger);
    return ledger;
  }
  monthEarned(date = new Date()) {
    let total = 0;
    this.monthLedger(monthKey(date)).forEach(item => { total += item.rubles; });
    return total;
  }
  dayEarned(key) {
    const item = this.monthLedger(monthKeyOf(key)).get(key);
    return item ? item.rubles : 0;
  }
  dayCapped(key) {
    const item = this.monthLedger(monthKeyOf(key)).get(key);
    return Boolean(item && item.capped);
  }
  setRules(rate, limit) {
    this.data.rate = this.positiveNumber(rate, this.data.rate);
    this.data.limit = this.positiveNumber(limit, this.data.limit);
    return this.persist();
  }
  nextTaskId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return `task-${window.crypto.randomUUID()}`;
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  addTask(title, points) {
    const cleanTitle = String(title).trim().slice(0, 80);
    if (!cleanTitle) return true;
    this.data.tasks.push({ id: this.nextTaskId(), title: cleanTitle, points: this.nonNegativeInteger(points, 1) });
    return this.persist();
  }
  setTaskPoints(id, points) {
    const task = this.data.tasks.find(item => item.id === id);
    if (!task) return true;
    const cleanPoints = this.nonNegativeInteger(points, task.points);
    if (cleanPoints === task.points) return true;
    task.points = cleanPoints;
    return this.persist();
  }
  removeTask(id) {
    this.data.tasks = this.data.tasks.filter(task => task.id !== id);
    const today = dateKey();
    if (Array.isArray(this.data.checks[today])) {
      const rest = this.data.checks[today].filter(taskId => taskId !== id);
      if (rest.length) this.data.checks[today] = rest;
      else delete this.data.checks[today];
    }
    if (this.data.dailyResults[today]) {
      delete this.data.dailyResults[today][id];
      if (!Object.keys(this.data.dailyResults[today]).length) delete this.data.dailyResults[today];
    }
    return this.persist();
  }
  getPeriodKeys() {
    const days = this.period === 'week' ? 7 : new Date().getDate();
    return Array.from({ length: days }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - index - 1));
      return dateKey(date);
    });
  }
  currentStreak() {
    let streak = 0;
    let guard = 3660;
    const cursor = new Date();
    if (this.completedTasksForDay(dateKey(cursor)) === 0) cursor.setDate(cursor.getDate() - 1);
    while (guard > 0 && this.completedTasksForDay(dateKey(cursor)) > 0) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      guard -= 1;
    }
    return streak;
  }
}

class Renderer {
  constructor(state) {
    this.state = state;
    this.charts = {};
  }
  money(value) { return `${Math.round(value).toLocaleString('ru-RU')} ₽`; }
  plural(number, one, few, many) {
    const mod10 = number % 10;
    const mod100 = number % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }
  escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  renderAll() {
    this.renderRole();
    this.renderHeader();
    this.renderToday();
    this.renderTasks();
    this.renderSettings();
    this.renderAnalytics();
  }
  renderRole() {
    const isParent = this.state.role === 'parent';
    document.querySelector('#rolePill').textContent = isParent ? 'Родитель' : 'Школьник';
    document.querySelectorAll('.parent-only').forEach(element => {
      element.classList.toggle('hidden', !isParent);
    });
    if (!isParent && document.querySelector('#settingsView').classList.contains('active-view')) this.showView('todayView');
  }
  renderHeader() {
    const today = new Date();
    document.querySelector('#dateLabel').textContent = today.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    document.querySelector('#greeting').textContent = this.state.role === 'parent' ? 'День маленьких побед' : 'Твой день, твои победы';
    const streak = this.state.currentStreak();
    document.querySelector('#streakValue').textContent = `${streak} ${this.plural(streak, 'день', 'дня', 'дней')}`;
  }
  renderToday() {
    const todayKey = dateKey();
    const todayPoints = this.state.pointsForDay(todayKey);
    const monthPoints = this.state.monthPoints();
    const monthEarned = this.state.monthEarned();
    const limit = this.state.data.limit;
    const percent = limit > 0 ? Math.min(100, Math.round(monthEarned / limit * 100)) : 0;
    const completedToday = this.state.data.tasks.filter(task => this.state.isChecked(task.id)).length;
    document.querySelector('#todayPoints').textContent = todayPoints;
    document.querySelector('#todayRubles').textContent = this.money(this.state.dayEarned(todayKey));
    document.querySelector('#monthPoints').textContent = `${monthPoints} ${this.plural(monthPoints, 'балл', 'балла', 'баллов')}`;
    document.querySelector('#monthRubles').textContent = Math.round(monthEarned).toLocaleString('ru-RU');
    document.querySelector('#limitProgressBar').value = percent;
    document.querySelector('#limitProgressText').textContent = `${percent}% лимита`;
    document.querySelector('#limitCaption').textContent = `Лимит: ${this.money(limit)}`;
    let message = 'Выбери первое выполненное задание.';
    if (completedToday > 0) {
      message = this.state.dayCapped(todayKey)
        ? 'Баллы начислены. Рубли за сегодня не идут: месячный лимит выбран.'
        : 'Так держать! Ещё одна маленькая победа.';
    }
    document.querySelector('#todayMessage').textContent = message;
  }
  renderTasks() {
    const todayKey = dateKey();
    const saved = this.state.data.dailyResults[todayKey] || {};
    const list = document.querySelector('#taskList');
    list.innerHTML = this.state.data.tasks.map(task => {
      const checked = this.state.isChecked(task.id);
      const points = checked && saved[task.id] ? saved[task.id].points : task.points;
      return `<label class="task-item ${checked ? 'done' : ''}"><input class="task-check" type="checkbox" data-task-id="${this.escape(task.id)}" ${checked ? 'checked' : ''}><span class="task-title">${this.escape(task.title)}</span><span class="task-points">+${points} ${this.plural(points, 'балл', 'балла', 'баллов')}</span></label>`;
    }).join('');
    document.querySelector('#emptyTasks').classList.toggle('hidden', this.state.data.tasks.length > 0);
    const completedToday = this.state.data.tasks.filter(task => this.state.isChecked(task.id)).length;
    document.querySelector('#completionCount').textContent = `${completedToday} из ${this.state.data.tasks.length}`;
  }
  renderSettings() {
    document.querySelector('#rateInput').value = this.state.data.rate;
    document.querySelector('#limitInput').value = this.state.data.limit;
    document.querySelector('#manageTasks').innerHTML = this.state.data.tasks.map(task => `<div class="manage-row"><span class="manage-title">${this.escape(task.title)}</span><label class="points-field"><input class="text-input task-points-input" type="number" min="0" step="1" value="${task.points}" data-points-id="${this.escape(task.id)}" aria-label="Баллы за задание «${this.escape(task.title)}»"><span>баллов</span></label><button class="delete-task" type="button" data-delete-id="${this.escape(task.id)}" aria-label="Удалить задание «${this.escape(task.title)}»">×</button></div>`).join('');
  }
  renderAnalytics() {
    this.renderCalendar();
    this.renderCharts();
    this.renderReport();
    this.renderSelectedDay();
  }
  renderCalendar() {
    const date = this.state.calendarDate;
    const year = date.getFullYear();
    const month = date.getMonth();
    document.querySelector('#calendarTitle').textContent = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const grid = document.querySelector('#calendarGrid');
    grid.innerHTML = '';
    const today = dateKey();
    for (let index = 0; index < firstDay; index += 1) grid.insertAdjacentHTML('beforeend', '<span class="day-cell empty"></span>');
    for (let day = 1; day <= days; day += 1) {
      const key = dateKey(new Date(year, month, day));
      const points = this.state.pointsForDay(key);
      const heat = Math.min(3, points);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `day-cell has-${heat}${key === today ? ' today' : ''}${key === this.state.selectedDate ? ' selected' : ''}`;
      button.dataset.date = key;
      button.disabled = key > today;
      button.title = `${points} ${this.plural(points, 'балл', 'балла', 'баллов')}`;
      button.setAttribute('aria-label', `${new Date(`${key}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}: ${button.title}`);
      button.setAttribute('aria-pressed', String(key === this.state.selectedDate));
      button.textContent = day;
      grid.append(button);
    }
    const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    document.querySelector('#nextMonthButton').disabled = date >= currentMonth;
  }
  showChartFallback(show) {
    document.querySelectorAll('[data-chart-fallback]').forEach(element => element.classList.toggle('hidden', !show));
    document.querySelectorAll('.donut-wrap, .line-chart-wrap').forEach(element => element.classList.toggle('hidden', show));
  }
  renderCharts() {
    const keys = this.state.getPeriodKeys();
    const values = keys.map(key => this.state.pointsForDay(key));
    const completed = keys.reduce((sum, key) => sum + this.state.completedTasksForDay(key), 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    const possible = Math.max(keys.length * this.state.data.tasks.length, completed);
    const completedPercent = possible ? Math.round(completed / possible * 100) : 0;
    document.querySelector('#completionPercent').textContent = `${completedPercent}%`;
    document.querySelector('#chartTotal').textContent = `${total} ${this.plural(total, 'балл', 'балла', 'баллов')}`;
    document.querySelector('#chartPeriodLabel').textContent = this.state.period === 'week' ? 'Последние 7 дней' : 'С начала месяца';
    const hasChart = typeof window.Chart !== 'undefined';
    this.showChartFallback(!hasChart);
    if (!hasChart) return;
    if (!document.querySelector('#analyticsView').classList.contains('active-view')) return;
    const labels = keys.map(key => new Date(`${key}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
    const donutData = [completed, Math.max(0, possible - completed)];
    try {
      if (!this.charts.donut || !this.charts.line) {
        this.charts.donut = new window.Chart(document.querySelector('#completionChart'), {
          type: 'doughnut',
          data: { labels: ['Выполнено', 'Осталось'], datasets: [{ data: donutData, backgroundColor: ['#2f7a66', '#e6eeea'], borderWidth: 0 }] },
          options: { cutout: '75%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => ` ${context.raw} заданий` } } }, maintainAspectRatio: false }
        });
        this.charts.line = new window.Chart(document.querySelector('#pointsChart'), {
          type: 'line',
          data: { labels, datasets: [{ data: values, borderColor: '#2f7a66', backgroundColor: 'rgba(153,214,191,.22)', fill: true, tension: .38, pointRadius: 3, pointBackgroundColor: '#2f7a66' }] },
          options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0, color: '#5e6c72' }, grid: { color: '#edf2ef' } }, x: { ticks: { color: '#5e6c72', maxRotation: 0 }, grid: { display: false } } } }
        });
        return;
      }
      this.charts.donut.data.datasets[0].data = donutData;
      this.charts.donut.update();
      this.charts.line.data.labels = labels;
      this.charts.line.data.datasets[0].data = values;
      this.charts.line.update();
    } catch (error) {
      this.charts = {};
      this.showChartFallback(true);
    }
  }
  renderReport() {
    const keys = this.state.getPeriodKeys();
    const values = keys.map(key => this.state.pointsForDay(key));
    const total = values.reduce((sum, value) => sum + value, 0);
    const completed = keys.reduce((sum, key) => sum + this.state.completedTasksForDay(key), 0);
    const activeDays = keys.filter(key => this.state.completedTasksForDay(key) > 0).length;
    const bestValue = Math.max(0, ...values);
    const bestIndex = values.indexOf(bestValue);
    const periodLabel = this.state.period === 'week' ? 'неделю' : 'месяц';
    document.querySelector('#reportTitle').textContent = `Отчёт за ${periodLabel}`;
    document.querySelector('#reportBadge').textContent = `${total} ${this.plural(total, 'балл', 'балла', 'баллов')}`;
    document.querySelector('#reportPoints').textContent = total;
    document.querySelector('#reportTasks').textContent = completed;
    document.querySelector('#reportActiveDays').textContent = activeDays;
    document.querySelector('#reportPointsLabel').textContent = `${this.plural(total, 'балл', 'балла', 'баллов')} набрано`;
    document.querySelector('#reportTasksLabel').textContent = `${this.plural(completed, 'задание', 'задания', 'заданий')} выполнено`;
    document.querySelector('#reportActiveDaysLabel').textContent = `${this.plural(activeDays, 'день', 'дня', 'дней')} с результатом`;
    let bestText = 'Пока нет выполненных заданий';
    if (completed > 0 && bestValue > 0) {
      bestText = `Лучший день: ${new Date(`${keys[bestIndex]}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · ${bestValue} ${this.plural(bestValue, 'балл', 'балла', 'баллов')}`;
    } else if (completed > 0) {
      bestText = 'Выполнены задания без баллов';
    }
    document.querySelector('#reportBestDay').textContent = bestText;
    const maxValue = Math.max(1, ...values);
    document.querySelector('#reportBars').innerHTML = keys.map((key, index) => {
      const value = values[index];
      const height = value ? Math.max(8, Math.round(value / maxValue * 100)) : 3;
      const date = new Date(`${key}T12:00:00`);
      const label = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      return `<div class="report-bar-column" title="${this.escape(label)}: ${value} ${this.plural(value, 'балл', 'балла', 'баллов')}"><div class="report-bar-track"><span class="${value === bestValue && value > 0 ? 'best' : ''}" style="height:${height}%"></span></div><small>${date.getDate()}</small></div>`;
    }).join('');
  }
  renderSelectedDay() {
    const key = this.state.selectedDate;
    const date = new Date(`${key}T12:00:00`);
    const tasks = this.state.tasksForDay(key);
    const points = this.state.pointsForDay(key);
    document.querySelector('#selectedDayTitle').textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.querySelector('#selectedDayPoints').textContent = `${points} ${this.plural(points, 'балл', 'балла', 'баллов')}`;
    document.querySelector('#selectedDayRubles').textContent = this.money(this.state.dayEarned(key));
    document.querySelector('#selectedDayTaskCount').textContent = `${tasks.length} ${this.plural(tasks.length, 'задание выполнено', 'задания выполнено', 'заданий выполнено')}`;
    document.querySelector('#selectedDayTasks').innerHTML = tasks.map(task => `<li><span>${this.escape(task.title)}</span><strong>+${task.points}</strong></li>`).join('');
    document.querySelector('#selectedDayEmpty').classList.toggle('hidden', tasks.length > 0);
  }
  showView(viewId) {
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active-view', view.id === viewId));
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === viewId));
  }
}

class AppController {
  constructor() {
    this.state = new AppState(new StorageService());
    this.renderer = new Renderer(this.state);
    this.pinMode = 'enter';
    this.pinAttempts = 0;
    this.pinLockedUntil = 0;
    this.saveWarned = false;
    this.feedbackTimers = {};
    this.bindEvents();
    this.start();
  }
  start() {
    this.renderer.renderAll();
    if (!this.state.role) this.openRoleModal();
    if (!this.state.storage.available) this.showSaveWarning('Браузер не разрешает сохранение: данные пропадут после закрытия окна.');
  }
  bindEvents() {
    document.querySelector('#taskList').addEventListener('change', event => {
      if (!event.target.matches('.task-check')) return;
      const beforePoints = this.state.monthPoints();
      const beforeEarned = this.state.monthEarned();
      const ok = this.state.toggleTask(event.target.dataset.taskId);
      const afterPoints = this.state.monthPoints();
      const afterEarned = this.state.monthEarned();
      if (!ok) this.showSaveWarning();
      else if (this.state.data.rate > 0 && afterPoints > beforePoints && Math.abs(afterEarned - beforeEarned) < 0.0001) {
        this.toast('Балл начислен, но месячный лимит денег уже выбран.');
      }
      this.renderer.renderAll();
    });
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
      if (tab.classList.contains('hidden') || !tab.dataset.view) return;
      this.renderer.showView(tab.dataset.view);
      if (tab.dataset.view === 'analyticsView') this.renderer.renderAnalytics();
    }));
    document.querySelectorAll('.period-button').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('.period-button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      this.state.period = button.dataset.period;
      this.renderer.renderAnalytics();
    }));
    document.querySelector('#calendarGrid').addEventListener('click', event => {
      const day = event.target.closest('[data-date]');
      if (!day || day.disabled) return;
      this.state.selectedDate = day.dataset.date;
      this.renderer.renderAnalytics();
    });
    document.querySelector('#previousMonthButton').addEventListener('click', () => this.changeMonth(-1));
    document.querySelector('#nextMonthButton').addEventListener('click', () => this.changeMonth(1));
    document.querySelector('#saveRulesButton').addEventListener('click', () => {
      const rateRaw = String(document.querySelector('#rateInput').value).trim();
      const limitRaw = String(document.querySelector('#limitInput').value).trim();
      const rate = Number(rateRaw.replace(',', '.'));
      const limit = Number(limitRaw.replace(',', '.'));
      if (!rateRaw || !limitRaw || !Number.isFinite(rate) || rate < 0 || !Number.isFinite(limit) || limit < 0) {
        this.feedback('#rulesFeedback', 'Введите неотрицательные числа.', true);
        return;
      }
      const ok = this.state.setRules(rate, limit);
      this.renderer.renderAll();
      this.feedback('#rulesFeedback', ok ? 'Правила сохранены.' : 'Правила применены, но сохранить не удалось.');
      if (!ok) this.showSaveWarning();
    });
    document.querySelector('#addTaskForm').addEventListener('submit', event => {
      event.preventDefault();
      const input = document.querySelector('#newTaskInput');
      const pointsInput = document.querySelector('#newTaskPointsInput');
      const title = input.value.trim();
      const points = Number(pointsInput.value);
      if (!title) {
        this.toast('Введите название задания.');
        input.focus();
        return;
      }
      if (!Number.isInteger(points) || points < 0) {
        this.toast('Баллы: целое число 0 или больше.');
        pointsInput.focus();
        return;
      }
      const ok = this.state.addTask(title, points);
      input.value = '';
      pointsInput.value = '1';
      this.renderer.renderAll();
      if (!ok) this.showSaveWarning('Задание добавлено, но не сохранилось.');
      else this.toast('Задание добавлено.');
      input.focus();
    });
    document.querySelector('#manageTasks').addEventListener('change', event => {
      const input = event.target.closest('[data-points-id]');
      if (!input) return;
      const points = Number(input.value);
      if (!Number.isInteger(points) || points < 0) {
        this.renderer.renderSettings();
        this.toast('Баллы: целое число 0 или больше.');
        return;
      }
      const ok = this.state.setTaskPoints(input.dataset.pointsId, points);
      this.renderer.renderAll();
      if (!ok) this.showSaveWarning();
      else this.toast('Баллы за задание обновлены.');
    });
    document.querySelector('#manageTasks').addEventListener('click', event => {
      const button = event.target.closest('[data-delete-id]');
      if (!button) return;
      const task = this.state.data.tasks.find(item => item.id === button.dataset.deleteId);
      if (!task) return;
      if (!window.confirm(`Удалить задание «${task.title}»? Баллы за сегодня с него тоже снимутся.`)) return;
      const ok = this.state.removeTask(task.id);
      this.renderer.renderAll();
      if (!ok) this.showSaveWarning('Задание удалено, но не сохранилось.');
      else this.toast('Задание удалено.');
    });
    document.querySelector('#savePinButton').addEventListener('click', () => {
      const input = document.querySelector('#pinInput');
      const value = input.value.trim();
      if (!PIN_PATTERN.test(value)) {
        this.feedback('#pinFeedback', 'PIN: от 4 до 8 цифр.', true);
        return;
      }
      const ok = this.state.setPin(value);
      input.value = '';
      this.feedback('#pinFeedback', ok ? 'PIN обновлён.' : 'PIN изменён, но сохранить не удалось.');
      if (!ok) this.showSaveWarning();
    });
    document.querySelector('#switchRoleButton').addEventListener('click', () => this.openRoleModal());
    document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.role === 'parent') this.showPinForm(this.state.hasPin() ? 'enter' : 'setup');
      else this.setRoleAndClose('student');
    }));
    document.querySelector('#pinForm').addEventListener('submit', event => {
      event.preventDefault();
      this.submitPin();
    });
    document.querySelector('#roleModalClose').addEventListener('click', () => this.closeRoleModal());
    document.querySelector('#roleModal').addEventListener('click', event => {
      if (event.target === event.currentTarget) this.closeRoleModal();
    });
    document.querySelector('#roleModal').addEventListener('keydown', event => this.trapFocus(event));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.querySelector('#roleModal').classList.contains('hidden')) this.closeRoleModal(true);
    });
  }
  changeMonth(step) {
    const current = this.state.calendarDate;
    const target = new Date(current.getFullYear(), current.getMonth() + step, 1);
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (step > 0 && target > thisMonth) return;
    this.state.calendarDate = target;
    if (monthKey(new Date(`${this.state.selectedDate}T12:00:00`)) !== monthKey(target)) {
      this.state.selectedDate = monthKey(target) === monthKey(now) ? dateKey(now) : dateKey(target);
    }
    this.renderer.renderCalendar();
    this.renderer.renderSelectedDay();
  }
  openRoleModal() {
    this.pinMode = 'enter';
    document.querySelector('#roleModal').classList.remove('hidden');
    document.querySelector('.role-options').classList.remove('hidden');
    document.querySelector('#pinForm').classList.add('hidden');
    document.querySelector('#modalPinInput').value = '';
    this.setPinError('');
    const panel = document.querySelector('.modal-panel');
    if (panel && typeof panel.focus === 'function') panel.focus({ preventScroll: true });
  }
  closeRoleModal(returnFocus = false) {
    document.querySelector('#roleModal').classList.add('hidden');
    if (!this.state.role) {
      this.state.setRole('student');
      this.renderer.renderAll();
    }
    if (returnFocus) document.querySelector('#switchRoleButton').focus();
  }
  showPinForm(mode) {
    this.pinMode = mode;
    this.pinAttempts = 0;
    this.setPinError('');
    document.querySelector('.role-options').classList.add('hidden');
    const input = document.querySelector('#modalPinInput');
    input.value = '';
    input.setAttribute('autocomplete', mode === 'setup' ? 'new-password' : 'current-password');
    document.querySelector('#pinFormLabel').textContent = mode === 'setup' ? 'Придумайте PIN: 4–8 цифр' : 'Введите PIN родителя';
    document.querySelector('#pinFormButton').textContent = mode === 'setup' ? 'Сохранить PIN и войти' : 'Войти';
    document.querySelector('#pinForm').classList.remove('hidden');
    input.focus();
  }
  submitPin() {
    const input = document.querySelector('#modalPinInput');
    const value = input.value.trim();
    if (this.pinMode === 'setup') {
      if (!PIN_PATTERN.test(value)) {
        this.setPinError('PIN: от 4 до 8 цифр.');
        return;
      }
      const ok = this.state.setPin(value);
      this.setRoleAndClose('parent');
      if (ok) this.toast('PIN сохранён. Он понадобится при входе родителя.');
      else this.showSaveWarning('PIN сохранён на время сеанса, но сохранить не удалось.');
      return;
    }
    const wait = this.pinLockedUntil - Date.now();
    if (wait > 0) {
      this.setPinError(`Слишком много попыток. Подождите ${Math.ceil(wait / 1000)} с.`);
      return;
    }
    if (value === this.state.data.pin) {
      this.pinAttempts = 0;
      this.pinLockedUntil = 0;
      this.setRoleAndClose('parent');
      return;
    }
    this.pinAttempts += 1;
    const left = 5 - this.pinAttempts;
    if (left <= 0) {
      this.pinLockedUntil = Date.now() + 30000;
      this.pinAttempts = 0;
      this.setPinError('Слишком много попыток. Подождите 30 секунд.');
    } else {
      this.setPinError(`PIN не подошёл. Осталось попыток: ${left}.`);
    }
    input.value = '';
    input.focus();
  }
  setPinError(text) {
    document.querySelector('#pinError').textContent = text;
  }
  trapFocus(event) {
    if (event.key !== 'Tab') return;
    const modal = document.querySelector('#roleModal');
    const focusable = [...modal.querySelectorAll('button, input')].filter(element => !element.closest('.hidden') && !element.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  setRoleAndClose(role) {
    this.state.setRole(role);
    document.querySelector('#roleModal').classList.add('hidden');
    this.renderer.renderAll();
    const heading = document.querySelector('#greeting');
    if (heading && typeof heading.focus === 'function') heading.focus({ preventScroll: true });
  }
  feedback(selector, text, error = false, duration = 3000) {
    const element = document.querySelector(selector);
    if (!element) return;
    element.textContent = text;
    element.classList.toggle('error', error);
    clearTimeout(this.feedbackTimers[selector]);
    this.feedbackTimers[selector] = setTimeout(() => {
      element.textContent = '';
      element.classList.remove('error');
    }, error ? Math.max(duration, 5000) : duration);
  }
  showSaveWarning(message = 'Не удалось сохранить изменения: браузер не даёт место или запрещает хранение.') {
    if (this.saveWarned) return;
    this.saveWarned = true;
    this.toast(message);
  }
  toast(text) {
    const element = document.querySelector('#toast');
    element.textContent = text;
    element.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
  }
}

document.addEventListener('DOMContentLoaded', () => new AppController());
