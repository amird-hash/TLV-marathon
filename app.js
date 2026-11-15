/* app.js – מסכי האפליקציה. שלב 2: נתוני דוגמה מקומיים, בלי גוגל. */
(function () {
  'use strict';
  var CFG = window.CONFIG, P = window.Parser, S = window.Schedule;

  // ---------- קבועים ----------
  var TYPE = {
    easy: { name: 'קלה', icon: '' }, recovery: { name: 'התאוששות', icon: '' }, quality: { name: 'איכות', icon: '' },
    long: { name: 'ארוכה', icon: '' }, test: { name: 'טסט', icon: '⏱' }, race: { name: 'תחרות', icon: '🏁' }, cross: { name: 'משלים', icon: '' }
  };
  var KIND = { warmup: 'חימום', main: 'סט מרכזי', cooldown: 'שחרור' };
  var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var PERIOD_CLASS = function (p) { return /הורדה|טייפר/.test(p) ? 'p-down' : /שיא|תחרות/.test(p) ? 'p-peak' : /בנייה/.test(p) ? 'p-build' : 'p-base'; };
  var TERMS = [
    { re: /(?<![֐-׿])(קל|קלה|קלות)(?![֐-׿])/g, topic: 'קל / התאוששות' },
    { re: /(?<![֐-׿])התאוששות(?![֐-׿])/g, topic: 'קל / התאוששות' },
    { re: /steady/gi, topic: 'Steady' },
    { re: /(?<![֐-׿])(סף|טמפו)(?![֐-׿])/g, topic: 'סף / טמפו' },
    { re: /(?<![֐-׿])קצב (מטרה|תחרות|מרתון)(?![֐-׿])/g, topic: 'קצב מטרה' },
    { re: /אינטרוולים/g, topic: 'אינטרוולים' }
  ];

  // ---------- עזרים ----------
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* פרטי / חסום – ממשיכים בלי */ } }
  function dm(iso) { var p = iso.split('-'); return (+p[2]) + '.' + (+p[1]); }
  function dayOfMonth(iso) { return +iso.slice(8); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }
  function fmtKm(n) { return (Math.round(n * 10) / 10).toString(); }
  function ltr(s) { return '<bdi>' + esc(s) + '</bdi>'; }
  // מסמן מילות קצב בטקסט. מעבר אחד על הטקסט המקורי, כדי שלא יוחלפו מילים בתוך ה-HTML שכבר נוצר.
  function linkTerms(text) {
    var hits = [];
    TERMS.forEach(function (t) {
      t.re.lastIndex = 0; var m;
      while ((m = t.re.exec(text))) hits.push({ s: m.index, e: m.index + m[0].length, topic: t.topic });
    });
    hits.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var out = '', pos = 0;
    hits.forEach(function (h) {
      if (h.s < pos) return;
      out += esc(text.slice(pos, h.s)) + '<button class="term" data-act="term" data-topic="' + esc(h.topic) + '">' + esc(text.slice(h.s, h.e)) + '</button>';
      pos = h.e;
    });
    return out + esc(text.slice(pos));
  }
  function qs(name) { var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; }

  // ---------- מצב ----------
  var st = {
    today: qs('today') || S.todayISO(),
    athlete: lsGet('athlete', null),
    screen: lsGet('screen', 'week'),
    weekNo: null, month: null,
    weeks: [], settings: [], days: S.DEFAULT_DAYS, moves: CFG.SAMPLE ? lsGet('moves', []) : [], log: {}, apiLog: [],
    athletes: CFG.SAMPLE ? CFG.SAMPLE_ATHLETES : lsGet('athletes', []), loading: false, error: null
  };
  var sched = {}; // weekNo → תוצאת שיבוץ (מחושב מחדש בכל שינוי)

  function plan() {
    var a = st.athletes.filter(function (x) { return x.name === st.athlete; })[0];
    return a ? a.plan : null;
  }

  // ---------- חיבור ל-Apps Script ----------
  function apiGet(params) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(CFG.API_URL + '?' + q).then(function (r) { return r.json(); });
  }
  function apiPost(body) {
    body.pin = CFG.PIN || '';
    // text/plain כדי למנוע preflight (CORS) מול Apps Script
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  var NET_ERR = 'אין חיבור לשיט – נסה לרענן';

  function applyPlan(res) {
    st.weeks = res.plan.map(S.normalizeWeek).filter(function (w) { return !isNaN(w.week); });
    st.settings = res.settings || [];
    st.days = S.daysFromRows(res.days);
    st.moves = res.schedule || [];
    st.apiLog = res.log || [];
    recompute();
    buildLog();
  }

  // מציג מיד את מה ששמור במכשיר, ומרענן ברקע
  function loadData() {
    if (CFG.SAMPLE) {
      var P0 = window.SAMPLE_PLAN;
      applyPlan({ plan: S.valuesToRows(P0.tabs[plan()], false), settings: P0.settings, days: P0.days, schedule: lsGet('moves', []), log: [] });
      return;
    }
    var cached = lsGet('planCache:' + st.athlete, null);
    if (cached) { applyPlan(cached); }
    st.loading = true; st.error = null;
    apiGet({ action: 'plan', athlete: st.athlete }).then(function (res) {
      st.loading = false;
      if (!res.ok) { st.error = res.error; render(); return; }
      lsSet('planCache:' + st.athlete, res);
      applyPlan(res); render();
    }).catch(function () {
      st.loading = false;
      if (!st.weeks.length) st.error = NET_ERR;
      render();
    });
  }
  function loadAthletes() {
    if (CFG.SAMPLE) return;
    apiGet({ action: 'athletes' }).then(function (res) {
      if (!res.ok) return;
      st.athletes = res.athletes; lsSet('athletes', st.athletes);
      if (st.athlete && !plan()) { st.athlete = null; lsSet('athlete', null); }
      else if (st.athlete && !st.weeks.length) loadData();
      render();
    }).catch(function () { render(); });
  }

  function recompute() {
    sched = {};
    st.weeks.forEach(function (w) {
      var personal = S.personalFor(st.moves, st.athlete, plan(), w.week);
      sched[w.week] = S.scheduleWeek(w, { days: st.days, personal: personal });
    });
  }

  // יומן: מהשיט (שורה אחרונה לכל ריצה קובעת). במצב דוגמה – יומן מדומה כדי לראות איך זה נראה
  function buildLog() {
    st.log = {};
    if (!CFG.SAMPLE) { st.log = LogKit.logMap(st.apiLog); return; }
    st.weeks.forEach(function (w) {
      sched[w.week].runs.forEach(function (r, i) {
        if (!r.date || r.date >= st.today) return;
        var partial = (w.week + i) % 7 === 0;
        st.log[w.week + '|' + r.key] = { status: partial ? 'partial' : 'done', km: r.km === null ? null : (partial ? Math.round(r.km * 0.7) : r.km), rpe: null, pain: null, detail: '', note: '' };
      });
    });
    var mine = LogKit.logMap(lsGet('sampleLog', []).filter(function (r) { return r['שם'] === st.athlete; }));
    Object.keys(mine).forEach(function (k) { st.log[k] = mine[k]; });
  }
  function logOf(w, r) { return st.log[w + '|' + r.key] || null; }
  function weekDoneKm(w) {
    var sum = 0;
    sched[w.week].runs.forEach(function (r) { var l = logOf(w.week, r); if (l && l.km) sum += l.km; });
    return sum;
  }
  function weekByStart(iso) { return st.weeks.filter(function (w) { return w.weekStart === iso; })[0]; }
  function weekByNo(n) { return st.weeks.filter(function (w) { return w.week === n; })[0]; }

  // ---------- רכיבים קטנים ----------
  function chip(type) { return '<span class="chip t-' + type + '">' + (TYPE[type].icon ? TYPE[type].icon + ' ' : '') + TYPE[type].name + '</span>'; }
  function check(l) { return l ? (l.status === 'done' ? '<span class="done" title="בוצע">✓</span>' : l.status === 'partial' ? '<span class="partial" title="חלקי">◐</span>' : '<span class="skipped" title="דולג">✗</span>') : ''; }
  var LOCK = '<svg class="lock" viewBox="0 0 16 16" width="13" height="13" aria-label="נעולה"><path fill="currentColor" d="M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7zm1.5 0h3V5a1.5 1.5 0 0 0-3 0z"/></svg>';
  function runSummary(r) {
    if (r.type === 'race') return r.intro || r.steps[0].text;
    var main = r.steps.filter(function (s) { return s.kind === 'main'; });
    var parts = main.length ? main.map(function (s) { return (s.label ? s.label + ': ' : '') + s.text; }) : r.steps.map(function (s) { return s.text; });
    var t = (r.intro ? r.intro + ' · ' : '') + parts.join(' + ');
    return t;
  }
  function runKmLabel(r) { return r.km === null ? '' : fmtKm(r.km) + ' ק״מ'; }

  function legend() {
    return '<div class="legend">' + [['easy', 'קלה'], ['quality', 'איכות'], ['long', 'ארוכה'], ['test', 'טסט / תחרות']].map(function (t) {
      return '<span class="lg"><i class="dot t-' + t[0] + '"></i>' + t[1] + '</span>';
    }).join('') + '</div>';
  }

  // ---------- מסך בחירת שם ----------
  function viewPick() {
    return '<main class="pick"><div class="hero-sun"></div><h1>מרתון תל אביב</h1><p class="sub">26.2.2027 · מי אתה?</p>' +
      '<div class="names">' + st.athletes.map(function (a) {
        return '<button class="name" data-act="pick" data-name="' + esc(a.name) + '">' + esc(a.name) + '</button>';
      }).join('') + '</div></main>';
  }

  // ---------- כרטיס "היום" בראש הבית ----------
  function nextRunAfter(date) {
    var best = null;
    st.weeks.forEach(function (w) {
      sched[w.week].runs.forEach(function (r) {
        if (r.date && r.date > date && (!best || r.date < best.r.date)) best = { w: w, r: r };
      });
    });
    return best;
  }
  function todayHero(found) {
    if (found.state === 'after') return '';
    var today = st.today, h = '<section class="thero">';
    var todays = [];
    st.weeks.forEach(function (w) { sched[w.week].runs.forEach(function (r) { if (r.date === today) todays.push({ w: w, r: r }); }); });
    var dayName = S.DAYS[(new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7];
    if (todays.length) {
      h += '<div class="tlabel">האימון של היום</div>';
      todays.forEach(function (x) { h += runCard(x.w, x.r); });
    } else {
      var nx = nextRunAfter(today);
      h += '<div class="trest"><div class="trh"><b>היום מנוחה</b><span>' + dayName + ' ' + dm(today) + '</span></div>' +
        (nx ? '<div class="tnext" data-act="open" data-week="' + nx.w.week + '" data-key="' + nx.r.key + '">' +
          '<span class="tn-l">הריצה הבאה · ' + esc(nx.r.day) + ' ' + dm(nx.r.date) + '</span>' +
          '<span class="tn-r">' + chip(nx.r.type) + '<span class="rkm">' + ltr(runKmLabel(nx.r)) + '</span></span>' +
          '<span class="tn-s">' + ltr(runSummary(nx.r)) + '</span></div>' : '') + '</div>';
    }
    return h + '</section>';
  }

  // ---------- מסך שבוע ----------
  function viewWeek() {
    var found = S.findWeek(st.weeks, st.today);
    if (st.weekNo === null) st.weekNo = found.week.week;
    var w = weekByNo(st.weekNo) || found.week;
    var s = sched[w.week];
    var idx = st.weeks.indexOf(w);
    var done = weekDoneKm(w);
    var left = daysBetween(st.today, CFG.MARATHON_DATE);
    var h = '<main class="week" id="weekMain">';
    h += '<header class="whead ' + PERIOD_CLASS(w.period) + '">' +
      '<div class="wtop"><button class="nav" data-act="prev" ' + (idx <= 0 ? 'disabled' : '') + ' aria-label="שבוע קודם">→</button>' +
      '<div class="wtitle"><div class="wnum">שבוע ' + w.week + '</div><div class="wper">' + esc(w.period) + ' · ' + (w.weekStart ? '<bdi dir="ltr">' + dm(w.weekStart) + ' – ' + dm(S.addDays(w.weekStart, 6)) + '</bdi>' : esc(w.dates)) + '</div></div>' +
      '<button class="nav" data-act="next" ' + (idx >= st.weeks.length - 1 ? 'disabled' : '') + ' aria-label="שבוע הבא">←</button></div>' +
      '<div class="wstats"><div><b>' + ltr(w.kmText || '—') + '</b><span>ק״מ מתוכנן</span></div>' +
      '<div><b>' + fmtKm(done) + '</b><span>ק״מ בוצע</span></div>' +
      '<div><b>' + (left > 0 ? left : 0) + '</b><span>ימים למרתון</span></div></div>' + progressBar(w.kmPlanned || firstNum(w.kmText), done) + '</header>';
    if (w.week === found.week.week) h += todayHero(found);
    h += '<div class="days">';
    S.DAYS.forEach(function (dn, i) {
      var date = w.weekStart ? S.addDays(w.weekStart, i) : null;
      var runs = s.byDay[i];
      var isToday = date === st.today;
      h += '<section class="day' + (isToday ? ' today' : '') + (date && date < st.today ? ' past' : '') + '">' +
        '<div class="dlabel"><b>' + dn + '</b><span>' + (date ? dm(date) : '') + '</span>' + (isToday ? '<em>היום</em>' : '') + '</div><div class="druns">';
      if (!runs.length) h += '<div class="rest">מנוחה</div>';
      runs.forEach(function (r) { h += runRow(w, r); });
      h += '</div></section>';
    });
    h += '</div>';
    var anyMoved = s.runs.some(function (r) { return r.source === 'personal'; });
    if (anyMoved) h += '<button class="ghost" data-act="resetweek">↺ החזר את השבוע לשיבוץ המקורי</button>';
    h += legend() + '</main>';
    return h;
  }
  function firstNum(t) { var m = /(\d+(?:\.\d+)?)/.exec(t || ''); return m ? parseFloat(m[1]) : 0; }
  function progressBar(planned, done) {
    var pct = planned ? Math.min(100, Math.round(done / planned * 100)) : 0;
    return '<div class="bar" role="progressbar" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>';
  }
  function runRow(w, r) {
    var l = logOf(w.week, r);
    return '<article class="run t-' + r.type + '" data-act="open" data-week="' + w.week + '" data-key="' + r.key + '" data-lp="1">' +
      '<div class="rtop">' + chip(r.type) + '<span class="rkm">' + ltr(runKmLabel(r)) + '</span>' + (r.locked ? LOCK : '') + check(l) +
      (r.source === 'personal' ? '<span class="moved" title="הוזזה">⇄</span>' : '') + '</div>' +
      '<div class="rsum">' + ltr(runSummary(r)) + (r.optional ? ' <em class="opt">אופציונלי</em>' : '') + '</div>' +
      (r.warnings.length ? '<div class="warn">⚠ ' + esc(r.warnings.join(' · ')) + '</div>' : '') +
      (r.locked ? '' : '<button class="mv" data-act="move" data-week="' + w.week + '" data-key="' + r.key + '">העבר יום</button>') +
      '</article>';
  }

  // ---------- מסך לוח שנה ----------
  function viewMonth() {
    if (!st.month) { var f = S.findWeek(st.weeks, st.today).week.weekStart; st.month = f.slice(0, 7); if (st.today.slice(0, 7) >= st.weeks[0].weekStart.slice(0, 7)) st.month = st.today.slice(0, 7); }
    var h = '<main class="month">';
    h += monthGrid();
    return h + legend() + '</main>';
  }
  function monthGrid() {
    var y = +st.month.slice(0, 4), m = +st.month.slice(5, 7);
    var first = st.month + '-01';
    var dow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // שני=0
    var start = S.addDays(first, -dow);
    var firstWeekMonth = st.weeks[0].weekStart.slice(0, 7), lastWeekMonth = st.weeks[st.weeks.length - 1].weekStart.slice(0, 7);
    var byDate = {};
    st.weeks.forEach(function (w) { sched[w.week].runs.forEach(function (r) { if (r.date) (byDate[r.date] = byDate[r.date] || []).push({ w: w, r: r }); }); });
    var h = '<div class="mnav"><button class="nav" data-act="mprev" ' + (st.month <= firstWeekMonth ? 'disabled' : '') + '>→</button><h2>' + MONTHS[m - 1] + ' ' + y + '</h2>' +
      '<button class="nav" data-act="mnext" ' + (st.month >= lastWeekMonth ? 'disabled' : '') + '>←</button></div>';
    h += '<div class="grid"><div class="gh wk">שבוע</div>' + S.DAYS.map(function (d) { return '<div class="gh">' + d.slice(0, 3) + '</div>'; }).join('');
    for (var row = 0; row < 6; row++) {
      var ws = S.addDays(start, row * 7);
      if (row >= 4 && ws.slice(0, 7) > st.month) break;
      var wk = weekByStart(ws);
      h += '<div class="gw ' + (wk ? PERIOD_CLASS(wk.period) : '') + '">' + (wk ? '<b>' + wk.week + '</b><small>' + esc(wk.period.slice(0, 5)) + '</small><small class="km">' + fmtKm(weekDoneKm(wk)) + '/' + esc(wk.kmPlanned || firstNum(wk.kmText) || '') + '</small>' : '') + '</div>';
      for (var i = 0; i < 7; i++) {
        var d = S.addDays(ws, i), items = byDate[d] || [];
        var cls = 'gd' + (d.slice(0, 7) !== st.month ? ' out' : '') + (d === st.today ? ' today' : '') + (d === CFG.MARATHON_DATE ? ' marathon' : '') +
          (items.some(function (x) { return x.r.type === 'test' || x.r.type === 'race'; }) ? ' big' : '');
        h += '<button class="' + cls + '" ' + (items.length ? 'data-act="day" data-date="' + d + '"' : 'disabled') + '><span class="dn">' + dayOfMonth(d) + '</span>' +
          items.map(function (x) {
            var l = logOf(x.w.week, x.r);
            return '<i class="pill t-' + x.r.type + '">' + (l && l.status === 'done' ? '✓' : l && l.status === 'partial' ? '◐' : (x.r.type === 'race' ? '🏁' : '')) + '</i>';
          }).join('') + '</button>';
      }
    }
    return h + '</div>';
  }

  // ---------- הגדרות ----------
  function viewSettings() {
    return '<main class="settings"><h2>הגדרות</h2><div class="card"><div class="lbl">אני</div><div class="val">' + esc(st.athlete) + ' · ' + esc(plan()) + '</div>' +
      '<button class="ghost" data-act="switch">החלף שם</button></div>' +
      '<div class="card"><div class="lbl">מקרא</div>' + legend() + '<div class="steplg"><span class="s-warmup">חימום</span><span class="s-main">סט מרכזי</span><span class="s-cooldown">שחרור</span></div></div>' +
      (st.athlete === (CFG.COACH_NAME || 'אמיר') ? '<div class="card"><div class="lbl">מאמן</div><button class="primary" data-act="gocoach">מסך מאמן</button></div>' : '') +
      '<div class="card"><div class="lbl">הזזות אישיות</div><div class="val">' + st.moves.filter(function (x) { return x['שם'] === st.athlete; }).length + ' שינויים</div></div>' +
      (CFG.SAMPLE ? '<div class="card note">מצב דוגמה: הנתונים מקובץ מקומי, והיומן (✓) מדומה.</div>' : '') + '</main>';
  }

  // ---------- כרטיס אימון ----------
  function runCard(w, r) {
    var date = r.date;
    var l = logOf(w.week, r);
    var h = '<div class="rcard t-' + r.type + '"><div class="rchead">' + chip(r.type) +
      '<div class="rct">' + S.RUN_LABELS[r.key] + (r.locked ? ' ' + LOCK : '') + '</div>' +
      '<div class="rcd">' + esc(r.day) + (date ? ' · ' + dm(date) : '') + '</div>' + check(l) + '</div>';
    if (r.total || r.km !== null) h += '<div class="rctot">' + ltr(r.total || runKmLabel(r)) + '</div>';
    if (r.intro) h += '<div class="rcintro">' + linkTerms(r.intro) + '</div>';
    r.steps.forEach(function (s) {
      h += '<div class="step s-' + s.kind + '"><div class="sk">' + (s.label ? s.label : KIND[s.kind]) + '</div><div class="sb"><div class="stext">' + linkTerms(s.text) + '</div>';
      s.sub.forEach(function (x) { h += '<div class="ssub">' + linkTerms(x) + '</div>'; });
      s.rec.forEach(function (x) { h += '<div class="srec">↳ ' + linkTerms(x) + '</div>'; });
      s.notes.forEach(function (x) { h += '<div class="snote">' + esc(x) + '</div>'; });
      h += '</div></div>';
    });
    if (r.warnings.length) h += '<div class="warn">⚠ ' + esc(r.warnings.join(' · ')) + '</div>';
    h += logSummary(l);
    h += '<button class="primary" data-act="log" data-week="' + w.week + '" data-key="' + r.key + '">' + (l ? 'עדכון ביצוע' : 'סימון ביצוע') + '</button>';
    if (!r.locked) h += '<button class="ghost" data-act="move" data-week="' + w.week + '" data-key="' + r.key + '">העבר ליום אחר</button>';
    else h += '<div class="lockn">' + LOCK + ' אימון קבוצתי – לא ניתן להזיז</div>';
    return h + '</div>';
  }

  // ---------- חלון תחתון ----------
  function openSheet(html) {
    var el = $('#sheet'), panel = $('#sheet .panel');
    // חלון כבר פתוח (למשל מעבר בין כרטיס לטופס) – מחליפים תוכן בלי אנימציה, ושומרים מיקום גלילה
    if (!el.hidden && panel) {
      var y = panel.scrollTop;
      panel.innerHTML = '<button class="x" data-act="close" aria-label="סגור">✕</button>' + html;
      panel.scrollTop = y; return;
    }
    el.innerHTML = '<div class="back" data-act="close"></div><div class="panel"><button class="x" data-act="close" aria-label="סגור">✕</button>' + html + '</div>';
    el.hidden = false; document.body.classList.add('noscroll');
  }
  function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('noscroll'); }
  function findRun(weekNo, key) { return sched[weekNo].runs.filter(function (r) { return r.key === key; })[0]; }

  function openMove(weekNo, key) {
    var w = weekByNo(weekNo), r = findRun(weekNo, key);
    var check = S.canMove(key, r.day, st.days);
    if (!check.ok) { openSheet('<p>' + esc(check.error) + '</p>'); return; }
    var orig = S.scheduleWeek(w, { days: st.days, personal: {} }).runs.filter(function (x) { return x.key === key; })[0].day;
    var h = '<h3>להעביר את ' + S.RUN_LABELS[key] + ' (' + TYPE[r.type].name + ') ליום…</h3><div class="dpick">';
    S.DAYS.forEach(function (d, i) {
      h += '<button class="' + (d === r.day ? 'on' : '') + '" data-act="moveto" data-week="' + weekNo + '" data-key="' + key + '" data-day="' + d + '"><b>' + d + '</b><span>' + (w.weekStart ? dm(S.addDays(w.weekStart, i)) : '') +
        '</span>' + (d === orig ? '<small>מקורי</small>' : '') + '</button>';
    });
    openSheet(h + '</div><p class="hint">ההזזה משפיעה רק על התצוגה שלך. אפשר שתי ריצות באותו יום.</p>');
  }
  // מוסיף שורת הזזה: מיד במסך, ובשיט ברקע. אם השמירה נכשלה – מחזירים ומסבירים
  function pushMove(row) {
    st.moves.push(row);
    if (CFG.SAMPLE) { lsSet('moves', st.moves); return; }
    apiPost({ action: 'move', name: row['שם'], week: row['שבוע'], run: row['ריצה'], day: row['יום'] }).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      lsSet('planCache:' + st.athlete, null);
    }).catch(function (err) {
      var i = st.moves.indexOf(row); if (i >= 0) st.moves.splice(i, 1);
      recompute(); render();
      alert(err.message && !/fetch|Failed|Network/i.test(err.message) ? err.message : 'לא הצלחתי לשמור את ההזזה. בדוק חיבור ונסה שוב.');
    });
  }
  function doMove(weekNo, key, day) {
    var c = S.canMove(key, day, st.days);
    if (!c.ok) { alert(c.error); return; }
    pushMove({ 'שם': st.athlete, 'תכנית': plan(), 'שבוע': weekNo, 'ריצה': key, 'יום': day });
    recompute(); buildLog(); closeSheet(); render();
  }
  function resetWeek() {
    var w = weekNo();
    sched[w].runs.forEach(function (r) { if (r.source === 'personal') pushMove({ 'שם': st.athlete, 'תכנית': plan(), 'שבוע': w, 'ריצה': r.key, 'יום': '' }); });
    recompute(); buildLog(); render();
  }
  function weekNo() { return st.weekNo; }

  function openTerm(topic) {
    var row = st.settings.filter(function (x) { return x.topic === topic; })[0];
    if (!row) return;
    var el = $('#sheet .panel');
    var old = $('#sheet .gloss'); if (old) old.remove();
    var g = document.createElement('div'); g.className = 'gloss';
    g.innerHTML = '<b>' + esc(row.topic) + '</b><p>' + esc(row.rule) + '</p>';
    el.insertBefore(g, el.children[1]);
  }

  // ---------- סימון ביצוע ----------
  var lf = null; // מצב הטופס הפתוח
  function ruleOf(topic) { var r = st.settings.filter(function (x) { return x.topic === topic; })[0]; return r ? r.rule : ''; }
  function logSummary(l) {
    if (!l) return '';
    var bits = [LogKit.STATUS_HE[l.status]];
    if (l.km !== null && l.km !== undefined) bits.push(fmtKm(l.km) + ' ק״מ');
    if (l.rpe !== null && l.rpe !== undefined) bits.push('RPE ' + l.rpe);
    if (l.pain !== null && l.pain !== undefined && l.pain > 0) bits.push('כאב ' + l.pain);
    return '<div class="lsum s-' + l.status + (l.pain >= 3 ? ' pain' : '') + '">' + check(l) + ' ' + ltr(bits.join(' · ')) +
      (l.detail ? '<div class="ldet">' + esc(l.detail) + '</div>' : '') + (l.note ? '<div class="ldet">„' + esc(l.note) + '“</div>' : '') + '</div>';
  }
  function openLogForm(weekNo, key) {
    var w = weekByNo(weekNo), r = findRun(weekNo, key), prev = logOf(weekNo, r);
    var parts = LogKit.partsOf(r), sel = {};
    parts.forEach(function (p) { sel[p.id] = { done: true, reps: p.reps }; });
    var planned = LogKit.plannedKm(r);
    lf = {
      week: weekNo, key: key, status: prev ? prev.status : 'done', parts: parts, sel: sel, planned: planned,
      date: prev && prev.date ? prev.date : LogKit.defaultDate(r.date, st.today),
      km: prev && prev.km !== null ? prev.km : planned, kmTouched: false,
      rpe: prev ? prev.rpe : null, pain: prev && prev.pain !== null ? prev.pain : 0, note: prev ? prev.note : '', saving: false, error: ''
    };
    drawLogForm();
    var pn = $('#sheet .panel'); if (pn) pn.scrollTop = 0;
  }
  function readLogForm() {
    if (!lf) return;
    var v = function (id) { var el = $('#' + id); return el ? el.value : null; };
    if (v('lf-date') !== null) lf.date = v('lf-date');
    if (v('lf-km') !== null) lf.km = v('lf-km') === '' ? null : Number(v('lf-km'));
    if (v('lf-pain') !== null) lf.pain = Number(v('lf-pain'));
    if (v('lf-note') !== null) lf.note = v('lf-note');
  }
  function drawLogForm() {
    var w = weekByNo(lf.week), r = findRun(lf.week, lf.key);
    var h = '<div class="lform"><h3>סימון ביצוע · ' + S.RUN_LABELS[r.key] + ' ' + chip(r.type) + '</h3>' +
      '<div class="lsub">' + esc(r.day) + (r.date ? ' ' + dm(r.date) : '') + ' · ' + ltr(runSummary(r)) + '</div>' +
      '<div class="seg3">' + ['done', 'partial', 'skipped'].map(function (s) {
        return '<button type="button" data-act="lfstatus" data-s="' + s + '" class="' + (lf.status === s ? 'on s-' + s : '') + '">' + (s === 'done' ? '✓ ' : s === 'partial' ? '◐ ' : '✗ ') + LogKit.STATUS_HE[s] + '</button>';
      }).join('') + '</div>';
    if (lf.status === 'partial') {
      h += '<p class="hint">ביצוע חלקי הוא חלק רגיל מאימון. סמן מה עשית:</p><div class="lparts">';
      lf.parts.forEach(function (p) {
        var s = lf.sel[p.id];
        h += '<div class="lp s-' + p.kind + (p.sub ? ' sub' : '') + '"><label><input type="checkbox" data-lf="part" data-id="' + p.id + '"' + (s.done ? ' checked' : '') + '>' +
          '<span><b>' + esc(p.sub ? '' : p.name) + '</b> ' + ltr(p.text) + '</span></label>' +
          (p.reps ? '<label class="lreps">חזרות <input type="number" inputmode="numeric" min="0" max="' + p.reps + '" data-lf="reps" data-id="' + p.id + '" value="' + s.reps + '"' + (s.done ? '' : ' disabled') + '> / ' + p.reps + '</label>' : '') + '</div>';
      });
      h += '</div>';
    }
    h += '<label class="fld">תאריך ביצוע<input type="date" id="lf-date" value="' + esc(lf.date) + '" max="' + st.today + '"></label>';
    if (lf.status !== 'skipped') {
      h += '<label class="fld">ק״מ בפועל' + (lf.status === 'partial' && !lf.kmTouched ? ' <small>(הערכה לפי מה שסימנת)</small>' : '') +
        '<input type="number" id="lf-km" inputmode="decimal" step="0.1" min="0" max="100" value="' + (lf.km === null || lf.km === undefined ? '' : fmtKm(lf.km)) + '" placeholder="למשל 8"></label>';
      h += '<div class="fld">מאמץ (RPE) <small>1 = קליל מאוד · 10 = מקסימום</small><div class="nums">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) {
        return '<button type="button" data-act="lfrpe" data-n="' + n + '" class="' + (lf.rpe === n ? 'on' : '') + '">' + n + '</button>';
      }).join('') + '</div></div>';
      h += '<label class="fld">כאב <b id="lf-painv" class="' + (lf.pain >= 3 ? 'bad' : '') + '">' + lf.pain + '</b> <small>0 = אין · 10 = חזק מאוד</small>' +
        '<input type="range" id="lf-pain" min="0" max="10" step="1" value="' + lf.pain + '"></label>';
      var rule = ruleOf('כאב');
      h += '<div class="prule" id="lf-rule"' + (lf.pain >= 3 && rule ? '' : ' hidden') + '><b>כלל הכאב</b>' + esc(rule) + '</div>';
    }
    h += '<label class="fld">הערה<textarea id="lf-note" rows="2" maxlength="500" placeholder="איך הרגיש? מזג אוויר, נעליים, תחושה…">' + esc(lf.note) + '</textarea></label>';
    h += (lf.error ? '<div class="lerr">' + esc(lf.error) + '</div>' : '') +
      '<div class="lbtns"><button type="button" class="primary" data-act="lfsave"' + (lf.saving ? ' disabled' : '') + '>' + (lf.saving ? 'שומר…' : 'שמירה') + '</button>' +
      '<button type="button" class="ghost inline" data-act="open" data-week="' + lf.week + '" data-key="' + lf.key + '">ביטול</button></div></div>';
    openSheet(h);
  }
  function refreshEstimate() {
    if (!lf || lf.status !== 'partial' || lf.kmTouched) return;
    lf.km = LogKit.estimateKm(findRun(lf.week, lf.key), lf.parts, lf.sel);
    var el = $('#lf-km'); if (el) el.value = lf.km === null ? '' : fmtKm(lf.km);
  }
  function refreshEstimateNow() { if (!lf.kmTouched) lf.km = LogKit.estimateKm(findRun(lf.week, lf.key), lf.parts, lf.sel); }
  function saveLog() {
    readLogForm();
    var r = findRun(lf.week, lf.key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lf.date || '')) { lf.error = 'בחר תאריך ביצוע'; drawLogForm(); return; }
    if (lf.date > st.today) { lf.error = 'אי אפשר לסמן ביצוע בתאריך עתידי'; drawLogForm(); return; }
    if (lf.km !== null && (isNaN(lf.km) || lf.km < 0 || lf.km > 100)) { lf.error = 'ק״מ צריך להיות מספר בין 0 ל-100'; drawLogForm(); return; }
    var skipped = lf.status === 'skipped';
    var row = {
      'שם': st.athlete, 'תכנית': plan(), 'שבוע': lf.week, 'ריצה': S.RUN_LABELS[lf.key], 'תאריך ביצוע': lf.date,
      'סטטוס': LogKit.STATUS_HE[lf.status], 'ק״מ בפועל': skipped || lf.km === null ? '' : lf.km,
      'פירוט': lf.status === 'partial' ? LogKit.detailText(lf.parts, lf.sel) : '',
      'RPE 1-10': skipped || lf.rpe === null ? '' : lf.rpe, 'כאב 0-10': skipped ? '' : lf.pain, 'הערה': lf.note || ''
    };
    var body = { action: 'log', name: st.athlete, week: lf.week, run: lf.key, date: row['תאריך ביצוע'], status: row['סטטוס'], km: row['ק״מ בפועל'],
      detail: row['פירוט'], rpe: row['RPE 1-10'], pain: row['כאב 0-10'], note: row['הערה'] };
    var done = function () {
      st.apiLog.push(row); buildLog(); saveCache();
      var weekNoSaved = lf.week, keySaved = lf.key; lf = null;
      render(); openSheet(runCard(weekByNo(weekNoSaved), findRun(weekNoSaved, keySaved)) + '<div class="toast">נשמר ✓</div>');
      var pn = $('#sheet .panel'); if (pn) pn.scrollTop = 0;
    };
    if (CFG.SAMPLE) { var s = lsGet('sampleLog', []); s.push(row); lsSet('sampleLog', s); done(); return; }
    lf.saving = true; lf.error = ''; drawLogForm();
    apiPost(body).then(function (res) {
      if (!res.ok) throw new Error(res.error || 'השמירה נכשלה');
      done();
    }).catch(function (err) {
      if (!lf) return;
      lf.saving = false;
      lf.error = err.message && !/fetch|Failed|Network|JSON/i.test(err.message) ? err.message : 'לא הצלחתי לשמור. בדוק חיבור לאינטרנט ונסה שוב.';
      drawLogForm();
    });
  }
  function saveCache() {
    if (CFG.SAMPLE) return;
    var c = lsGet('planCache:' + st.athlete, null);
    if (c) { c.log = st.apiLog; c.schedule = st.moves; lsSet('planCache:' + st.athlete, c); }
  }

  // ---------- מסך מאמן (?coach=1) ----------
  var cs = { week: null, data: {}, loading: false, error: null, copied: false, needPin: false, pinError: '' };
  function coachInit() {
    document.title = 'מאמן · מרתון תל אביב 2027';
    if (CFG.SAMPLE) {
      var P0 = window.SAMPLE_PLAN;
      applyPlan({ plan: S.valuesToRows(P0.tabs['תכנית סופית'], false), settings: P0.settings, days: P0.days, schedule: [], log: [] });
      cs.week = S.findWeek(st.weeks, st.today).week.week; coachRender(); return;
    }
    if (!lsGet('coachPin', '')) cs.needPin = true;
    var cached = lsGet('coachBase', null);
    if (cached) { applyPlan(cached); cs.week = S.findWeek(st.weeks, st.today).week.week; }
    coachRender();
    apiGet({ action: 'athletes' }).then(function (a) {
      if (!a.ok || !a.athletes.length) throw new Error(a.error || 'אין חברים פעילים בלשונית Athletes');
      st.athletes = a.athletes;
      return apiGet({ action: 'plan', athlete: a.athletes[0].name });
    }).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      res.schedule = []; res.log = [];
      lsSet('coachBase', res); applyPlan(res);
      if (cs.week === null) cs.week = S.findWeek(st.weeks, st.today).week.week;
      if (cs.needPin) coachRender(); else coachLoadWeek();
    }).catch(function (err) { cs.error = err.message && !/fetch|Failed/i.test(err.message) ? err.message : NET_ERR; coachRender(); });
  }
  function coachLoadWeek() {
    var wk = cs.week;
    if (CFG.SAMPLE) { coachRender(); return; }
    if (cs.needPin) { coachRender(); return; }
    cs.loading = true; cs.error = null; coachRender();
    apiPost({ action: 'coach', week: wk, coachPin: lsGet('coachPin', '') }).then(function (res) {
      if (res.needPin) { lsSet('coachPin', ''); cs.needPin = true; cs.pinError = res.error; cs.loading = false; coachRender(); return; }
      if (!res.ok) throw new Error(res.error);
      cs.data[wk] = res; cs.loading = false; coachRender();
    }).catch(function (err) {
      cs.loading = false; cs.error = err.message && !/fetch|Failed/i.test(err.message) ? err.message : NET_ERR; coachRender();
    });
  }
  // לכל חבר: השיבוץ שלו לשבוע (עם הזזות) והיומן שלו
  function coachRows(w, res) {
    var base = S.scheduleWeek(w, { days: st.days, personal: {} }).runs;
    return (res ? res.athletes : []).map(function (a) {
      var personal = S.personalFor(a.schedule, a.name, a.plan, w.week);
      var runs = S.scheduleWeek(w, { days: st.days, personal: personal }).runs;
      var log = LogKit.logMap(a.log);
      var cells = base.map(function (b) {
        var r = runs.filter(function (x) { return x.key === b.key; })[0];
        return { run: r, moved: r && r.source === 'personal' ? r.day : null, log: log[w.week + '|' + b.key] || null };
      });
      var km = 0, n = 0, pain = [];
      cells.forEach(function (c) {
        if (c.log && c.log.km) km += c.log.km;
        if (c.log && c.log.status !== 'skipped') n++;
        if (c.log && c.log.pain >= 3) pain.push({ run: c.run, pain: c.log.pain, note: c.log.note });
      });
      return { name: a.name, cells: cells, km: km, n: n, pain: pain };
    });
  }
  function coachPinView() {
    return '<main class="pick"><div class="hero-sun"></div><h1>מסך מאמן</h1><p class="sub">הקלד את קוד המאמן</p>' +
      '<div class="pinbox"><input id="cpin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" aria-label="קוד מאמן">' +
      '<button class="primary" data-act="cpin">כניסה</button>' + (cs.pinError ? '<div class="lerr">' + esc(cs.pinError) + '</div>' : '') +
      '<button class="ghost" data-act="gohome">חזרה לאפליקציה</button></div></main>';
  }
  function coachView() {
    if (cs.needPin && !CFG.SAMPLE) return coachPinView();
    if (!st.weeks.length) return '<main class="pick"><div class="hero-sun"></div><h1>מסך מאמן</h1><p class="sub">' + esc(cs.error || 'טוען…') + '</p>' +
      (cs.error ? '<div class="names"><button class="name" data-act="cretry">נסה שוב</button></div>' : '') + '</main>';
    var w = weekByNo(cs.week) || st.weeks[0], idx = st.weeks.indexOf(w);
    var res = CFG.SAMPLE ? { athletes: CFG.SAMPLE_ATHLETES.map(function (a) { return { name: a.name, plan: a.plan, schedule: [], log: lsGet('sampleLog', []).filter(function (r) { return r['שם'] === a.name && +r['שבוע'] === w.week; }) }; }), row: null } : cs.data[w.week];
    var base = S.scheduleWeek(w, { days: st.days, personal: {} }).runs;
    var h = '<main class="coach"><header class="whead ' + PERIOD_CLASS(w.period) + '"><div class="wtop">' +
      '<button class="nav" data-act="cprev" ' + (idx <= 0 ? 'disabled' : '') + ' aria-label="שבוע קודם">→</button>' +
      '<div class="wtitle"><div class="wnum">מאמן · שבוע ' + w.week + '</div><div class="wper">' + esc(w.period) + ' · ' + (w.weekStart ? '<bdi dir="ltr">' + dm(w.weekStart) + ' – ' + dm(S.addDays(w.weekStart, 6)) + '</bdi>' : '') + ' · ' + ltr(w.kmText || '—') + ' ק״מ</div></div>' +
      '<button class="nav" data-act="cnext" ' + (idx >= st.weeks.length - 1 ? 'disabled' : '') + ' aria-label="שבוע הבא">←</button></div></header>';
    if (!res) return h + '<p class="sub center">' + esc(cs.error || 'טוען את השבוע…') + '</p>' + (cs.error ? '<button class="ghost" data-act="cretry">נסה שוב</button>' : '') + '</main>';
    var rows = coachRows(w, res);
    h += '<div class="ctable-wrap"><table class="ctable"><thead><tr><th>חבר</th>' + base.map(function (b) {
      return '<th><span class="dot t-' + b.type + '"></span>' + S.RUN_LABELS[b.key].replace('ריצה ', 'ר') + '<small>' + esc(b.day) + (b.km !== null ? ' · ' + fmtKm(b.km) : '') + '</small></th>';
    }).join('') + '<th>סה״כ</th></tr></thead><tbody>';
    rows.forEach(function (a) {
      h += '<tr><th>' + esc(a.name) + '</th>' + a.cells.map(function (c) {
        var l = c.log, cls = l ? 's-' + l.status : 'empty';
        if (l && l.pain >= 3) cls += ' pain';
        var inner = l ? '<b>' + (l.status === 'done' ? '✓' : l.status === 'partial' ? '◐' : '✗') + '</b>' +
          (l.km !== null ? '<span>' + fmtKm(l.km) + '</span>' : '') +
          (l.rpe !== null ? '<small>RPE ' + l.rpe + '</small>' : '') + (l.pain ? '<small>כאב ' + l.pain + '</small>' : '') : '<b>·</b>';
        return '<td class="' + cls + '"' + (l && (l.detail || l.note) ? ' title="' + esc([l.detail, l.note].filter(Boolean).join(' · ')) + '"' : '') + '>' + inner +
          (c.moved ? '<em class="mvd">⇄ ' + esc(c.moved) + '</em>' : '') + '</td>';
      }).join('') + '<td class="tot"><b>' + fmtKm(a.km) + '</b><small>מתוך ' + ltr(w.kmText || '—') + '</small><small>' + a.n + '/' + base.length + ' ריצות</small></td></tr>';
    });
    h += '</tbody></table></div><p class="hint">✓ בוצע · ◐ חלקי · ✗ דולג · ⇄ הוזז ליום אחר · אדום = כאב 3 ומעלה. לחיצה ארוכה על תא מציגה פירוט והערה.</p>';
    var painList = [];
    rows.forEach(function (a) { a.pain.forEach(function (p) { painList.push('<li><b>' + esc(a.name) + '</b> · ' + S.RUN_LABELS[p.run.key] + ' · כאב ' + p.pain + (p.note ? ' – ' + esc(p.note) : '') + '</li>'); }); });
    if (painList.length) h += '<div class="card alert"><div class="lbl">כאב 3 ומעלה השבוע</div><ul>' + painList.join('') + '</ul><p class="hint">' + esc(ruleOf('כאב')) + '</p></div>';
    // עמודות המעקב הפרטיות שלי מהשיט – רק כאן
    var priv = res.row ? Object.keys(res.row).filter(function (k) { return /^(ק״מ בפועל|בוצעו ריצות|RPE שבועי|כאב 0-10|סטטוס|הערות \/ התאמות|סיכום לוואטסאפ)/.test(k); })
      .filter(function (k) { var v = String(res.row[k]).trim(); return v !== '' && !/^#/.test(v); }) : [];
    if (priv.length) h += '<div class="card"><div class="lbl">המעקב שלך בשיט (פרטי)</div><dl class="priv">' + priv.map(function (k) { return '<dt>' + esc(k) + '</dt><dd>' + esc(res.row[k]) + '</dd>'; }).join('') + '</dl></div>';
    var text = coachSummary(w, base, rows);
    h += '<div class="card"><div class="lbl">סיכום לוואטסאפ</div><textarea id="wa" class="wa" rows="8" readonly>' + esc(text) + '</textarea>' +
      '<button class="primary" data-act="ccopy">' + (cs.copied ? 'הועתק ✓ – הדבק בקבוצה' : 'העתק סיכום') + '</button></div>';
    return h + '<button class="ghost" data-act="gohome">חזרה לאפליקציה</button></main>';
  }
  function coachSummary(w, base, rows) {
    var t = '🏃 מרתון ת״א · שבוע ' + w.week + (w.weekStart ? ' (' + dm(w.weekStart) + '–' + dm(S.addDays(w.weekStart, 6)) + ')' : '') + ' · ' + w.period + '\n';
    t += 'מתוכנן: ' + (w.kmText || '—') + ' ק״מ · ' + base.length + ' ריצות\n\n';
    rows.forEach(function (a) {
      var marks = a.cells.map(function (c) { return !c.log ? '·' : c.log.status === 'done' ? '✓' : c.log.status === 'partial' ? '◐' : '✗'; }).join('');
      t += a.name + ' ' + marks + ' · ' + fmtKm(a.km) + ' ק״מ\n';
    });
    var hurt = [];
    rows.forEach(function (a) { a.pain.forEach(function (p) { hurt.push(a.name + ' (' + S.RUN_LABELS[p.run.key] + ', כאב ' + p.pain + ')'); }); });
    if (hurt.length) t += '\n⚠️ לשים לב לכאב: ' + hurt.join(', ') + '\n';
    var next = weekByNo(w.week + 1);
    if (next) t += '\nשבוע הבא: שבוע ' + next.week + ' · ' + next.period + ' · ' + (next.kmText || '—') + ' ק״מ';
    return t;
  }
  function coachRender() { $('#app').innerHTML = coachView(); var pi = $('#cpin'); if (pi) pi.focus(); }
  function coachSubmitPin() {
    var v = ($('#cpin') || {}).value || '';
    if (!v) { cs.pinError = 'הקלד קוד'; coachRender(); return; }
    lsSet('coachPin', v); cs.needPin = false; cs.pinError = ''; cs.data = {};
    if (st.weeks.length) coachLoadWeek(); else coachInit();
  }
  function coachCopy() {
    var ta = $('#wa'), text = ta ? ta.value : '';
    var ok = function () { cs.copied = true; coachRender(); setTimeout(function () { cs.copied = false; coachRender(); }, 2500); };
    var fallback = function () { if (ta) { ta.removeAttribute('readonly'); ta.focus(); ta.select(); document.execCommand && document.execCommand('copy'); ta.setAttribute('readonly', ''); } ok(); };
    try { navigator.clipboard.writeText(text).then(ok, fallback); } catch (e) { fallback(); }
  }

  // ---------- ציור ראשי ----------
  function render() {
    var app = $('#app');
    if (!st.athlete || !plan()) { app.innerHTML = st.athletes.length ? viewPick() : '<main class="pick"><div class="hero-sun"></div><h1>מרתון תל אביב</h1><p class="sub">טוען…</p></main>'; return; }
    if (!st.weeks.length) {
      app.innerHTML = '<main class="pick"><div class="hero-sun"></div><h1>מרתון תל אביב</h1><p class="sub">' + (st.error ? esc(st.error) : 'טוען את התכנית…') + '</p>' +
        (st.error ? '<div class="names"><button class="name" data-act="retry">נסה שוב</button><button class="ghost" data-act="switch">החלף שם</button></div>' : '') + '</main>';
      return;
    }
    var body = st.screen === 'week' ? viewWeek() : st.screen === 'month' ? viewMonth() : viewSettings();
    app.innerHTML = body + '<nav class="tabs">' + [['week', 'בית', '⌂'], ['month', 'לוח שנה', '▦'], ['settings', 'הגדרות', '⚙']].map(function (t) {
      return '<button data-act="tab" data-t="' + t[0] + '" class="' + (st.screen === t[0] ? 'on' : '') + '"><i>' + t[2] + '</i>' + t[1] + '</button>';
    }).join('') + '</nav>';
  }

  function shiftWeek(d) {
    var i = st.weeks.indexOf(weekByNo(st.weekNo)) + d;
    if (i < 0 || i >= st.weeks.length) return;
    st.weekNo = st.weeks[i].week; render(); window.scrollTo(0, 0);
  }

  // ---------- אירועים ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var a = el.dataset.act, d = el.dataset;
    if (a === 'term') { e.stopPropagation(); openTerm(d.topic); return; }
    if (a === 'mv' || (a === 'open' && e.target.closest('[data-act="move"]'))) return;
    switch (a) {
      case 'pick': st.athlete = d.name; lsSet('athlete', st.athlete); st.weekNo = null; st.weeks = []; loadData(); render(); break;
      case 'retry': loadData(); render(); break;
      case 'switch': st.athlete = null; lsSet('athlete', null); st.weekNo = null; st.weeks = []; render(); break;
      case 'tab': st.screen = d.t; lsSet('screen', st.screen); render(); window.scrollTo(0, 0); break;
      case 'prev': shiftWeek(-1); break;
      case 'next': shiftWeek(1); break;
      case 'open': openSheet(runCard(weekByNo(+d.week), findRun(+d.week, d.key))); break;
      case 'move': e.stopPropagation(); openMove(+d.week, d.key); break;
      case 'moveto': doMove(+d.week, d.key, d.day); break;
      case 'resetweek': resetWeek(); break;
      case 'close': lf = null; closeSheet(); break;
      case 'log': openLogForm(+d.week, d.key); break;
      case 'lfstatus': readLogForm(); lf.status = d.s; lf.error = '';
        if (d.s === 'done' && !lf.kmTouched) lf.km = lf.planned;
        if (d.s === 'partial') refreshEstimateNow();
        drawLogForm(); break;
      case 'lfrpe': readLogForm(); lf.rpe = lf.rpe === +d.n ? null : +d.n; drawLogForm(); break;
      case 'lfsave': saveLog(); break;
      case 'cprev': case 'cnext': {
        var ci = st.weeks.indexOf(weekByNo(cs.week)) + (a === 'cnext' ? 1 : -1);
        if (ci >= 0 && ci < st.weeks.length) { cs.week = st.weeks[ci].week; if (!cs.data[cs.week]) coachLoadWeek(); else coachRender(); }
        break;
      }
      case 'cretry': if (!st.weeks.length) coachInit(); else coachLoadWeek(); break;
      case 'ccopy': coachCopy(); break;
      case 'cpin': coachSubmitPin(); break;
      case 'gocoach': location.href = location.pathname + '?coach=1'; break;
      case 'gohome': location.href = location.pathname; break;
      case 'mprev': case 'mnext': {
        var y = +st.month.slice(0, 4), m = +st.month.slice(5, 7) + (a === 'mnext' ? 1 : -1);
        if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
        st.month = y + '-' + (m < 10 ? '0' : '') + m; render(); break;
      }
      case 'gotoweek': st.weekNo = +d.week; st.screen = 'week'; lsSet('screen', 'week'); render(); window.scrollTo(0, 0); break;
      case 'day': {
        var date = d.date, html = '';
        st.weeks.forEach(function (w) { sched[w.week].runs.forEach(function (r) { if (r.date === date) html += runCard(w, r); }); });
        openSheet('<div class="dsheet-h">' + S.DAYS[(new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7] + ' · ' + dm(date) + '</div>' + html);
        break;
      }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { lf = null; closeSheet(); }
    if (e.key === 'Enter' && e.target.id === 'cpin') coachSubmitPin();
  });
  // שדות בטופס סימון הביצוע
  document.addEventListener('input', function (e) {
    if (!lf) return;
    var t = e.target;
    if (t.id === 'lf-km') { lf.kmTouched = true; return; }
    if (t.id === 'lf-pain') {
      lf.pain = +t.value; var v = $('#lf-painv'); if (v) { v.textContent = t.value; v.className = lf.pain >= 3 ? 'bad' : ''; }
      var rl = $('#lf-rule'); if (rl) rl.hidden = !(lf.pain >= 3 && ruleOf('כאב'));
      return;
    }
    if (t.dataset.lf === 'reps') { lf.sel[t.dataset.id].reps = +t.value; refreshEstimate(); }
  });
  document.addEventListener('change', function (e) {
    if (!lf) return;
    var t = e.target;
    if (t.dataset.lf === 'part') {
      lf.sel[t.dataset.id].done = t.checked;
      var rep = t.closest('.lp').querySelector('[data-lf="reps"]'); if (rep) rep.disabled = !t.checked;
      refreshEstimate();
    }
  });

  // החלקה בין שבועות (RTL: החלקה ימינה = שבוע קודם)
  var tx = null, ty = null, lp = null;
  document.addEventListener('touchstart', function (e) {
    var t = e.touches[0]; tx = t.clientX; ty = t.clientY;
    var r = e.target.closest('[data-lp]');
    if (r) lp = setTimeout(function () { lp = null; if (r.dataset.week) { var b = r.querySelector('.mv'); if (b) openMove(+r.dataset.week, r.dataset.key); } }, 550);
  }, { passive: true });
  document.addEventListener('touchmove', function () { if (lp) { clearTimeout(lp); lp = null; } }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (lp) { clearTimeout(lp); lp = null; }
    if (tx === null || st.screen !== 'week' || !$('#sheet').hidden || !$('#weekMain')) return;
    var t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty; tx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) shiftWeek(dx > 0 ? -1 : 1);
  }, { passive: true });

  // ---------- התחלה ----------
  if (qs('coach')) { coachInit(); }
  else {
    if (st.athlete && plan()) loadData();
    render();
    loadAthletes();
  }
  window.__app = { st: st, render: render };
})();
