'use strict';
/* StudyFlow core scheduling logic.
 * Shared between the browser UI (js/app.js) and Node tests.
 * Pure functions — no DOM, no localStorage, no network.
 * Works under CommonJS (Node) and as a browser global (StudyFlow).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.StudyFlow = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  var LEARN_MINUTES = 30;
  var REVIEW_MINUTES = 10;
  var BASE_OFFSETS = [1, 3, 7, 14]; // spaced-repetition review gaps (days)

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toISO(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function parseDay(s) {
    var p = String(s).split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  }

  function addDaysStr(s, n) {
    var d = parseDay(s);
    d.setUTCDate(d.getUTCDate() + n);
    return toISO(d);
  }

  function daysBetween(a, b) {
    return Math.round((parseDay(b) - parseDay(a)) / 86400000);
  }

  function todayStr() {
    var d = new Date();
    return toISO(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
  }

  // Round-robin interleave of topics across subjects (avoids cramming one subject).
  function interleaveTopics(subjects) {
    var out = [];
    var maxLen = 0;
    subjects.forEach(function (s) {
      var n = (s.topics || []).length;
      if (n > maxLen) maxLen = n;
    });
    for (var i = 0; i < maxLen; i++) {
      subjects.forEach(function (s, si) {
        var t = (s.topics || [])[i];
        if (t) {
          out.push({
            id: si + ':' + i,
            subject: s.name,
            subjectIdx: si,
            topic: t.name,
            topicIdx: i,
            keyPoints: t.keyPoints || []
          });
        }
      });
    }
    return out;
  }

  /**
   * Generate a spaced study plan.
   * config: { subjects: [{name, topics:[{name, keyPoints:[]}]}], examDate: 'YYYY-MM-DD', dailyMinutes: number }
   * today:  'YYYY-MM-DD' (defaults to real today)
   * Returns { days:[{date, items:[{type:'learn'|'review', id, subject, topic, keyPoints, minutes, key, interval?}]}], examDate, warnings, topicCount } or { error }
   */
  function generatePlan(config, today) {
    today = today || todayStr();
    var warnings = [];
    var subjects = config.subjects || [];
    var dailyMinutes = Number(config.dailyMinutes) || 60;
    var days = daysBetween(today, config.examDate);

    if (!(days >= 1)) return { error: 'Exam date must be after today.' };

    var ordered = interleaveTopics(subjects);
    if (ordered.length === 0) return { error: 'Add at least one subject with one topic.' };

    var taperDays = days >= 5 ? 2 : 0;      // last 2 days: reviews only, lighter load
    var learnPhase = Math.max(1, days - taperDays);
    var learnsPerDay = Math.max(1, Math.floor(dailyMinutes / LEARN_MINUTES));
    var daysNeeded = Math.ceil(ordered.length / learnsPerDay);
    if (daysNeeded > learnPhase) {
      warnings.push('Tight schedule: ' + ordered.length + ' topics need ~' + daysNeeded +
        ' learn-days but only ' + learnPhase + ' are available before the taper. ' +
        'Raise daily minutes or start earlier.');
    }

    var planDays = [];
    for (var d = 0; d < days; d++) {
      planDays.push({ date: addDaysStr(today, d), items: [] });
    }

    ordered.forEach(function (t, idx) {
      var learnDay = Math.min(learnPhase - 1, Math.floor(idx / learnsPerDay));
      planDays[learnDay].items.push({
        type: 'learn', id: t.id, subject: t.subject, topic: t.topic,
        keyPoints: t.keyPoints, minutes: LEARN_MINUTES,
        key: t.id + ':learn:' + learnDay
      });
      // Spaced reviews at 1/3/7/14-day offsets, kept inside the plan window.
      var offsets = BASE_OFFSETS.filter(function (o) { return learnDay + o < days; });
      if (offsets.length === 0 && learnDay + 1 < days) offsets = [1]; // compress for short runways
      offsets.forEach(function (o) {
        var rd = learnDay + o;
        planDays[rd].items.push({
          type: 'review', id: t.id, subject: t.subject, topic: t.topic,
          keyPoints: t.keyPoints, minutes: REVIEW_MINUTES,
          key: t.id + ':review:' + rd, interval: o
        });
      });
    });

    planDays.forEach(function (pd) {
      var mins = pd.items.reduce(function (a, i) { return a + i.minutes; }, 0);
      if (mins > dailyMinutes) {
        warnings.push(pd.date + ': ' + mins + ' min planned vs ' + dailyMinutes +
          ' min budget — trim topics or extend the runway.');
      }
    });


    return { days: planDays, examDate: config.examDate, warnings: warnings, topicCount: ordered.length };
  }

  /**
   * SM-2-inspired scheduler update after a review session.
   * st: { ef, interval } — easiness factor & last interval (days)
   * rating: 'again' | 'hard' | 'good' | 'easy'
   * Returns { ef, interval, nextReview } with nextReview clamped before the exam.
   */
  function updateSchedule(st, rating, reviewDate, examDate) {
    var ef = (st && st.ef != null) ? st.ef : 2.5;
    var interval = (st && st.interval) || 1;

    if (rating === 'again') {
      ef = Math.max(1.3, ef - 0.2);
      interval = 1;                       // forgot it -> back to tomorrow
    } else if (rating === 'hard') {
      ef = Math.max(1.3, ef - 0.15);
      interval = Math.max(1, Math.round(interval * 1.2));
    } else if (rating === 'good') {
      interval = Math.max(1, Math.round(interval * ef));
    } else if (rating === 'easy') {
      ef = Math.min(2.5, ef + 0.1);
      interval = Math.max(1, Math.round(interval * ef * 1.3));
    } else {
      throw new Error('Unknown rating: ' + rating);
    }

    var maxGap = Math.max(1, daysBetween(reviewDate, examDate)); // never schedule past the exam
    interval = Math.min(interval, maxGap);

    return {
      ef: Math.round(ef * 10) / 10,
      interval: interval,
      nextReview: addDaysStr(reviewDate, interval)
    };
  }

  /**
   * Readiness of one topic: 0 until learned, then fraction of scheduled reviews completed.
   */
  function topicReadiness(progress, totalScheduledReviews) {
    if (!progress || !progress.learned) return 0;
    if (!(totalScheduledReviews > 0)) return 1;
    var done = Math.min(progress.reviewsDone || 0, totalScheduledReviews);
    return done / totalScheduledReviews;
  }

  function average(nums) {
    if (!nums.length) return 0;
    return nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
  }

  /**
   * Readiness per subject and overall.
   * topicStates: { topicId: {learned, reviewsDone} }, scheduledCounts: { topicId: n }
   * subjects: [{name}] with subjectIdx aligned to topic ids 'si:ti'
   */
  function readinessReport(topicStates, scheduledCounts, subjects) {
    var perSubject = subjects.map(function (s, si) {
      var vals = [];
      Object.keys(topicStates).forEach(function (tid) {
        if (tid.split(':')[0] === String(si)) {
          vals.push(topicReadiness(topicStates[tid], scheduledCounts[tid] || 0));
        }
      });
      return { subject: s.name, readiness: vals.length ? average(vals) : 0, topics: vals.length };
    });
    return {
      perSubject: perSubject,
      overall: perSubject.length ? average(perSubject.map(function (p) { return p.readiness; })) : 0
    };
  }

  /**
   * Consecutive-day streak of fully-completed study days ending today (or yesterday if today is incomplete).
   * dayRecords: { 'YYYY-MM-DD': { done, total } }
   */
  function computeStreak(dayRecords, today) {
    today = today || todayStr();
    var d = today;
    var r = dayRecords[d];
    if (!(r && r.total > 0 && r.done >= r.total)) d = addDaysStr(d, -1);
    var streak = 0;
    for (;;) {
      var rec = dayRecords[d];
      if (rec && rec.total > 0 && rec.done >= rec.total) {
        streak++;
        d = addDaysStr(d, -1);
      } else break;
    }
    return streak;
  }

    /**
   * Undone items from days before `today` — the catch-up backlog.
   * plan: generatePlan() output. dayRecords: { 'YYYY-MM-DD': { done: [keys] } }.
   * Returns [{ date, item }] oldest-first, skipping today and future days.
   */
  function backlogItems(plan, dayRecords, today) {
    today = today || todayStr();
    var out = [];
    if (!plan || !plan.days) return out;
    plan.days.forEach(function (d) {
      if (d.date >= today) return;
      var rec = (dayRecords || {})[d.date];
      var done = rec ? rec.done : [];
      d.items.forEach(function (it) {
        if (done.indexOf(it.key) === -1) out.push({ date: d.date, item: it });
      });
    });
    return out;
  }

  /**
   * Move uncompleted items from `dateISO` to the next plan day.
   * Returns { plan, moved }. The original plan object is not mutated.
   * Refuses to push items past the exam (last plan day).
   */
  function postponeDay(plan, dayRecords, dateISO) {
    var empty = { plan: plan, moved: 0 };
    if (!plan || !plan.days) return empty;
    var idx = -1;
    plan.days.forEach(function (d, i) { if (d.date === dateISO) idx = i; });
    if (idx < 0 || idx >= plan.days.length - 1) return empty; // unknown day or exam day
    var rec = (dayRecords || {})[dateISO] || { done: [] };
    var doneSet = {};
    (rec.done || []).forEach(function (k) { doneSet[k] = true; });
    var keep = [], move = [];
    plan.days[idx].items.forEach(function (it) {
      if (doneSet[it.key]) keep.push(it); else move.push(it);
    });
    if (!move.length) return empty;
    var newPlan = {
      days: plan.days.map(function (d) { return { date: d.date, items: d.items.slice() }; }),
      examDate: plan.examDate,
      warnings: plan.warnings ? plan.warnings.slice() : [],
      topicCount: plan.topicCount
    };
    var nextIdx = idx + 1;
    move.forEach(function (it) {
      var copy = Object.assign({}, it);
      var parts = copy.key.split(':');
      parts[parts.length - 1] = String(nextIdx);
      copy.key = parts.join(':');
      newPlan.days[nextIdx].items.push(copy);
    });
    newPlan.days[idx].items = keep;
    return { plan: newPlan, moved: move.length };
  }

  /**
   * Weak-spot report: learned topics ranked worst-first by readiness
   * (ties: most "again" ratings, then lowest easiness factor).
   * topicStates: { 'si:ti': {learned, reviewsDone, ef, againCount} }
   * Returns [{id, subject, topic, readiness, ef, againCount}] (limit 5).
   */
  function weakSpots(topicStates, scheduledCounts, subjects, limit) {
    var out = [];
    Object.keys(topicStates || {}).forEach(function (tid) {
      var parts = String(tid).split(':');
      var si = Number(parts[0]), ti = Number(parts[1]);
      var subj = (subjects || [])[si];
      var topic = subj && (subj.topics || [])[ti];
      if (!topic) return;
      var tp = topicStates[tid];
      out.push({
        id: tid,
        subject: subj.name,
        topic: topic.name,
        readiness: topicReadiness(tp, scheduledCounts[tid] || 0),
        ef: tp.ef != null ? tp.ef : 2.5,
        againCount: tp.againCount || 0
      });
    });
    out.sort(function (a, b) {
      return (a.readiness - b.readiness) ||
        (b.againCount - a.againCount) ||
        (a.ef - b.ef);
    });
    return out.slice(0, limit || 5);
  }

  /**
   * Readiness forecast: project review completion by the exam date from the
   * last-7-days review pace. dayRecords: { 'YYYY-MM-DD': {done:[keys]} }.
   * Returns {totalReviews, reviewsDone, pacePerDay, daysLeft, projectedPct, verdict}.
   */
  function forecastReadiness(topicStates, scheduledCounts, dayRecords, examDate, today) {
    today = today || todayStr();
    var total = 0, done = 0;
    Object.keys(scheduledCounts || {}).forEach(function (tid) {
      var n = scheduledCounts[tid] || 0;
      total += n;
      var tp = (topicStates || {})[tid];
      done += Math.min(tp ? (tp.reviewsDone || 0) : 0, n);
    });
    var recent = 0;
    for (var d = 0; d < 7; d++) {
      var rec = (dayRecords || {})[addDaysStr(today, -d)];
      if (rec && rec.done) {
        recent += rec.done.filter(function (k) { return String(k).indexOf(':review:') !== -1; }).length;
      }
    }
    var pace = recent / 7;
    var daysLeft = Math.max(0, daysBetween(today, examDate));
    var projected = Math.min(total, done + pace * daysLeft);
    var pct = total ? projected / total : 1;
    return {
      totalReviews: total,
      reviewsDone: done,
      pacePerDay: Math.round(pace * 10) / 10,
      daysLeft: daysLeft,
      projectedPct: pct,
      verdict: pct >= 0.95 ? 'on track' : pct >= 0.75 ? 'tight' : 'behind pace'
    };
  }

  /**
   * Last 8 weeks (Monday-start) of study activity for a heatmap.
   * dayCounts: { 'YYYY-MM-DD': {done, total} }.
   * Returns [{start, days:[{date, done, total, level}]}]; level 0..3.
   */
  function studyWeeks(dayCounts, today) {
    today = today || todayStr();
    var end = parseDay(today);
    var mondayOffset = (end.getUTCDay() + 6) % 7;
    var thisMonday = addDaysStr(toISO(end), -mondayOffset);
    var weeks = [];
    for (var w = 7; w >= 0; w--) {
      var start = addDaysStr(thisMonday, -7 * w);
      var days = [];
      for (var d = 0; d < 7; d++) {
        var ds = addDaysStr(start, d);
        var rec = (dayCounts || {})[ds] || { done: 0, total: 0 };
        var frac = rec.total > 0 ? rec.done / rec.total : 0;
        days.push({
          date: ds,
          done: rec.done,
          total: rec.total,
          level: rec.total > 0 && frac >= 1 ? 3 : frac >= 0.5 ? 2 : frac > 0 ? 1 : 0
        });
      }
      weeks.push({ start: start, days: days });
    }
    return weeks;
  }
  /**
   * Plain-text printable rendering of the full schedule.
   * config: optional { subjects } — unused for now, kept for future headers.
   */
  function exportPlanText(plan, config) {
    var lines = [];
    lines.push('STUDY PLAN — exam ' + plan.examDate);
    lines.push('Generated by StudyFlow · ' + plan.topicCount + ' topics');
    plan.days.forEach(function (d, i) {
      lines.push('');
      lines.push(d.date + (i === plan.days.length - 1 ? ' — EXAM DAY' : ''));
      if (!d.items.length) { lines.push('  (rest)'); return; }
      d.items.forEach(function (it) {
        lines.push('  [' + (it.type === 'learn' ? 'LEARN' : 'REVIEW') + '] ' +
          it.subject + ' — ' + it.topic + ' (' + it.minutes + 'm)');
      });
    });
    return lines.join('\n');
  }

  /**
   * Build a self-test drill deck from one plan day: one card per undone
   * queue item that has key points to quiz on.
   * Returns [{key, id, subject, topic, keyPoints, type, minutes}].
   */
  function drillDeck(plan, dayRecords, dateStr) {
    var day = null;
    (plan.days || []).forEach(function (d) { if (d.date === dateStr) day = d; });
    if (!day) return [];
    var rec = (dayRecords || {})[dateStr] || { done: [] };
    return day.items.filter(function (it) {
      return rec.done.indexOf(it.key) === -1 && (it.keyPoints || []).length;
    }).map(function (it) {
      return {
        key: it.key, id: it.id, subject: it.subject, topic: it.topic,
        keyPoints: it.keyPoints.slice(), type: it.type, minutes: it.minutes
      };
    });
  }

  /**
   * Render the whole plan as an .ics calendar file: one all-day event per
   * study day (CRLF line endings). Exam day is flagged in the summary.
   */
  function planToICS(plan) {
    function escICS(s) {
      return String(s == null ? '' : s)
        .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
    }
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//StudyFlow AI//Study Plan//EN'
    ];
    var days = (plan && plan.days) || [];
    days.forEach(function (d, i) {
      if (!d.items || !d.items.length) return;
      var mins = d.items.reduce(function (a, it) { return a + (it.minutes || 0); }, 0);
      var stamp = String(d.date).replace(/-/g, '');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:studyflow-' + stamp + '@local');
      lines.push('DTSTAMP:' + stamp + 'T000000');
      lines.push('DTSTART;VALUE=DATE:' + stamp);
      lines.push('SUMMARY:' + escICS('Study: ' + d.items.length + ' items (' + mins + ' min)' +
        (i === days.length - 1 ? ' — EXAM DAY' : '')));
      lines.push('DESCRIPTION:' + escICS(d.items.map(function (it) {
        return (it.type === 'learn' ? 'LEARN' : 'REVIEW') + ': ' + it.subject + ' — ' + it.topic;
      }).join('\n')));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  /** Serialize full app state for backup. */
  function serializeState(state) {
    return JSON.stringify(state, null, 2);
  }

  /**
   * Validate + normalize an imported backup object. Throws on bad input.
   * Returns the state (with days/topics maps guaranteed present).
   */
  function parseStateImport(text) {
    var s;
    try { s = JSON.parse(text); } catch (e) { throw new Error('Not valid JSON.'); }
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      throw new Error('Import must be a StudyFlow backup object.');
    }
    if (!s.config || !Array.isArray(s.config.subjects) || !s.config.subjects.length) {
      throw new Error('Backup has no subjects.');
    }
    if (!s.plan || !Array.isArray(s.plan.days)) {
      throw new Error('Backup has no plan.');
    }
    s.topics = s.topics || {};
    s.days = s.days || {};
    return s;
  }
  function formatClock(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var m = Math.floor(s / 60);
    s = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /**
   * Filter plan days to items whose subject or topic matches `query`
   * (case-insensitive). Days with no matching items are dropped.
   * Returns an array of { date, items } — item objects (with keys) preserved.
   */
  function filterSchedule(plan, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!plan || !plan.days) return [];
    if (!q) return plan.days;
    var out = [];
    plan.days.forEach(function (d) {
      var items = d.items.filter(function (it) {
        return (it.subject + ' ' + it.topic).toLowerCase().indexOf(q) !== -1;
      });
      if (items.length) out.push({ date: d.date, items: items });
    });
    return out;
  }

  return {
    LEARN_MINUTES: LEARN_MINUTES,
    REVIEW_MINUTES: REVIEW_MINUTES,
    BASE_OFFSETS: BASE_OFFSETS,
    toISO: toISO,
    parseDay: parseDay,
    addDaysStr: addDaysStr,
    daysBetween: daysBetween,
    todayStr: todayStr,
    interleaveTopics: interleaveTopics,
    generatePlan: generatePlan,
    updateSchedule: updateSchedule,
    topicReadiness: topicReadiness,
    readinessReport: readinessReport,
    computeStreak: computeStreak,
    weakSpots: weakSpots,
    forecastReadiness: forecastReadiness,
    studyWeeks: studyWeeks,
    backlogItems: backlogItems,
    postponeDay: postponeDay,
    exportPlanText: exportPlanText,
    formatClock: formatClock,
    filterSchedule: filterSchedule,
    drillDeck: drillDeck,
    planToICS: planToICS,
    serializeState: serializeState,
    parseStateImport: parseStateImport
  };
});
