#!/bin/bash
# StudyFlow end-to-end tests — exercise the scheduler through realistic flows.
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== studyflow-ai e2e =="

# Flow 1: 'again' shortens the interval, 'good' stretches it (same starting state)
node -e "
const L=require('./js/logic.js');
const t=L.todayStr(), exam=L.addDaysStr(t,14);
const base={ef:2.5,interval:3};
const again=L.updateSchedule(base,'again',t,exam);
const good=L.updateSchedule(base,'good',t,exam);
if(!(again.interval===1))throw new Error('again interval='+again.interval+', want 1');
if(!(good.interval>3))throw new Error('good interval='+good.interval+', want >3');
if(!(again.ef<good.ef))throw new Error('again should lower EF');
console.log('again->'+again.interval+'d good->'+good.interval+'d');
" && ok "flow1: 'again' resets to 1d, 'good' stretches interval" || bad "flow1 failed"

# Flow 2: readiness math — learned 2/4 reviews = 0.5; unlearned = 0
node -e "
const L=require('./js/logic.js');
const r1=L.topicReadiness({learned:true,reviewsDone:2},4);
const r2=L.topicReadiness({learned:false,reviewsDone:0},4);
const r3=L.topicReadiness({learned:true,reviewsDone:9},4);
if(Math.abs(r1-0.5)>1e-9)throw new Error('r1='+r1);
if(r2!==0)throw new Error('r2='+r2);
if(r3!==1)throw new Error('over-completion should cap at 1, got '+r3);
const rep=L.readinessReport({'0:0':{learned:true,reviewsDone:4},'0:1':{learned:true,reviewsDone:0}},{'0:0':4,'0:1':4},[{name:'Bio'}]);
if(Math.abs(rep.perSubject[0].readiness-0.5)>1e-9)throw new Error('subject readiness='+rep.perSubject[0].readiness);
if(Math.abs(rep.overall-0.5)>1e-9)throw new Error('overall='+rep.overall);
console.log('readiness ok');
" && ok "flow2: readiness math (0.5 / 0 / capped at 1)" || bad "flow2 failed"

# Flow 3: short 4-day runway — all topics still learned, no review past the exam
node -e "
const L=require('./js/logic.js');
const t=L.todayStr(), exam=L.addDaysStr(t,4);
const cfg={examDate:exam,dailyMinutes:90,subjects:[{name:'Bio',topics:[{name:'A'},{name:'B'},{name:'C'}]}]};
const p=L.generatePlan(cfg,t);
if(p.error)throw new Error(p.error);
const learned=new Set(); let leaked=false;
p.days.forEach(d=>d.items.forEach(it=>{ if(it.type==='learn')learned.add(it.id); if(d.date>exam)leaked=true; }));
if(learned.size!==3)throw new Error('learned '+learned.size+'/3');
if(leaked)throw new Error('item past exam');
const revs=p.days.reduce((a,d)=>a+d.items.filter(i=>i.type==='review').length,0);
if(revs<1)throw new Error('no reviews scheduled on short runway');
console.log('short-runway ok, reviews='+revs);
" && ok "flow3: 4-day runway learns all topics, reviews compressed in-window" || bad "flow3 failed"

# Flow 4: streak — 3 complete days in a row, then a missed day breaks it
node -e "
const L=require('./js/logic.js');
const t=L.todayStr();
const d1=L.addDaysStr(t,-3), d2=L.addDaysStr(t,-2), d3=L.addDaysStr(t,-1);
const full={[d1]:{done:2,total:2},[d2]:{done:3,total:3},[d3]:{done:1,total:1}};
if(L.computeStreak(full,t)!==3)throw new Error('want streak 3, got '+L.computeStreak(full,t));
const broken={[d1]:{done:2,total:2},[d2]:{done:1,total:3},[d3]:{done:1,total:1}};
if(L.computeStreak(broken,t)!==1)throw new Error('want streak 1 after miss, got '+L.computeStreak(broken,t));
const partial={[t]:{done:1,total:2}};
if(L.computeStreak(partial,t)!==0)throw new Error('incomplete today should give 0');
console.log('streak ok');
" && ok "flow4: streak counts consecutive full days, breaks on miss" || bad "flow4 failed"

# Flow 5: next review is never scheduled past the exam (even 'easy' on a huge interval)
node -e "
const L=require('./js/logic.js');
const t=L.todayStr(), exam=L.addDaysStr(t,2);
const r=L.updateSchedule({ef:2.5,interval:30},'easy',t,exam);
if(r.nextReview>exam)throw new Error('nextReview '+r.nextReview+' past exam '+exam);
if(r.interval>2)throw new Error('interval not clamped: '+r.interval);
console.log('clamp ok -> '+r.nextReview);
" && ok "flow5: review date clamped before exam" || bad "flow5 failed"

# Flow 6: invalid inputs are rejected with a clear error, not a crash
node -e "
const L=require('./js/logic.js');
const t=L.todayStr();
const past=L.generatePlan({examDate:L.addDaysStr(t,-1),dailyMinutes:60,subjects:[{name:'X',topics:[{name:'Y'}]}]},t);
if(!past.error)throw new Error('past exam date accepted');
const empty=L.generatePlan({examDate:L.addDaysStr(t,7),dailyMinutes:60,subjects:[]},t);
if(!empty.error)throw new Error('empty subjects accepted');
try{ L.updateSchedule({ef:2.5,interval:1},'bogus',t,L.addDaysStr(t,7)); throw new Error('bad rating accepted'); }
catch(e){ if(!/Unknown rating/.test(e.message))throw e; }
console.log('validation ok');
" && ok "flow6: bad inputs rejected with clear errors" || bad "flow6 failed"

echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
