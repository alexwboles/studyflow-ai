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
    computeStreak: computeStreak
  };
});
