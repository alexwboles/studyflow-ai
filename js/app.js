/* StudyFlow UI — vanilla JS, localStorage persistence, no network required. */
(function () {
  'use strict';
  var L = window.StudyFlow;
  var LS_KEY = 'studyflow.v1';
  var LS_AIKEY = 'studyflow.openai_key';

  function el(tag, cls, text) {    var e = document.createElement(tag);
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

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

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
    if (rating === 'again') tp.againCount = (tp.againCount || 0) + 1;
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
      updateHeaderStats();
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
    var exp = el('button', 'btn', 'Export backup (.json)');
    exp.onclick = function () {
      if (!state.plan) { alert('Nothing to export yet — generate a plan first.'); return; }
      downloadText('studyflow-backup.json', L.serializeState(state), 'application/json');
    };
    var imp = el('button', 'btn', 'Import backup');
    var impFile = document.createElement('input');
    impFile.type = 'file'; impFile.accept = 'application/json'; impFile.style.display = 'none';
    impFile.onchange = function () {
      var f = impFile.files && impFile.files[0];
      impFile.value = '';
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          state = L.parseStateImport(String(r.result));
          save(state);
          renderSetup();
          alert('Backup imported: ' + state.plan.days.length + ' plan days restored.');
        } catch (e) {
          alert('Import failed: ' + e.message);
        }
      };
      r.readAsText(f);
    };
    imp.onclick = function () { impFile.click(); };
    actions.appendChild(exp); actions.appendChild(imp); actions.appendChild(impFile);
    wrap.appendChild(actions);
    wrap.appendChild(el('div', null, '')).id = 'setup-warnings';
  }

  /* ---------- today: deck dashboard ---------- */
  function dueCountsFor(dateStr) {
    var counts = { learn: 0, review: 0, bySubject: {} };
    if (!state.plan) return counts;
    state.plan.days.forEach(function (d) {
      if (d.date !== dateStr) return;
      d.items.forEach(function (it) {
        if (isDone(dateStr, it.key)) return;
        if (it.type === 'learn') counts.learn++;
        else counts.review++;
        var s = counts.bySubject[it.subject] || (counts.bySubject[it.subject] = { learn: 0, review: 0 });
        if (it.type === 'learn') s.learn++; else s.review++;
      });
    });
    return counts;
  }

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

    // Due-today hero (Anki due-count language)
    var due = dueCountsFor(t);
    var hero = el('div', 'card due-hero');
    var heroTop = el('div', 'due-top');
    heroTop.appendChild(el('div', 'due-label', 'Due today'));
    heroTop.appendChild(el('div', 'due-num', String(due.learn + due.review)));
    hero.appendChild(heroTop);
    var chips = el('div', 'due-chips');
    chips.appendChild(el('span', 'due-chip new', due.learn + ' new'));
    chips.appendChild(el('span', 'due-chip review', due.review + ' to review'));
    hero.appendChild(chips);
    var deck = L.drillDeck(state.plan, state.days, t);
    if (deck.length) {
      var study = el('button', 'btn primary big', 'Study now — ' + deck.length + ' cards');
      study.onclick = function () { startReview(deck, "Today's queue"); };
      hero.appendChild(study);
      hero.appendChild(el('p', 'muted small', 'Flip each card, then rate your recall. The scheduler sets the next review.'));
    } else {
      hero.appendChild(el('p', 'muted', due.learn + due.review === 0
        ? 'All clear. Rest or get ahead.'
        : 'No drill cards with key points — work through the plan below.'));
    }
    wrap.appendChild(hero);

    // Deck cards per subject
    var decks = el('div', 'deck-grid');
    (state.config.subjects || []).forEach(function (s, si) {
      var c = due.bySubject[s.name] || { learn: 0, review: 0 };
      var card = el('button', 'deck-card');
      card.appendChild(el('div', 'deck-name', s.name));
      var dc = el('div', 'due-chips small');
      dc.appendChild(el('span', 'due-chip new', c.learn + ' new'));
      dc.appendChild(el('span', 'due-chip review', c.review + ' due'));
      card.appendChild(dc);
      var learnedN = s.topics.filter(function (_, ti) {
        var tp = state.topics[si + ':' + ti];
        return tp && tp.learned;
      }).length;
      card.appendChild(el('div', 'deck-meta muted small',
        learnedN + ' of ' + s.topics.length + ' topics learned'));
      card.onclick = function () { showTab('cards'); };
      decks.appendChild(card);
    });
    if ((state.config.subjects || []).length) {
      wrap.appendChild(el('h3', null, 'Decks'));
      wrap.appendChild(decks);
    }

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

    wrap.appendChild(el('h3', null, "Today's plan"));
    day.items.forEach(function (item) {      var card = el('div', 'card item ' + item.type + (isDone(t, item.key) ? ' done' : ''));
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
    var ics = el('button', 'btn small', 'Download .ics');
    ics.title = 'Add the whole study schedule to your calendar';
    ics.onclick = function () {
      if (!state.plan) return;
      downloadText('studyflow-schedule.ics', L.planToICS(state.plan), 'text/calendar;charset=utf-8');
    };
    bar.appendChild(search); bar.appendChild(print); bar.appendChild(ics);
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

    // readiness forecast: projected completion by exam day at current pace
    var fc = L.forecastReadiness(state.topics, counts, state.days, state.config.examDate, todayISO());
    var fcard = el('div', 'card');
    fcard.appendChild(el('h3', null, 'Forecast — ' + fc.verdict));
    fcard.appendChild(el('p', 'muted small',
      'At your current pace (' + fc.pacePerDay + ' reviews/day) you project ' +
      Math.round(fc.projectedPct * 100) + '% review completion by exam day — ' +
      fc.reviewsDone + ' of ' + fc.totalReviews + ' reviews done, ' + fc.daysLeft + ' days left.'));
    wrap.appendChild(fcard);

    // weak spots: lowest-readiness topics first
    var weak = L.weakSpots(state.topics, counts, state.config.subjects, 5);
    if (weak.length) {
      var wcard = el('div', 'card');
      wcard.appendChild(el('h3', null, 'Weak spots — drill these first'));
      weak.forEach(function (w) {
        wcard.appendChild(el('p', 'small',
          w.subject + ' — ' + w.topic + ': ' + Math.round(w.readiness * 100) + '% ready' +
          (w.againCount ? ' · forgotten ' + w.againCount + '×' : '') +
          ' · ease ' + w.ef.toFixed(1)));
      });
      wrap.appendChild(wcard);
    }

    // 8-week activity heatmap
    var hcard = el('div', 'card');
    hcard.appendChild(el('h3', null, 'Activity — last 8 weeks'));
    var grid = el('div', 'heat-grid');
    L.studyWeeks(dayDoneCounts(), todayISO()).forEach(function (wk) {
      var col = el('div', 'heat-col');
      wk.days.forEach(function (d) {
        var cell = el('div', 'heat-cell heat-' + d.level);
        cell.title = d.date + ': ' + d.done + '/' + d.total + ' done';
        col.appendChild(cell);
      });
      grid.appendChild(col);
    });
    hcard.appendChild(grid);
    hcard.appendChild(el('p', 'muted small', 'Each column is one week (Mon–Sun); darker green means more of the day finished.'));
    wrap.appendChild(hcard);
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

  /* ---------- review room (Anki pattern: flip, then Again/Hard/Good/Easy) ---------- */
  var review = null; // {cards, idx, date, startedAt, ratings, deck}

  function intervalLabel(days) {
    if (days <= 1) return '1d';
    if (days < 30) return days + 'd';
    return Math.round(days / 30) + 'mo';
  }

  function previewInterval(card, rating) {
    var tp = state.topics[card.id] || { ef: 2.5, interval: 1 };
    try {
      var res = L.updateSchedule({ ef: tp.ef, interval: tp.interval }, rating,
        review.date, state.config.examDate);
      return intervalLabel(res.interval);
    } catch (e) { return '—'; }
  }

  function startReview(cards, deckName) {
    if (!cards || !cards.length) return;
    review = {
      cards: cards.slice(), idx: 0, date: todayISO(), startedAt: Date.now(),
      ratings: { again: 0, hard: 0, good: 0, easy: 0 }, deck: deckName || "Today's queue"
    };
    document.getElementById('sessionSummary').hidden = true;
    document.getElementById('reviewRoom').hidden = false;
    document.body.classList.add('reviewing');
    renderReviewCard();
  }

  function renderReviewCard() {
    var card = review.cards[review.idx];
    document.getElementById('rrDeck').textContent = review.deck;
    document.getElementById('rrProgress').textContent =
      'Card ' + (review.idx + 1) + ' of ' + review.cards.length;
    var badge = document.getElementById('rrBadge');
    badge.textContent = card.type === 'learn' ? 'LEARN' : 'REVIEW';
    badge.className = 'rr-badge ' + card.type;
    document.getElementById('rrTopic').textContent = card.topic;
    document.getElementById('rrSubject').textContent = card.subject;
    var ans = document.getElementById('rrAnswer');
    ans.innerHTML = '';
    (card.keyPoints || []).forEach(function (k) {
      var li = document.createElement('li');
      li.textContent = k;
      ans.appendChild(li);
    });
    if (!(card.keyPoints || []).length) {
      var li2 = document.createElement('li');
      li2.className = 'muted';
      li2.textContent = 'No key points — mark how it went from memory.';
      ans.appendChild(li2);
    }
    ans.hidden = true;
    document.getElementById('rrFlip').hidden = false;
    document.getElementById('rrRates').hidden = true;
  }

  function reviewFlip() {
    if (!review || !document.getElementById('rrFlip') || document.getElementById('rrFlip').hidden) return;
    document.getElementById('rrAnswer').hidden = false;
    document.getElementById('rrFlip').hidden = true;
    document.getElementById('rrRates').hidden = false;
    var card = review.cards[review.idx];
    ['again', 'hard', 'good', 'easy'].forEach(function (r) {
      document.getElementById('int-' + r).textContent = previewInterval(card, r);
    });
  }

  function reviewRate(rating) {
    if (!review || document.getElementById('rrRates').hidden) return;
    var card = review.cards[review.idx];
    rateReview(review.date, { id: card.id, key: card.key, type: card.type }, rating);
    review.ratings[rating]++;
    review.idx++;
    if (review.idx >= review.cards.length) { endReview(true); return; }
    renderReviewCard();
  }

  function endReview(completed) {
    var r = review;
    review = null;
    document.getElementById('reviewRoom').hidden = true;
    document.body.classList.remove('reviewing');
    if (r && completed) showSummary(r);
    render();
  }

  function sumCell(val, label) {
    return '<div class="sum-cell"><div class="sum-val">' + esc(val) + '</div>' +
      '<div class="sum-label">' + esc(label) + '</div></div>';
  }

  function showSummary(r) {
    var total = r.ratings.again + r.ratings.hard + r.ratings.good + r.ratings.easy;
    var mins = Math.max(1, Math.round((Date.now() - r.startedAt) / 60000));
    var againPct = total ? Math.round(r.ratings.again / total * 100) : 0;
    var streak = L.computeStreak(dayDoneCounts(), todayISO());
    document.getElementById('sumGrid').innerHTML =
      sumCell(String(total), 'cards reviewed') +
      sumCell(againPct + '%', 'rated Again') +
      sumCell(mins + ' min', 'session time') +
      sumCell(streak + (streak === 1 ? ' day' : ' days'), 'streak');
    document.getElementById('sessionSummary').hidden = false;
    document.body.classList.add('reviewing');
  }

  function closeSummary() {
    document.getElementById('sessionSummary').hidden = true;
    document.body.classList.remove('reviewing');
    showTab('today');
  }

  /* ---------- flashcards ---------- */
  /* ---------- flashcards ---------- */
  var drill = null; // legacy entry point — the drill now runs in the review room

  function renderDrill() {
    var t = todayISO();
    var deck = state.plan ? L.drillDeck(state.plan, state.days, t) : [];
    if (deck.length) startReview(deck, 'Self-test drill');
    drill = null;
  }

  function renderCards() {
    var wrap = document.getElementById('view-cards');
    wrap.innerHTML = '';
    if (!state.config) { wrap.appendChild(el('p', 'muted', 'No subjects yet.')); return; }
    wrap.appendChild(el('h2', null, 'Flashcards'));

    // Self-test drill: one card at a time from today's undone queue items,
    // rated Again/Hard/Good/Easy so the SM-2 scheduler adapts.
    var t = todayISO();
    var deck = state.plan ? L.drillDeck(state.plan, state.days, t) : [];
    if (deck.length) {
      var cta = el('div', 'card drill-cta');
      cta.appendChild(el('p', null, 'Self-test drill: ' + deck.length +
        ' cards from today\'s queue. Flip each one, then rate your recall — ratings feed the spaced-repetition scheduler.'));
      var start = el('button', 'btn primary', 'Start drill');
      start.onclick = function () { drill = { cards: deck, idx: 0, date: t }; renderDrill(); };
      cta.appendChild(start);
      wrap.appendChild(cta);
    } else if (state.plan) {
      wrap.appendChild(el('p', 'muted', 'No drill cards right now — today\'s queue items with key points are all done.'));
    }
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
  function updateHeaderStats() {
    var sn = document.getElementById('streakNum');
    if (sn) sn.textContent = state.plan ? L.computeStreak(dayDoneCounts(), todayISO()) : 0;
    var ep = document.getElementById('examPill');
    if (ep) {
      if (state.config && state.config.examDate) {
        var n = L.daysBetween(todayISO(), state.config.examDate);
        ep.textContent = n <= 0 ? 'Exam day' : n + (n === 1 ? ' day' : ' days') + ' to exam';
      } else {
        ep.textContent = '';
      }
    }
  }

  function render() {
    updateHeaderStats();
    var active = document.querySelector('#tabs button.active');
    showTab(active ? active.dataset.tab : (state.plan ? 'today' : 'setup'));
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.onclick = function () { showTab(b.dataset.tab); };
    });
    // Review room controls + keyboard (Anki: Space to flip, 1-4 to rate).
    document.getElementById('rrFlip').onclick = reviewFlip;
    document.getElementById('rrEnd').onclick = function () { endReview(false); };
    document.getElementById('sumDone').onclick = closeSummary;
    document.querySelectorAll('.rr-rates .rate').forEach(function (b) {
      b.onclick = function () { reviewRate(b.dataset.rating); };
    });
    document.addEventListener('keydown', function (e) {
      var rr = document.getElementById('reviewRoom');
      if (!review || rr.hidden) return;
      var flipHidden = document.getElementById('rrFlip').hidden;
      var ratesHidden = document.getElementById('rrRates').hidden;
      if (e.code === 'Space' && !flipHidden) { e.preventDefault(); reviewFlip(); }
      else if (!ratesHidden) {
        var map = { Digit1: 'again', Digit2: 'hard', Digit3: 'good', Digit4: 'easy',
                    Numpad1: 'again', Numpad2: 'hard', Numpad3: 'good', Numpad4: 'easy' };
        if (map[e.code]) { e.preventDefault(); reviewRate(map[e.code]); }
      } else if (e.key === 'Escape') { endReview(false); }
    });
    render();
  });
})();
