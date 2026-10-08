#!/bin/bash
# StudyFlow smoke tests — fast static + logic checks.
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== studyflow-ai smoke =="

# 1: required files exist
for f in index.html css/style.css js/logic.js js/app.js README.md; do
  [ -f "$f" ] && ok "file exists: $f" || bad "missing file: $f"
done

# 2: JS syntax valid
node --check js/logic.js 2>/dev/null && ok "logic.js syntax valid" || bad "logic.js syntax error"
node --check js/app.js 2>/dev/null && ok "app.js syntax valid" || bad "app.js syntax error"

# 3: index.html wires both scripts
grep -q 'js/logic.js' index.html && grep -q 'js/app.js' index.html \
  && ok "index.html loads logic.js + app.js" || bad "index.html missing script tags"

# 4: README documents the algorithm
grep -qi 'SM-2\|spaced' README.md && ok "README explains algorithm" || bad "README missing algorithm docs"

# 5: logic exports the scheduler API
node -e "const L=require('./js/logic.js'); ['generatePlan','updateSchedule','topicReadiness','readinessReport','computeStreak'].forEach(f=>{if(typeof L[f]!=='function')throw new Error('missing '+f)}); console.log('api ok')" \
  && ok "logic.js exports scheduler API" || bad "logic.js API incomplete"

# 5b: logic exports the new productivity API (backlog, postpone, export, timer, filter)
node -e "const L=require('./js/logic.js'); ['backlogItems','postponeDay','exportPlanText','formatClock','filterSchedule'].forEach(f=>{if(typeof L[f]!=='function')throw new Error('missing '+f)}); console.log('new api ok')" \
  && ok "logic.js exports backlog/postpone/export/timer/filter API" || bad "logic.js new API incomplete"

# 5c: app.js wires the new UI (timer card, backlog section, postpone, print, schedule search)
missing=""
for needle in timerToggle renderTimerCard backlogItems postponeDay printSchedule filterSchedule scheduleQuery; do
  grep -q "$needle" js/app.js || missing="$missing $needle"
done
[ -z "$missing" ] && ok "app.js wires backlog/postpone/print/timer/search UI" || bad "app.js missing wiring:$missing"

# 6: plan covers all topics before the exam (14-day runway, 7 topics)
node -e "
const L=require('./js/logic.js');
const cfg={examDate:L.addDaysStr(L.todayStr(),14),dailyMinutes:60,subjects:[
 {name:'Bio',topics:[{name:'A'},{name:'B'},{name:'C'}]},
 {name:'Hist',topics:[{name:'D'},{name:'E'}]},
 {name:'Span',topics:[{name:'F'},{name:'G'}]}]};
const p=L.generatePlan(cfg,L.todayStr());
if(p.error)throw new Error(p.error);
const learned=new Set(); let pastExam=false;
p.days.forEach((d,i)=>d.items.forEach(it=>{ if(it.type==='learn')learned.add(it.id); if(d.date>cfg.examDate)pastExam=true; }));
if(learned.size!==7)throw new Error('only '+learned.size+'/7 topics learned');
if(pastExam)throw new Error('item scheduled past exam');
console.log('coverage ok');
" && ok "plan learns all 7 topics before exam" || bad "plan coverage failed"

# 7: taper — no new learns in the final 2 days on a 14-day plan
node -e "
const L=require('./js/logic.js');
const cfg={examDate:L.addDaysStr(L.todayStr(),14),dailyMinutes:60,subjects:[{name:'Bio',topics:[{name:'A'},{name:'B'}]}]};
const p=L.generatePlan(cfg,L.todayStr());
const tail=p.days.slice(-2);
const learns=tail.reduce((a,d)=>a+d.items.filter(i=>i.type==='learn').length,0);
if(learns!==0)throw new Error(learns+' learn items in taper');
console.log('taper ok');
" && ok "taper: final 2 days are reviews-only" || bad "taper violated"

echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
