/* StudyFlow UI — vanilla JS, localStorage persistence, no network required. */
(function () {
  'use strict';
  var L = window.StudyFlow;
  var LS_KEY = 'studyflow.v1';
  var LS_AIKEY = 'studyflow.openai_key';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- focus timer (Today tab) ---------- */
  var timerLeft = 0, timerTotal = 0, timerId = null;
  function timerPaint() {
    var d = document.getElementById('timer-display');
    if (d) d.textContent = L.formatClock(timerLeft);
    var st = document.getElementById('timer-state');
    if (st) st.textContent = timerId ? (timerLeft <= 0 ? 'Done — take a breath.' : 'Focusing…') : (timerLeft > 0 ? 'Paused' : 'Ready');
    var btn = document.getElementById('timer-toggle');
    if (btn) btn.textContent = timerId ? 'Pause' : 'Start';
  }
  function timerTick() {
    timerLeft--;
    if (timerLeft <= 0) {
      timerLeft = 0;
      clearInterval(timerId); timerId = null;
    }
    timerPaint();
  }
  function timerToggle() {
    if (timerId) { clearInterval(timerId); timerId = null; timerPaint(); return; }
    if (timerLeft <= 0) {
      var mins = parseInt((document.getElementById('timer-mins') || {}).value, 10);
      timerTotal = timerLeft = (mins > 0 && mins <= 180 ? mins : 25) * 60;
    }
    timerId = setInterval(timerTick, 1000);
    timerPaint();
  }
  function timerReset() {
    if (timerId) { clearInterval(timerId); timerId = null; }
    timerLeft = 0; timerTotal = 0;
    timerPaint();
  }
  function renderTimerCard(wrap) {
    var card = el('div', 'card timer-card');
    card.appendChild(el('h3', null, 'Focus timer'));
    var row = el('div', 'actions');
    var mins = el('input'); mins.type = 'number'; mins.min = '1'; mins.max = '180';
    mins.value = '25'; mins.id = 'timer-mins'; mins.setAttribute('aria-label', 'Focus minutes');
    var disp = el('span', 'timer-display'); disp.id = 'timer-display';
    disp.textContent = L.formatClock(timerLeft);
    var toggle = el('button', 'btn small primary', timerId ? 'Pause' : 'Start');
    toggle.id = 'timer-toggle'; toggle.onclick = timerToggle;
    var reset = el('button', 'btn small', 'Reset');
    reset.onclick = timerReset;
    var state = el('span', 'muted small'); state.id = 'timer-state';
    row.appendChild(mins); row.appendChild(disp); row.appendChild(toggle); row.appendChild(reset); row.appendChild(state);
    card.appendChild(row);
    card.appendChild(el('p', 'muted small', 'Set minutes, hit Start, and work one item at a time.'));
    wrap.appendChild(card);
    timerPaint();
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch (e) { return null; }
  }
  function save(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

  var state = load() || { config: null, plan: null, topics: {}, days: {} };

  function scheduledCounts() {
    var counts = {};
    if (!state.plan) return counts;
    state.plan.days.forEach(function (d) {
      d.items.forEach(function (it) {
        if (it.type === 'review') counts[it.id] = (counts[it.id] || 0) + 1;
      });
    });
    return counts;
  }

  function todayISO() { return L.todayStr(); }

  function isDone(dateStr, key) {
    var rec = state.days[dateStr];
    return !!(rec && rec.done.indexOf(key) !== -1);
  }

  function markDone(dateStr, key, item) {
    var rec = state.days[dateStr] || (state.days[dateStr] = { done: [] });
    if (rec.done.indexOf(key) === -1) rec.done.push(key);
    var tp = state.topics[item.id] || (state.topics[item.id] = { learned: false, reviewsDone: 0, ef: 2.5, interval: 1 });
    if (item.type === 'learn') {
      tp.learned = true;
      tp.learnedDate = dateStr;
    }
    save(state);
    render();
  }

  function markUndone(dateStr, key) {
    var rec = state.days[dateStr];
    if (rec) rec.done = rec.done.filter(function (k) { return k !== key; });
    save(state);
    render();
  }

  function rateReview(dateStr, item, rating) {
    var tp = state.topics[item.id] || (state.topics[item.id] = { learned: true, reviewsDone: 0, ef: 2.5, interval: 1 });
    var res = L.updateSchedule({ ef: tp.ef, interval: tp.interval }, rating, dateStr, state.config.examDate);
    tp.ef = res.ef;
    tp.interval = res.interval;
    tp.nextReview = res.nextReview;
    tp.reviewsDone = (tp.reviewsDone || 0) + 1;
    tp.lastRating = rating;
    markDone(dateStr, item.key, item);
  }

  /* ---------- tabs ---------- */
  var tabs = ['setup', 'today', 'schedule', 'progress', 'cards'];
  function showTab(name) {
    tabs.forEach(function (t) {
      document.getElementById('tab-' + t).classList.toggle('active', t === name);
      document.getElementById('view-' + t).classList.toggle('active', t === name);
    });
    if (name === 'today') renderToday();
    if (name === 'schedule') renderSchedule();
    if (name === 'progress') renderProgress();
    if (name === 'cards') renderCards();
    if (name === 'setup') renderSetup();
  }

  /* ---------- setup ---------- */
  function renderSetup() {
    var wrap = document.getElementById('view-setup');
    wrap.innerHTML = '';
    var cfg = state.config || { subjects: [], examDate: '', dailyMinutes: 60 };

    wrap.appendChild(el('h2', null, 'Your exam plan'));

    // subjects editor
    var subjBox = el('div', 'card');
    subjBox.appendChild(el('h3', null, 'Subjects & topics'));
    var list = el('div', 'subj-list');

    function drawSubjects() {
      list.innerHTML = '';
      cfg.subjects.forEach(function (s, si) {
        var card = el('div', 'subj');
        var head = el('div', 'subj-head');
        var nameInput = el('input');
        nameInput.value = s.name;
        nameInput.placeholder = 'Subject name (e.g. Biology)';
        nameInput.oninput = function () { s.name = nameInput.value; };
        var del = el('button', 'btn small danger', 'Remove');
        del.onclick = function () { cfg.subjects.splice(si, 1); drawSubjects(); };
        head.appendChild(nameInput); head.appendChild(del);
        card.appendChild(head);
        var topics = el('div', 'topics');
        s.topics.forEach(function (t, ti) {
          var row = el('div', 'topic-row');
          var tn = el('input'); tn.value = t.name; tn.placeholder = 'Topic (e.g. Cell division)';
          tn.oninput = function () { t.name = tn.value; };
          var kp = el('input'); kp.value = (t.keyPoints || []).join('; ');
          kp.placeholder = 'Key points, separated by ;';
          kp.oninput = function () { t.keyPoints = kp.value.split(';').map(function (x) { return x.trim(); }).filter(Boolean); };
          var td = el('button', 'btn small danger', '×');
          td.title = 'Remove topic';
          td.onclick = function () { s.topics.splice(ti, 1); drawSubjects(); };
          row.appendChild(tn); row.appendChild(kp); row.appendChild(td);
          topics.appendChild(row);
        });
        var addT = el('button', 'btn small', '+ Add topic');
        addT.onclick = function () { s.topics.push({ name: '', keyPoints: [] }); drawSubjects(); };
        card.appendChild(topics); card.appendChild(addT);
        list.appendChild(card);
      });
      if (!cfg.subjects.length) list.appendChild(el('p', 'muted', 'No subjects yet — add your first one below.'));
    }
    drawSubjects();
    var addS = el('button', 'btn', '+ Add subject');
    addS.onclick = function () { cfg.subjects.push({ name: '', topics: [{ name: '', keyPoints: [] }] }); drawSubjects(); };
    subjBox.appendChild(list); subjBox.appendChild(addS);
    wrap.appendChild(subjBox);

    // exam settings
    var set = el('div', 'card');
    set.appendChild(el('h3', null, 'Exam & time'));
    var examRow = el('label', null, 'Exam date: ');
    var exam = el('input'); exam.type = 'date'; exam.value = cfg.examDate || '';
    exam.onchange = function () { cfg.examDate = exam.value; };
    examRow.appendChild(exam); set.appendChild(examRow);
    var minRow = el('label', null, 'Daily study minutes: ');
    var mins = el('input'); mins.type = 'number'; mins.min = '10'; mins.max = '480'; mins.value = cfg.dailyMinutes || 60;
    mins.onchange = function () { cfg.dailyMinutes = Number(mins.value) || 60; };
    minRow.appendChild(mins); set.appendChild(minRow);

    var keyRow = el('label', null, 'OpenAI key (optional, for AI topic explanations): ');
    var keyInput = el('input');
    keyInput.type = 'password';
    keyInput.placeholder = 'sk-... (never required)';
    keyInput.value = localStorage.getItem(LS_AIKEY) || '';
    keyInput.onchange = function () {
      if (keyInput.value) localStorage.setItem(LS_AIKEY, keyInput.value);
      else localStorage.removeItem(LS_AIKEY);
    };
    keyRow.appendChild(keyInput); set.appendChild(keyRow);
    set.appendChild(el('p', 'muted small', 'Everything works offline without a key. The key only powers optional "Explain" buttons on flashcards and never leaves your browser except to api.openai.com.'));
    wrap.appendChild(set);

    var actions = el('div', 'actions');
    var gen = el('button', 'btn primary', 'Generate my study plan');
    gen.onclick = function () {
      cfg.subjects = cfg.subjects.filter(function (s) { return s.name.trim(); });
      cfg.subjects.forEach(function (s) {
        s.topics = s.topics.filter(function (t) { return t.name.trim(); });
      });
      var plan = L.generatePlan(cfg, todayISO());
      var warnBox = document.getElementById('setup-warnings');
      warnBox.innerHTML = '';
      if (plan.error) {
        warnBox.appendChild(el('p', 'error', plan.error));
        return;
      }
      state.config = cfg;
      state.plan = plan;
      state.topics = {};
      state.days = {};
      save(state);
      plan.warnings.forEach(function (w) { warnBox.appendChild(el('p', 'warn', w)); });
      warnBox.appendChild(el('p', 'ok', 'Plan ready: ' + plan.topicCount + ' topics over ' + plan.days.length + ' days. See the Today tab.'));
    };
    var demo = el('button', 'btn', 'Load demo data');
    demo.onclick = function () {
      var in14 = L.addDaysStr(todayISO(), 14);
      cfg = {
        examDate: in14, dailyMinutes: 60,
        subjects: [
          { name: 'Biology', topics: [
            { name: 'Cell division', keyPoints: ['Mitosis phases: PMAT', 'Meiosis halves chromosome number'] },
            { name: 'Genetics', keyPoints: ['Punnett squares', 'Dominant vs recessive'] },
            { name: 'Ecology', keyPoints: ['Food webs', 'Carrying capacity'] }
          ]},
          { name: 'History', topics: [
            { name: 'World War I', keyPoints: ['1914-1918', 'Treaty of Versailles'] },
            { name: 'Cold War', keyPoints: ['1947-1991', 'Cuban Missile Crisis 1962'] }
          ]},
          { name: 'Spanish', topics: [
            { name: 'Preterite tense', keyPoints: ['-é, -aste, -ó endings', 'Irregular: fui, tuve'] },
            { name: 'Subjunctive', keyPoints: ['Used for wishes/doubt', 'Trigger phrases: quiero que'] }
          ]}
        ]
      };
      state.config = cfg;
      renderSetup();
    };
    actions.appendChild(gen); actions.appendChild(demo);
    wrap.appendChild(actions);
    wrap.appendChild(el('div', null, '')).id = 'setup-warnings';
  }

  /* ---------- today ---------- */
  function renderToday() {
    var wrap = document.getElementById('view-today');
    wrap.innerHTML = '';
    if (!state.plan) { wrap.appendChild(el('p', 'muted', 'No plan yet — set things up first.')); return; }
    var t = todayISO();
    var day = null;
    state.plan.days.forEach(function (d) { if (d.date === t) day = d; });

    var examIn = L.daysBetween(t, state.config.examDate);
    wrap.appendChild(el('h2', null, 'Today — ' + t));
    wrap.appendChild(el('p', 'muted', examIn === 0 ? 'Exam day. You\'ve got this.' : examIn + ' day' + (examIn === 1 ? '' : 's') + ' until the exam.'));

    renderTimerCard(wrap);

    // Catch-up backlog: undone items from earlier days.
    var backlog = L.backlogItems(state.plan, state.days, t);
    if (backlog.length) {
      var bc = el('div', 'card backlog');
      bc.appendChild(el('h3', null, 'Catch up (' + backlog.length + ' missed)'));
      bc.appendChild(el('p', 'muted small', 'Items from earlier days you never marked done. Clear them before they pile up.'));
      backlog.forEach(function (entry) {
        var it = entry.item;
        var line = el('div', 'backlog-row');
        line.appendChild(el('span', 'badge ' + it.type, it.type === 'learn' ? 'LEARN' : 'REVIEW'));
        var lbl = el('span', 'small', ' ' + it.subject + ' — ' + it.topic + ' ');
        var when = el('span', 'muted small', '(' + entry.date + ')');
        var done = el('button', 'btn small', 'Mark done');
        done.onclick = (function (d, k, item) {
          return function () { markDone(d, k, item); };
        })(entry.date, it.key, it);
        line.appendChild(lbl); line.appendChild(when); line.appendChild(done);
        bc.appendChild(line);
      });
      wrap.appendChild(bc);
    }

    if (!day || !day.items.length) {
      wrap.appendChild(el('p', 'muted', 'Nothing scheduled today. Rest or get ahead.'));
      return;
    }

    // Postpone: push today's unfinished items to tomorrow.
    var undoneToday = day.items.filter(function (it) { return !isDone(t, it.key); });
    var isLastDay = t === state.plan.days[state.plan.days.length - 1].date;
    if (undoneToday.length && !isLastDay) {
      var prow = el('div', 'actions');
      var post = el('button', 'btn small', 'Move ' + undoneToday.length + ' unfinished to tomorrow');
      post.title = 'Postpone';
      post.onclick = function () {
        var res = L.postponeDay(state.plan, state.days, t);
        if (res.moved > 0) {
          state.plan = res.plan;
          save(state);
          render();
        }
      };
      prow.appendChild(post);
      wrap.appendChild(prow);
    }

    day.items.forEach(function (item) {
      var card = el('div', 'card item ' + item.type + (isDone(t, item.key) ? ' done' : ''));
      var title = el('div', 'item-title');
      title.appendChild(el('span', 'badge ' + item.type, item.type === 'learn' ? 'LEARN' : 'REVIEW'));
      title.appendChild(el('strong', null, ' ' + item.subject + ' — ' + item.topic));
      card.appendChild(title);
      card.appendChild(el('p', 'muted small', item.minutes + ' min'));

      if (isDone(t, item.key)) {
        var undo = el('button', 'btn small', 'Undo');
        undo.onclick = function () { markUndone(t, item.key); };
        card.appendChild(undo);
      } else if (item.type === 'learn') {
        var done = el('button', 'btn primary small', 'Mark studied');
        done.onclick = function () { markDone(t, item.key, item); };
        card.appendChild(done);
      } else {
        card.appendChild(el('p', 'small', 'How well did you recall it?'));
        var row = el('div', 'actions');
        [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']].forEach(function (r) {
          var b = el('button', 'btn small' + (r[0] === 'good' ? ' primary' : ''), r[1]);
          b.onclick = function () { rateReview(t, item, r[0]); };
          row.appendChild(b);
        });
        card.appendChild(row);
      }
      wrap.appendChild(card);
    });
  }

  /* ---------- schedule ---------- */
  var scheduleQuery = '';

  function printSchedule() {
    if (!state.plan) return;
    var w = window.open('', '_blank');
    if (!w) return;
    var txt = L.exportPlanText(state.plan, state.config);
    w.document.write('<html><head><title>StudyFlow schedule</title></head><body>' +
      '<pre style="font-family:monospace;white-space:pre-wrap">' + esc(txt) + '</pre>' +
      '</body></html>');
    w.document.close();
    w.focus();
    w.print();
  }

  function drawScheduleList() {
    var list = document.getElementById('schedule-list');
    if (!list || !state.plan) return;
    list.innerHTML = '';
    var days = L.filterSchedule(state.plan, scheduleQuery);
    if (!days.length) {
      list.appendChild(el('p', 'muted', scheduleQuery ? 'No items match "' + scheduleQuery + '".' : 'No plan yet.'));
      return;
    }
    days.forEach(function (d, i) {
      var card = el('div', 'card day');
      var label = d.date + (i === state.plan.days.length - 1 && !scheduleQuery ? ' — EXAM DAY' : '');
      card.appendChild(el('h4', null, label));
      if (!d.items.length) { card.appendChild(el('p', 'muted small', 'Rest day')); }
      d.items.forEach(function (it) {
        var line = el('p', 'small' + (isDone(d.date, it.key) ? ' struck' : ''),
          (it.type === 'learn' ? 'Learn · ' : 'Review · ') + it.subject + ' — ' + it.topic + ' (' + it.minutes + 'm)');
        card.appendChild(line);
      });
      list.appendChild(card);
    });
  }

  function renderSchedule() {
    var wrap = document.getElementById('view-schedule');
    wrap.innerHTML = '';
    if (!state.plan) { wrap.appendChild(el('p', 'muted', 'No plan yet.')); return; }
    wrap.appendChild(el('h2', null, 'Full schedule'));
    var bar = el('div', 'actions sched-bar');
    var search = el('input');
    search.type = 'search';
    search.placeholder = 'Search subjects or topics…';
    search.value = scheduleQuery;
    search.setAttribute('aria-label', 'Search schedule');
    search.oninput = function () { scheduleQuery = search.value; drawScheduleList(); };
    var print = el('button', 'btn small', 'Print / export');
    print.onclick = printSchedule;
    bar.appendChild(search); bar.appendChild(print);
    wrap.appendChild(bar);
    var list = el('div', null, '');
    list.id = 'schedule-list';
    wrap.appendChild(list);
    drawScheduleList();
  }

  /* ---------- progress ---------- */
  function renderProgress() {
    var wrap = document.getElementById('view-progress');
    wrap.innerHTML = '';
    if (!state.plan) { wrap.appendChild(el('p', 'muted', 'No plan yet.')); return; }
    wrap.appendChild(el('h2', null, 'Progress'));

    var counts = scheduledCounts();
    var rep = L.readinessReport(state.topics, counts, state.config.subjects);

    var over = el('div', 'card');
    over.appendChild(el('h3', null, 'Overall readiness: ' + Math.round(rep.overall * 100) + '%'));
    over.appendChild(bar(rep.overall));
    var streak = L.computeStreak(dayDoneCounts(), todayISO());
    over.appendChild(el('p', null, 'Streak: ' + streak + ' day' + (streak === 1 ? '' : 's')));
    wrap.appendChild(over);

    rep.perSubject.forEach(function (p) {
      var c = el('div', 'card');
      c.appendChild(el('h4', null, p.subject + ' — ' + Math.round(p.readiness * 100) + '% (' + p.topics + ' topics)'));
      c.appendChild(bar(p.readiness));
      wrap.appendChild(c);
    });
  }

  function dayDoneCounts() {
    var out = {};
    if (!state.plan) return out;
    state.plan.days.forEach(function (d) {
      var rec = state.days[d.date];
      out[d.date] = { done: rec ? rec.done.length : 0, total: d.items.length };
    });
    return out;
  }

  function bar(frac) {
    var outer = el('div', 'bar');
    var inner = el('div', 'bar-fill');
    inner.style.width = Math.round(frac * 100) + '%';
    outer.appendChild(inner);
    return outer;
  }

  /* ---------- flashcards ---------- */
  function renderCards() {
    var wrap = document.getElementById('view-cards');
    wrap.innerHTML = '';
    if (!state.config) { wrap.appendChild(el('p', 'muted', 'No subjects yet.')); return; }
    wrap.appendChild(el('h2', null, 'Flashcards'));
    state.config.subjects.forEach(function (s) {
      wrap.appendChild(el('h3', null, s.name));
      s.topics.forEach(function (t) {
        var card = el('div', 'card flash');
        card.appendChild(el('strong', null, t.name));
        var kp = el('ul', 'kp hidden');
        (t.keyPoints || []).forEach(function (k) { kp.appendChild(el('li', null, k)); });
        if (!(t.keyPoints || []).length) kp.appendChild(el('li', 'muted', 'No key points — add some in Setup.'));
        var flip = el('button', 'btn small', 'Reveal key points');
        flip.onclick = function () {
          kp.classList.toggle('hidden');
          flip.textContent = kp.classList.contains('hidden') ? 'Reveal key points' : 'Hide key points';
        };
        var ai = el('button', 'btn small', 'Explain with AI');
        ai.onclick = function () { explainWithAI(ai, s.name, t.name); };
        card.appendChild(kp);
        var row = el('div', 'actions');
        row.appendChild(flip); row.appendChild(ai);
        card.appendChild(row);
        wrap.appendChild(card);
      });
    });
  }

  function explainWithAI(btn, subject, topic) {
    var key = localStorage.getItem(LS_AIKEY);
    var note = btn.parentElement.parentElement.querySelector('.ai-note') || (function () {
      var p = el('p', 'ai-note small');
      btn.parentElement.parentElement.appendChild(p);
      return p;
    })();
    if (!key) {
      note.textContent = 'Optional: add your OpenAI key in Setup to get AI explanations. Your key points above work fine without it.';
      return;
    }
    note.textContent = 'Asking AI…';
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Explain this study topic simply in 3 bullet points for exam prep. Subject: ' + subject + '. Topic: ' + topic }],
        max_tokens: 200
      })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      note.textContent = txt || 'AI had nothing to say — the key points above have you covered.';
    }).catch(function () {
      note.textContent = 'AI request failed (offline?). The key points above are still solid.';
    });
  }

  /* ---------- boot ---------- */
  function render() {
    var active = document.querySelector('#tabs button.active');
    showTab(active ? active.dataset.tab : (state.plan ? 'today' : 'setup'));
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.onclick = function () { showTab(b.dataset.tab); };
    });
    render();
  });
})();
