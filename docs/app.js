"use strict";

const PROGRAM_SHORT = { MIA: "MIA", MCDA: "MCDA", ECD: "ECD", EDS: "EDS" };
const SEMESTER_ORDER = ["Primer semestre", "Segundo semestre", "Tercer semestre", "Electivas"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DOW_SHORT = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"];
const ALERT_TYPES = {
  cruce_cohorte: { sev: "critical", icon: "!", label: "Cruce de horario en una misma cohorte" },
  cruce_docente: { sev: "critical", icon: "!", label: "Docente con dos clases a la misma hora" },
  cruce_aula: { sev: "critical", icon: "!", label: "Aula ocupada por dos cursos" },
  festivo: { sev: "serious", icon: "!", label: "Sesión programada en festivo" },
  dia_no_coincide: { sev: "serious", icon: "!", label: "Fecha que no coincide con el día indicado" },
  fila_sin_sesiones: { sev: "serious", icon: "!", label: "Franja sin fechas válidas" },
  horas: { sev: "warning", icon: "–", label: "Horas programadas distintas a las del curso" },
  sin_docente: { sev: "warning", icon: "?", label: "Docente por asignar" },
  sin_aula: { sev: "warning", icon: "?", label: "Aula por asignar" },
};

let DATA, BY_ID;
const state = {
  programs: new Set(), semester: "", q: "", view: "resumen", month: null, week: null, sort: { key: "start", dir: 1 },
  plan: { days: [], start: "18:00", end: "21:00", from: "2027-02-01", to: "2027-03-31" },
};

// ------------------------------------------------------------------ utils
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDate = (iso, withDow) => { const d = parseDate(iso); return `${withDow ? DOW[d.getDay()] + " " : ""}${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
const fmtRange = (a, b) => `${fmtDate(a)} – ${fmtDate(b)}`;
const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const sessHours = (s) => (mins(s.end) - mins(s.start)) / 60;
const fmtH = (h) => (Math.round(h * 10) / 10).toLocaleString("es-CO");
const color = (p) => `var(--p-${p})`;
const programName = (id) => DATA.programs.find((p) => p.id === id)?.name ?? id;
const pill = (p) => `<span class="pill"><span class="dot" style="background:${color(p)}"></span>${PROGRAM_SHORT[p]}</span>`;
const visiblePrograms = (o) => o.programs.filter((p) => state.programs.has(p));
const mainProgram = (o) => visiblePrograms(o)[0] ?? o.programs[0];
const SEM_LABEL = { "Primer semestre": ["1.er sem", "S1"], "Segundo semestre": ["2.º sem", "S2"], "Tercer semestre": ["3.er sem", "S3"], Electivas: ["Electiva", "E"] };
const semBadge = (o, short) => `<span class="sem" title="${esc(o.semester)}">${SEM_LABEL[o.semester]?.[short ? 1 : 0] ?? esc(o.semester)}</span>`;
const LEVEL_LABEL = { PREG: "Pregrado", MSTR: "Maestría", ESPE: "Especialización", DOCT: "Doctorado", "Pre/Pos": "Pre/Pos", Pos: "Posgrado" };
const codeLabel = (c) => c.program ? PROGRAM_SHORT[c.program] : (LEVEL_LABEL[c.level] ?? "Pregrado");
// onlyIn: código -> grupos, para marcar los códigos combinados solo con algunos grupos
function codesHTML(codes, onlyIn) {
  const seen = new Map();
  codes.forEach((c) => { if (!seen.has(c.code)) seen.set(c.code, c); });
  const order = (c) => c.program ? DATA.programs.findIndex((p) => p.id === c.program) : 9;
  return [...seen.values()].sort((a, b) => order(a) - order(b)).map((c) =>
    `<div class="code-row"><span class="codes" style="color:var(--text)">${esc(c.code)}</span>${c.program ? `<span class="dot" style="background:${color(c.program)}"></span>` : ""}<span style="color:var(--text-2)">${esc(codeLabel(c))}${onlyIn?.[c.code] ? ` · solo ${esc(onlyIn[c.code])}` : ""}</span></div>`).join("");
}
const teacherList = (o) => o.teachers.length ? esc(o.teachers.join(", ")) : `<span class="pending">Por asignar</span>`;

function schedulePattern(o) {
  const pats = new Map();
  for (const s of o.sessions) {
    const k = `${DOW_SHORT[parseDate(s.date).getDay()]} ${s.start}–${s.end}`;
    pats.set(k, (pats.get(k) || 0) + 1);
  }
  return [...pats.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`);
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  return DATA.offerings.filter((o) => {
    if (!o.programs.some((p) => state.programs.has(p))) return false;
    if (state.semester && o.semester !== state.semester) return false;
    if (!q) return true;
    const hay = [o.course, o.semester, `grupo ${o.group}`, ...o.codes.map((c) => c.code), ...o.teachers, ...o.rooms, ...o.programs].join(" ").toLowerCase();
    return q.split(/\s+/).every((t) => hay.includes(t));
  });
}

// ------------------------------------------------------------------ tooltip
const tip = $("#tooltip");
function bindTip(el, html) {
  el.addEventListener("mouseenter", () => { tip.innerHTML = typeof html === "function" ? html() : html; tip.hidden = false; });
  el.addEventListener("mousemove", (e) => {
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
  });
  el.addEventListener("mouseleave", () => { tip.hidden = true; });
}
function offeringTip(o) {
  const h = o.directed ? `${o.plannedHours} h (dirigido)` : `${fmtH(o.scheduledHours)} h · ${o.sessions.length} sesiones`;
  return `<div class="tt-title">${esc(o.course)}</div>
    <div class="row"><span class="k">${o.programs.map(pill).join(" ")}</span><span>${esc(o.semester)} · G${esc(o.group)}</span></div>
    <div class="row" style="align-items:flex-start"><span class="k">${o.codes.length > 1 ? "Códigos" : "Código"}</span><span>${codesHTML(o.codes)}</span></div>
    <div class="row"><span class="k">Fechas</span><b>${fmtRange(o.start, o.end)}</b></div>
    <div class="row"><span class="k">Horas</span><b>${h}</b></div>
    <div class="row"><span class="k">Docente</span><span>${teacherList(o)}</span></div>`;
}

// ------------------------------------------------------------------ filters & routing
function buildFilters() {
  const chips = $("#program-chips");
  chips.innerHTML = DATA.programs.map((p) =>
    `<button type="button" class="chip" data-p="${p.id}" title="${esc(p.name)}" aria-pressed="true"><span class="dot" style="background:${color(p.id)}"></span>${PROGRAM_SHORT[p.id]}</button>`).join("");
  chips.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", (e) => {
    const p = b.dataset.p;
    if (e.altKey || e.metaKey) state.programs = new Set([p]);
    else if (state.programs.has(p)) { if (state.programs.size > 1) state.programs.delete(p); }
    else state.programs.add(p);
    update();
  }));
  const sems = SEMESTER_ORDER.filter((s) => DATA.offerings.some((o) => o.semester === s));
  $("#f-semester").insertAdjacentHTML("beforeend", sems.map((s) => `<option>${s}</option>`).join(""));
  $("#f-semester").addEventListener("change", (e) => { state.semester = e.target.value; update(); });
  let t;
  $("#f-search").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; update(); }, 150); });
  document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => { state.view = b.dataset.view; update(); }));
}

function readHash() {
  const [view, qs] = location.hash.slice(1).split("?");
  const params = new URLSearchParams(qs || "");
  if (view && document.getElementById(`view-${view}`)) state.view = view;
  const ps = (params.get("p") || "").split(",").filter((p) => DATA.programs.some((x) => x.id === p));
  state.programs = new Set(ps.length ? ps : DATA.programs.map((p) => p.id));
  state.semester = params.get("s") || "";
  state.q = params.get("q") || "";
  if (params.get("m")) state.month = Number(params.get("m"));
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("w") || "")) state.week = weekStartOf(params.get("w"));
  const e = (params.get("e") || "").split("_");
  if (e.length === 5) state.plan = { days: [...e[0]].map(Number).filter((n) => n >= 0 && n <= 6), start: e[1], end: e[2], from: e[3], to: e[4] };
}
function writeHash() {
  const params = new URLSearchParams();
  if (state.programs.size !== DATA.programs.length) params.set("p", [...state.programs].join(","));
  if (state.semester) params.set("s", state.semester);
  if (state.q) params.set("q", state.q);
  if (state.view === "calendario" && state.month != null) params.set("m", state.month);
  if (state.view === "semana") {
    if (state.week) params.set("w", state.week);
    const p = state.plan;
    if (p.days.length) params.set("e", [p.days.join(""), p.start, p.end, p.from, p.to].join("_"));
  }
  const h = `#${state.view}${params.toString() ? "?" + params : ""}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}

function syncControls() {
  document.querySelectorAll("#program-chips .chip").forEach((b) => b.setAttribute("aria-pressed", state.programs.has(b.dataset.p)));
  $("#f-semester").value = state.semester;
  if ($("#f-search").value !== state.q) $("#f-search").value = state.q;
  document.querySelectorAll("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.view === state.view));
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== `view-${state.view}`; });
  syncPlanForm();
}

function update() {
  syncControls();
  writeHash();
  const rows = filtered();
  const ids = new Set(rows.map((o) => o.id));
  const issues = DATA.issues.filter((i) => ids.has(i.offering));
  const crit = issues.filter((i) => ALERT_TYPES[i.type]?.sev === "critical").length;
  $("#alert-count").textContent = issues.length;
  $("#alert-count").style.cssText = crit ? "background:var(--critical);color:#fff" : "";
  ({ resumen: renderSummary, cronograma: renderGantt, semana: renderSemana, calendario: renderCalendar, cursos: renderCourses, docentes: renderTeachers, alertas: renderAlerts })[state.view](rows, issues);
}

// ------------------------------------------------------------------ resumen
function renderSummary(rows, issues) {
  const sessions = rows.flatMap((o) => o.sessions);
  const hours = sessions.reduce((a, s) => a + sessHours(s), 0);
  const teachers = new Set(rows.flatMap((o) => o.teachers));
  const pending = rows.filter((o) => !o.directed && !o.teachers.length).length;
  const crit = issues.filter((i) => ALERT_TYPES[i.type]?.sev === "critical").length;
  const kpi = (label, value, sub) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  $("#kpis").innerHTML = [
    kpi("Cursos", rows.length, `${new Set(rows.map((o) => o.course.toLowerCase())).size} asignaturas distintas`),
    kpi("Sesiones", sessions.length, `${new Set(sessions.map((s) => s.date)).size} días con clase`),
    kpi("Horas de clase", fmtH(hours), "presenciales programadas"),
    kpi("Docentes", teachers.size, "con al menos un curso"),
    kpi("Sin docente", pending, pending ? "cursos por asignar" : "todos asignados"),
    kpi("Cruces de horario", crit, crit ? "revisar en Alertas" : "ninguno detectado"),
  ].join("");

  $("#program-cards").innerHTML = DATA.programs.filter((p) => state.programs.has(p.id)).map((p) => {
    const os = rows.filter((o) => o.programs.includes(p.id));
    if (!os.length) return "";
    const h = os.reduce((a, o) => a + (o.scheduledHours || 0), 0);
    const sched = os.filter((o) => !o.directed);
    const assigned = sched.filter((o) => o.teachers.length).length;
    const pct = sched.length ? Math.round((assigned / sched.length) * 100) : 100;
    const start = os.map((o) => o.start).sort()[0], end = os.map((o) => o.end).sort().at(-1);
    const bySem = SEMESTER_ORDER.map((s) => [s, os.filter((o) => o.semester === s).length]).filter(([, n]) => n).map(([s, n]) => `${n} ${s.replace(" semestre", "").toLowerCase()}`).join(" · ");
    return `<div class="card prog-card" style="--c:${color(p.id)}" data-p="${p.id}" title="Ver solo ${esc(p.name)}">
      <div class="name">${esc(p.name)}</div>
      <div class="short">${PROGRAM_SHORT[p.id]} · ${fmtRange(start, end)}</div>
      <div class="stats"><div><b>${os.length}</b><span>cursos</span></div><div><b>${fmtH(h)}</b><span>horas</span></div><div><b>${new Set(os.map((o) => o.group + o.semester)).size}</b><span>grupos</span></div></div>
      <div class="short" style="margin-top:6px">${bySem}</div>
      <div class="meter" role="img" aria-label="${pct}% con docente"><div style="width:${pct}%"></div></div>
      <div class="meter-label">${assigned} de ${sched.length} cursos con docente asignado (${pct}%)</div>
    </div>`;
  }).join("");
  document.querySelectorAll(".prog-card").forEach((c) => c.addEventListener("click", () => { state.programs = new Set([c.dataset.p]); update(); }));

  renderWeekly(rows);

  const ds = [...DATA.holidays.map((h) => ({ ...h, kind: "Festivo" })), ...DATA.academicDates.map((h) => ({ ...h, kind: "Académica" }))].sort((a, b) => a.date.localeCompare(b.date));
  $("#dates-list").innerHTML = ds.map((d) => `<li><span class="d">${fmtDate(d.date, true)}</span><span style="flex:1">${esc(d.name)}</span><span class="tag ${d.kind === "Festivo" ? "hol" : ""}">${d.kind}</span></li>`).join("");
}

function weeksDomain() {
  const all = DATA.offerings.flatMap((o) => o.sessions.map((s) => s.date)).sort();
  const first = parseDate(all[0]); first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const last = parseDate(all.at(-1));
  const weeks = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 7)) weeks.push(isoOf(d));
  return weeks;
}

function renderWeekly(rows) {
  const weeks = weeksDomain();
  const progs = DATA.programs.filter((p) => state.programs.has(p.id)).map((p) => p.id);
  const idx = (iso) => { const d = parseDate(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return weeks.indexOf(isoOf(d)); };
  const series = Object.fromEntries(progs.map((p) => [p, weeks.map(() => 0)]));
  for (const o of rows) for (const p of visiblePrograms(o)) for (const s of o.sessions) { const i = idx(s.date); if (i >= 0) series[p][i] += sessHours(s); }
  const max = Math.max(4, ...progs.flatMap((p) => series[p]));
  const nice = Math.ceil(max / 10) * 10;

  // Pequeños múltiplos: una franja por programa, misma escala
  const W = 900, labelW = 56, rowH = 48, gap = 14, top = 4, axisH = 22;
  const H = top + progs.length * (rowH + gap) + axisH;
  const bw = (W - labelW) / weeks.length;
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" role="img" aria-label="Horas de clase por semana y programa">`;
  progs.forEach((p, r) => {
    const y0 = top + r * (rowH + gap) + rowH;
    svg += `<text class="tick" x="0" y="${y0 - rowH / 2 + 4}" style="fill:var(--text-2);font-weight:600">${PROGRAM_SHORT[p]}</text>`;
    svg += `<line class="gridline" x1="${labelW}" x2="${W}" y1="${y0 - rowH}" y2="${y0 - rowH}" stroke-dasharray="2 3"/>`;
    svg += `<text class="tick" x="${labelW - 6}" y="${y0 - rowH + 4}" text-anchor="end">${nice}</text>`;
    series[p].forEach((v, i) => {
      if (!v) return;
      const h = Math.max(2, (v / nice) * rowH), x = labelW + i * bw + 1;
      svg += `<path d="M${x},${y0} v${-(h - 3)} q0,-3 3,-3 h${bw - 8} q3,0 3,3 v${h - 3} z" fill="${color(p)}"/>`;
    });
    svg += `<line class="baseline" x1="${labelW}" x2="${W}" y1="${y0}" y2="${y0}"/>`;
  });
  const axisY = H - 6;
  let lastMonth = -1;
  weeks.forEach((w, i) => {
    const d = parseDate(w);
    const end = new Date(d); end.setDate(end.getDate() + 6);
    const m = end.getMonth();
    if (m !== lastMonth) { svg += `<text class="tick" x="${labelW + i * bw}" y="${axisY}">${MONTHS_SHORT[m]}</text>`; lastMonth = m; }
  });
  weeks.forEach((w, i) => { svg += `<rect class="hit" data-i="${i}" x="${labelW + i * bw}" y="0" width="${bw}" height="${H - axisH}"/>`; });
  svg += "</svg>";
  $("#weekly").innerHTML = svg;
  $("#weekly").querySelectorAll(".hit").forEach((el) => bindTip(el, () => {
    const i = +el.dataset.i, d = parseDate(weeks[i]), e = new Date(d); e.setDate(e.getDate() + 6);
    return `<div class="tt-title">Semana ${fmtDate(weeks[i])} – ${fmtDate(isoOf(e))}</div>` +
      progs.map((p) => `<div class="row"><span class="k"><span class="dot" style="background:${color(p)}"></span>${PROGRAM_SHORT[p]}</span><b>${fmtH(series[p][i])} h</b></div>`).join("");
  }));
}

// ------------------------------------------------------------------ cronograma
function renderGantt(rows) {
  const d0 = new Date(2027, 0, 1), d1 = new Date(2027, 7, 1);
  const span = d1 - d0;
  const pct = (iso, endOfDay) => { const d = parseDate(iso); if (endOfDay) d.setDate(d.getDate() + 1); return ((d - d0) / span) * 100; };
  let months = "", bg = "";
  for (let m = 0; m < 7; m++) {
    const x = ((new Date(2027, m, 1) - d0) / span) * 100;
    months += `<div class="m" style="left:${x}%"><span class="full">${MONTHS[m]}</span><span class="abbr">${MONTHS_SHORT[m]}</span></div>`;
    bg += `<div class="ml" style="left:${x}%"></div>`;
  }
  for (const h of DATA.holidays) bg += `<div class="hb" style="left:${pct(h.date)}%;width:${pct(h.date, true) - pct(h.date)}%" title="${esc(h.name)}"></div>`;

  let html = `<div class="g-axis"><div></div><div class="months">${months}</div></div>`;
  const items = [];
  for (const p of DATA.programs.filter((x) => state.programs.has(x.id))) {
    const os = rows.filter((o) => o.programs.includes(p.id));
    if (!os.length) continue;
    html += `<div class="g-group"><span class="dot" style="background:${color(p.id)}"></span>${esc(p.name)}</div>`;
    for (const sem of SEMESTER_ORDER) {
      const ss = os.filter((o) => o.semester === sem);
      if (!ss.length) continue;
      const groups = [...new Set(ss.map((o) => o.group))].sort();
      for (const g of groups) {
        html += `<div class="g-sub">${esc(sem)}${sem !== "Electivas" && groups.length > 1 ? ` · Grupo ${esc(g)}` : ""}</div>`;
        for (const o of ss.filter((x) => x.group === g).sort((a, b) => a.start.localeCompare(b.start))) {
          const others = o.programs.filter((x) => x !== p.id);
          const ticks = o.sessions.map((s) => `<div class="g-tick" style="left:${(pct(s.date) + pct(s.date, true)) / 2}%"></div>`).join("");
          const left = pct(o.directed ? o.start : o.sessions[0]?.date ?? o.start);
          const right = pct(o.directed ? o.end : o.sessions.at(-1)?.date ?? o.end, true);
          html += `<div class="g-row" data-id="${o.id}" data-i="${items.length}" style="--c:${color(p.id)}">
            <div class="g-label"><div class="c">${esc(o.course)}${others.length ? `<span class="g-shared">+${others.map((x) => PROGRAM_SHORT[x]).join(", ")}</span>` : ""}</div>
            <div class="meta">${fmtRange(o.start, o.end)} · ${o.teachers.length ? esc(o.teachers.join(", ")) : "docente por asignar"}</div></div>
            <div class="g-track"><div class="g-bg">${bg}</div><div class="g-bar ${o.directed ? "directed" : ""}" style="left:${left}%;width:${right - left}%"></div>${ticks}</div>
          </div>`;
          items.push(o);
        }
      }
    }
  }
  $("#gantt").innerHTML = rows.length ? html : `<div class="empty-state">No hay cursos con los filtros actuales.</div>`;
  $("#gantt").querySelectorAll(".g-row").forEach((el) => {
    const o = items[+el.dataset.i];
    bindTip(el.querySelector(".g-track"), () => offeringTip(o));
    el.addEventListener("click", () => openDetail(o));
  });
}

// ------------------------------------------------------------------ calendario
function renderCalendar(rows) {
  const byDate = new Map();
  for (const o of rows) for (const s of o.sessions) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push({ o, s });
  }
  if (state.month == null) {
    const first = [...byDate.keys()].sort()[0];
    state.month = first ? parseDate(first).getMonth() : 0;
  }
  state.month = Math.min(6, Math.max(0, state.month));
  const m = state.month;
  $("#cal-title").textContent = `${MONTHS[m][0].toUpperCase() + MONTHS[m].slice(1)} 2027`;
  $("#cal-prev").disabled = m === 0; $("#cal-next").disabled = m === 6;
  const hol = new Map(DATA.holidays.map((h) => [h.date, h.name]));
  const acad = new Map(DATA.academicDates.map((h) => [h.date, h.name]));

  let html = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => `<div class="dow">${d}</div>`).join("");
  const start = new Date(2027, m, 1); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const stop = new Date(2027, m + 1, 0); stop.setDate(stop.getDate() + (7 - stop.getDay()) % 7);
  const cells = [];
  for (let d = new Date(start); d <= stop; d.setDate(d.getDate() + 1)) cells.push(new Date(d));
  const MAX = 5;
  for (const d of cells) {
    const iso = isoOf(d), out = d.getMonth() !== m;
    const evs = (byDate.get(iso) || []).sort((a, b) => a.s.start.localeCompare(b.s.start) || SEMESTER_ORDER.indexOf(a.o.semester) - SEMESTER_ORDER.indexOf(b.o.semester) || a.o.course.localeCompare(b.o.course) || a.o.group.localeCompare(b.o.group));
    const tag = hol.has(iso) ? `<span class="tag hol" title="${esc(hol.get(iso))}">${esc(hol.get(iso))}</span>` : acad.has(iso) ? `<span class="tag" title="${esc(acad.get(iso))}">${esc(acad.get(iso))}</span>` : "";
    html += `<div class="day ${out ? "out" : ""} ${hol.has(iso) ? "holiday" : ""} ${!evs.length && !tag ? "empty" : ""}"><div class="num"><span>${out ? "" : DOW[d.getDay()] + " "}${d.getDate()}</span>${tag}</div>`;
    evs.slice(0, MAX).forEach(({ o, s }) => {
      html += `<div class="ev" style="--c:${color(mainProgram(o))}" data-id="${o.id}" data-date="${iso}" data-start="${s.start}"><span class="t">${s.start}</span><span class="p">${visiblePrograms(o).map((p) => PROGRAM_SHORT[p]).join("·")}</span>${semBadge(o, true)}<span class="n">${o.semester !== "Electivas" ? `G${esc(o.group)} ` : ""}${esc(o.course)}</span></div>`;
    });
    if (evs.length > MAX) html += `<button class="more" data-date="${iso}">+${evs.length - MAX} más</button>`;
    html += `</div>`;
  }
  $("#cal").innerHTML = html;
  $("#cal").querySelectorAll(".ev").forEach((el) => {
    const o = BY_ID.get(el.dataset.id), s = o.sessions.find((x) => x.date === el.dataset.date && x.start === el.dataset.start);
    bindTip(el, () => `${offeringTip(o)}<div class="row"><span class="k">Esta sesión</span><b>${s.start}–${s.end}</b></div><div class="row"><span class="k">Aula</span><span>${esc(s.room || "—")}</span></div>`);
    el.addEventListener("click", () => openDetail(o));
  });
  $("#cal").querySelectorAll(".more").forEach((b) => b.addEventListener("click", () => openDay(b.dataset.date, byDate.get(b.dataset.date))));
}

// ------------------------------------------------------------------ semana y electivas
const HOUR0 = 6, HOUR1 = 23, HPX = 44;
const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const weekStartOf = (iso) => { const d = parseDate(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoOf(d); };
const addDays = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const wdOf = (iso) => (parseDate(iso).getDay() + 6) % 7; // lunes = 0
const overlap = (a, b) => mins(a.start) < mins(b.end) && mins(b.start) < mins(a.end);

// Cohorte = grupo de estudiantes que toma junto los cursos obligatorios de un semestre
function cohortKey(o) {
  if (o.semester === "Electivas") return null;
  return `${visiblePrograms(o).map((p) => PROGRAM_SHORT[p]).join("/")} · ${o.semester} · G${o.group}`;
}
const occupantKey = (o) => cohortKey(o) ?? `Electiva · ${o.course}`;

function sessionsByDate(rows) {
  const m = new Map();
  for (const o of rows) for (const s of o.sessions) {
    if (!m.has(s.date)) m.set(s.date, []);
    m.get(s.date).push({ o, s });
  }
  return m;
}

function planSessions() {
  const p = state.plan;
  const out = { sessions: [], skipped: [] };
  if (!p.days.length || !p.start || !p.end || p.start >= p.end || !p.from || !p.to || p.from > p.to) return out;
  const hol = new Map(DATA.holidays.map((h) => [h.date, h.name]));
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
    if (!p.days.includes(wdOf(d))) continue;
    if (hol.has(d)) out.skipped.push({ date: d, name: hol.get(d) });
    else out.sessions.push({ date: d, start: p.start, end: p.end });
  }
  return out;
}

function renderSemana(rows) {
  const byDate = sessionsByDate(rows);
  const plan = planSessions();
  if (!state.week) {
    const first = [...byDate.keys()].sort()[0];
    state.week = weekStartOf(plan.sessions[0]?.date ?? first ?? "2027-01-04");
  }
  renderPlan(rows, byDate, plan);
  renderHeat(rows);
  renderWeekGrid(byDate, plan);
}

function renderPlan(rows, byDate, plan) {
  const p = state.plan;
  if (!p.days.length) {
    $("#plan-summary").innerHTML = `<div class="plan-sum">Marca al menos un día para evaluar la franja.</div>`;
    $("#plan-conflicts").innerHTML = "";
    return;
  }
  if (!plan.sessions.length) {
    $("#plan-summary").innerHTML = `<div class="plan-sum">La franja no produce sesiones: revisa horario y fechas.</div>`;
    $("#plan-conflicts").innerHTML = "";
    return;
  }
  const dur = (mins(p.end) - mins(p.start)) / 60;
  const hours = plan.sessions.length * dur;
  const conf = new Map();
  for (const ps of plan.sessions) for (const { o, s } of byDate.get(ps.date) || []) {
    if (!overlap(ps, s)) continue;
    const k = occupantKey(o);
    if (!conf.has(k)) conf.set(k, { key: k, elective: !cohortKey(o), programs: new Set(), courses: new Set(), dates: new Set() });
    const c = conf.get(k);
    visiblePrograms(o).forEach((x) => c.programs.add(x));
    c.courses.add(o.course); c.dates.add(ps.date);
  }
  const list = [...conf.values()].sort((a, b) => a.elective - b.elective || b.dates.size - a.dates.size);
  const cohorts = [...new Set(rows.filter((o) => cohortKey(o) && o.sessions.some((s) => s.date >= p.from && s.date <= p.to)).map(cohortKey))].sort();
  const free = cohorts.filter((k) => !conf.has(k));
  const clashDates = new Set(list.flatMap((c) => [...c.dates]));

  $("#plan-summary").innerHTML = `<div class="plan-sum">
    <b>${plan.sessions.length} sesiones · ${fmtH(hours)} h</b> ${hours !== 24 ? `<span style="color:var(--serious)">(una electiva suele tener 24 h)</span>` : ""}<br>
    ${fmtDate(plan.sessions[0].date, true)} – ${fmtDate(plan.sessions.at(-1).date, true)}, ${p.start}–${p.end}
    ${plan.skipped.length ? `<br><span style="color:var(--holiday-ink)">Sin clase por festivo: ${plan.skipped.map((x) => fmtDate(x.date, true)).join(", ")}</span>` : ""}
    <br>${clashDates.size ? `<span class="sev critical" style="width:14px;height:14px;font-size:9px">!</span> Coincide con otros cursos en ${clashDates.size} de ${plan.sessions.length} sesiones` : `<span class="sev good" style="width:14px;height:14px;font-size:9px">✓</span> No coincide con ningún curso de los programas filtrados`}
  </div>`;
  $("#plan-conflicts").innerHTML = list.map((c) => `<div class="conf" data-date="${[...c.dates].sort()[0]}">
      <div class="h"><span class="sev ${c.elective ? "warning" : "critical"}" aria-hidden="true">${c.elective ? "E" : "!"}</span>${esc(c.key)}<span class="n">${c.dates.size} ${c.dates.size === 1 ? "fecha" : "fechas"}</span></div>
      <div class="d">${[...c.courses].map(esc).join(", ")} · ${[...c.dates].sort().map((d) => fmtDate(d)).join(", ")}</div>
    </div>`).join("") +
    (free.length ? `<div class="hint" style="margin:12px 0 0">Cohortes con clases en esas fechas que <b>no</b> se cruzan:</div><div class="free">${free.map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</div>` : "");
  $("#plan-conflicts").querySelectorAll(".conf").forEach((el) => el.addEventListener("click", () => { state.week = weekStartOf(el.dataset.date); update(); }));
}

function renderHeat(rows) {
  const p = state.plan;
  const from = p.from || "2027-01-01", to = p.to || "2027-07-31";
  $("#heat-hint").textContent = `Número de cohortes con clase en cada hora y día, entre ${fmtDate(from)} y ${fmtDate(to)} (rango de fechas de la electiva). Las electivas existentes se ven en el detalle. Clic en una celda para marcar ese día.`;
  const cells = Array.from({ length: HOUR1 - HOUR0 }, () => Array.from({ length: 7 }, () => ({ coh: new Set(), el: new Set() })));
  for (const o of rows) for (const s of o.sessions) {
    if (s.date < from || s.date > to) continue;
    const wd = wdOf(s.date);
    for (let h = HOUR0; h < HOUR1; h++) {
      if (mins(s.start) < (h + 1) * 60 && h * 60 < mins(s.end)) {
        const c = cells[h - HOUR0][wd];
        const k = cohortKey(o);
        if (k) c.coh.add(k); else c.el.add(o.course);
      }
    }
  }
  const max = Math.max(1, ...cells.flat().map((c) => c.coh.size));
  const inPlan = (h, wd) => p.days.includes(wd) && p.start && p.end && mins(p.start) < (h + 1) * 60 && h * 60 < mins(p.end);
  let html = `<div></div>${DAY_NAMES.map((d) => `<div class="hd">${d}</div>`).join("")}`;
  cells.forEach((row, i) => {
    const h = HOUR0 + i;
    html += `<div class="hh">${h}:00</div>`;
    row.forEach((c, wd) => {
      const v = c.coh.size;
      const pct = v ? 18 + (82 * v) / max : 0;
      const bg = v ? `color-mix(in srgb, var(--accent) ${pct}%, var(--surface))` : "var(--surface-2)";
      const fg = pct > 55 ? "#fff" : "var(--text-2)";
      html += `<div class="c ${inPlan(h, wd) ? "sel" : ""}" data-h="${i}" data-wd="${wd}" style="background:${bg};color:${fg}">${v || (c.el.size ? "·" : "")}</div>`;
    });
  });
  $("#heat").innerHTML = `<div class="heat">${html}</div><div class="heat-scale"><span>0</span><span class="bar"></span><span>${max} cohortes</span></div>`;
  $("#heat").querySelectorAll(".c").forEach((el) => {
    const c = cells[+el.dataset.h][+el.dataset.wd], h = HOUR0 + +el.dataset.h;
    bindTip(el, () => `<div class="tt-title">${DAY_NAMES[+el.dataset.wd]} ${h}:00–${h + 1}:00</div>` +
      (c.coh.size ? `<div>${[...c.coh].sort().map(esc).join("<br>")}</div>` : `<div style="color:var(--muted)">Ninguna cohorte con clase</div>`) +
      (c.el.size ? `<div style="margin-top:4px;color:var(--text-2)">Electivas: ${[...c.el].map(esc).join(", ")}</div>` : ""));
    el.addEventListener("click", () => {
      const wd = +el.dataset.wd;
      state.plan.days = state.plan.days.includes(wd) ? state.plan.days.filter((x) => x !== wd) : [...state.plan.days, wd].sort();
      update();
    });
  });
}

function layoutLanes(items) {
  const semIdx = (it) => it.prop ? 99 : SEMESTER_ORDER.indexOf(it.list[0].o.semester);
  items.sort((a, b) => mins(a.s.start) - mins(b.s.start) || semIdx(a) - semIdx(b) || mins(b.s.end) - mins(a.s.end));
  let cluster = [], clusterEnd = -1;
  const flush = () => { const n = Math.max(...cluster.map((x) => x.lane)) + 1; cluster.forEach((x) => { x.n = n; }); cluster = []; };
  for (const it of items) {
    if (mins(it.s.start) >= clusterEnd && cluster.length) { flush(); clusterEnd = -1; }
    const ends = [];
    cluster.forEach((x) => { ends[x.lane] = Math.max(ends[x.lane] ?? 0, mins(x.s.end)); });
    let lane = 0;
    while (ends[lane] !== undefined && ends[lane] > mins(it.s.start)) lane++;
    it.lane = lane;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, mins(it.s.end));
  }
  if (cluster.length) flush();
  return items;
}

function renderWeekGrid(byDate, plan) {
  const w = state.week;
  const end = addDays(w, 6);
  $("#wk-title").textContent = `Semana del ${fmtDate(w)} al ${fmtDate(end)}`;
  $("#wk-prev").disabled = w <= "2027-01-01"; $("#wk-next").disabled = end >= "2027-07-31";
  $("#wk-month").value = String(parseDate(addDays(w, 3)).getMonth());
  const hol = new Map(DATA.holidays.map((h) => [h.date, h.name]));
  const acad = new Map(DATA.academicDates.map((h) => [h.date, h.name]));
  const H = (HOUR1 - HOUR0) * HPX;
  const y = (t) => ((mins(t) - HOUR0 * 60) / 60) * HPX;

  let html = `<div class="wh"></div>`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(w, i);
    const note = hol.get(d) || acad.get(d);
    html += `<div class="wh ${hol.has(d) ? "hol" : ""}">${DAY_NAMES[i]} ${parseDate(d).getDate()}${note ? `<small title="${esc(note)}">${esc(note)}</small>` : ""}</div>`;
  }
  html += `<div class="times" style="height:${H}px">${Array.from({ length: HOUR1 - HOUR0 }, (_, i) => i ? `<span style="top:${i * HPX}px">${HOUR0 + i}:00</span>` : "").join("")}</div>`;
  // Grupos del mismo curso a la misma hora se dibujan como un solo bloque (G1·G2·G3)
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(w, i);
    const merged = new Map();
    for (const { o, s } of byDate.get(d) || []) {
      const k = [o.course.toLowerCase(), o.semester, visiblePrograms(o).join(), s.start, s.end].join("|");
      if (!merged.has(k)) merged.set(k, { s, list: [] });
      merged.get(k).list.push({ o, s });
    }
    const props = plan.sessions.filter((ps) => ps.date === d);
    const items = [...merged.values()];
    items.forEach((it) => { it.clash = props.some((ps) => overlap(ps, it.s)); });
    props.forEach((ps) => items.push({ prop: true, s: ps }));
    layoutLanes(items);
    days.push({ d, items, lanes: Math.max(1, ...items.map((x) => x.n || 1)) });
  }
  $("#week").style.gridTemplateColumns = `44px ${days.map((x) => `minmax(${58 * x.lanes}px, ${x.lanes}fr)`).join(" ")}`;
  const blocks = [];
  for (const { d, items } of days) {
    html += `<div class="col ${hol.has(d) ? "hol" : ""}" style="height:${H}px;--hpx:${HPX}px">`;
    for (const it of items) {
      const top = Math.max(0, y(it.s.start)), height = Math.max(16, y(it.s.end) - top - 1);
      const pos = `top:${top}px;height:${height}px;left:calc(${(it.lane / it.n) * 100}% + 1px);width:calc(${100 / it.n}% - 2px)`;
      if (it.prop) {
        html += `<div class="blk prop" style="${pos}"><span class="t">${it.s.start}–${it.s.end}</span><br><b>Electiva propuesta</b></div>`;
        continue;
      }
      const o = it.list[0].o;
      const groups = o.semester === "Electivas" ? "" : " · G" + it.list.map((x) => esc(x.o.group)).sort().join("·G");
      html += `<div class="blk ${it.clash ? "clash" : ""}" data-b="${blocks.length}" style="${pos};--c:${color(mainProgram(o))}">
        <span class="t">${it.s.start}–${it.s.end}</span>
        <div class="tags"><span class="p">${visiblePrograms(o).map((p) => PROGRAM_SHORT[p]).join("·")}</span>${semBadge(o)}</div>
        ${esc(o.course)}${groups}</div>`;
      blocks.push(it);
    }
    html += `</div>`;
  }
  $("#week").innerHTML = html;
  $("#week").querySelectorAll(".blk[data-b]").forEach((el) => {
    const it = blocks[+el.dataset.b], o = it.list[0].o, s = it.s;
    bindTip(el, () => it.list.length === 1
      ? `${offeringTip(o)}<div class="row"><span class="k">Esta sesión</span><b>${s.start}–${s.end}</b></div><div class="row"><span class="k">Aula</span><span>${esc(s.room || "—")}</span></div>${it.clash ? `<div style="color:var(--critical);margin-top:4px">Coincide con la electiva propuesta</div>` : ""}`
      : `<div class="tt-title">${esc(o.course)}</div><div class="row"><span class="k">${visiblePrograms(o).map(pill).join(" ")}</span><b>${s.start}–${s.end}</b></div>` +
        `<div class="row" style="align-items:flex-start"><span class="k">Códigos</span><span>${codesHTML(it.list.flatMap((x) => x.o.codes), partialCodes(it.list))}</span></div>` +
        it.list.map((x) => `<div class="row"><span class="k">Grupo ${esc(x.o.group)}</span><span>${x.o.teachers.length ? esc(x.o.teachers.join(", ")) : "por asignar"} · ${esc((x.s.room || "—").replace("Poblado ", ""))}</span></div>`).join("") +
        (it.clash ? `<div style="color:var(--critical);margin-top:4px">Coincide con la electiva propuesta</div>` : ""));
    el.addEventListener("click", () => it.list.length === 1 ? openDetail(o) : openDay(it.s.date, it.list));
  });
}

function partialCodes(list) {
  const out = {};
  const all = new Set(list.flatMap((x) => x.o.codes.map((c) => c.code)));
  for (const code of all) {
    const gs = list.filter((x) => x.o.codes.some((c) => c.code === code)).map((x) => "G" + x.o.group);
    if (gs.length < list.length) out[code] = gs.join(", ");
  }
  return out;
}

function initPlanner() {
  const f = $("#plan-form");
  $("#wk-month").innerHTML = MONTHS.slice(0, 7).map((m, i) => `<option value="${i}">${m[0].toUpperCase() + m.slice(1)}</option>`).join("");
  $("#wk-month").addEventListener("change", (e) => { state.week = weekStartOf(isoOf(new Date(2027, +e.target.value, 1))); update(); });
  $("#wk-prev").addEventListener("click", () => { state.week = addDays(state.week, -7); update(); });
  $("#wk-next").addEventListener("click", () => { state.week = addDays(state.week, 7); update(); });
  f.addEventListener("change", () => {
    state.plan = {
      days: [...f.querySelectorAll(".days input:checked")].map((i) => +i.value),
      start: f.start.value, end: f.end.value, from: f.from.value, to: f.to.value,
    };
    if (state.plan.days.length) {
      const first = planSessions().sessions[0];
      if (first && (first.date < state.week || first.date > addDays(state.week, 6)) && planSessions().sessions.every((s) => s.date < state.week || s.date > addDays(state.week, 6))) state.week = weekStartOf(first.date);
    }
    update();
  });
  $("#plan-clear").addEventListener("click", () => { state.plan.days = []; update(); });
}

function syncPlanForm() {
  const f = $("#plan-form"), p = state.plan;
  f.querySelectorAll(".days input").forEach((i) => { i.checked = p.days.includes(+i.value); });
  f.start.value = p.start; f.end.value = p.end; f.from.value = p.from; f.to.value = p.to;
}

// ------------------------------------------------------------------ cursos
const COURSE_COLS = [
  { key: "programs", label: "Programa", val: (o) => o.programs.join(","), html: (o) => `<div class="pills">${o.programs.map(pill).join("")}</div>` },
  { key: "semester", label: "Semestre", val: (o) => SEMESTER_ORDER.indexOf(o.semester), html: (o) => `<span style="white-space:nowrap">${esc(o.semester)}</span>` },
  { key: "group", label: "Grupo", val: (o) => o.group, html: (o) => esc(o.group) },
  { key: "course", label: "Curso", val: (o) => o.course, html: (o) => `<b>${esc(o.course)}</b><div class="codes">${o.codes.map((c) => esc(c.code)).join(" · ")}</div>` },
  { key: "start", label: "Fechas", val: (o) => o.start + o.end, html: (o) => `<span style="white-space:nowrap">${fmtRange(o.start, o.end)}</span>` },
  { key: "pattern", label: "Horario", val: (o) => schedulePattern(o).join(), html: (o) => o.directed ? `<span class="tag">Dirigido</span>` : `<span style="white-space:nowrap">${schedulePattern(o).map(esc).join("<br>")}</span>` },
  { key: "teachers", label: "Docente", val: (o) => o.teachers.join() || "~", html: teacherList },
  { key: "rooms", label: "Aula", val: (o) => o.rooms.join(), html: (o) => o.rooms.length ? o.rooms.map((r) => esc(r.replace("Poblado ", ""))).join("<br>") : `<span style="color:var(--muted)">—</span>` },
  { key: "hours", label: "Horas", num: true, val: (o) => o.scheduledHours ?? o.plannedHours, html: (o) => o.directed ? `${o.plannedHours}` : `${fmtH(o.scheduledHours)}${o.scheduledHours !== o.plannedHours ? `<span style="color:var(--serious)"> / ${o.plannedHours}</span>` : ""}` },
];
function renderCourses(rows) {
  const col = COURSE_COLS.find((c) => c.key === state.sort.key);
  const sorted = [...rows].sort((a, b) => {
    const x = col.val(a), y = col.val(b);
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "es")) * state.sort.dir || a.start.localeCompare(b.start);
  });
  $("#courses-hint").textContent = `${rows.length} cursos. Clic en una fila para ver todas sus sesiones; clic en un encabezado para ordenar.`;
  $("#courses-table").innerHTML = `<thead><tr>${COURSE_COLS.map((c) => `<th data-sort="${c.key}" class="${c.num ? "num" : ""}">${c.label} <span class="arrow">${state.sort.key === c.key ? (state.sort.dir > 0 ? "↑" : "↓") : ""}</span></th>`).join("")}</tr></thead>
    <tbody>${sorted.map((o) => `<tr data-id="${o.id}">${COURSE_COLS.map((c) => `<td class="${c.num ? "num" : ""}">${c.html(o)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  $("#courses-table").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 };
    renderCourses(rows);
  }));
  $("#courses-table").querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => openDetail(BY_ID.get(tr.dataset.id))));
}

function downloadCSV() {
  const rows = filtered();
  const head = ["Programas", "Semestre", "Grupo", "Curso", "Códigos", "Fecha", "Día", "Inicio", "Fin", "Aula", "Docente"];
  const lines = [head];
  for (const o of rows) for (const s of o.sessions) {
    lines.push([o.programs.join(" "), o.semester, o.group, o.course, o.codes.map((c) => c.code).join(" "), s.date, DOW[parseDate(s.date).getDay()], s.start, s.end, s.room || "", s.teacher || ""]);
  }
  const csv = lines.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `sesiones-${DATA.period}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ------------------------------------------------------------------ docentes
function renderTeachers(rows) {
  const map = new Map();
  const add = (name, p, h, o) => {
    if (!map.has(name)) map.set(name, { name, hours: 0, byProg: {}, offerings: new Set() });
    const t = map.get(name);
    t.hours += h; t.byProg[p] = (t.byProg[p] || 0) + h; t.offerings.add(o);
  };
  for (const o of rows) {
    if (o.directed) continue;
    const p = mainProgram(o);
    for (const s of o.sessions) {
      const names = (s.teacher || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!names.length) add("Por asignar", p, sessHours(s), o);
      // Sesiones con varios docentes (EDS): las horas se reparten
      names.forEach((n) => add(n, p, sessHours(s) / names.length, o));
    }
  }
  const list = [...map.values()].sort((a, b) => (a.name === "Por asignar") - (b.name === "Por asignar") || b.hours - a.hours);
  const max = Math.max(1, ...list.filter((t) => t.name !== "Por asignar").map((t) => t.hours));
  const progs = DATA.programs.map((p) => p.id);
  $("#teachers-table").innerHTML = `<thead><tr><th>Docente</th><th>Cursos</th><th class="num">Horas</th><th style="width:30%">Carga por programa</th></tr></thead>
    <tbody>${list.map((t) => `<tr data-name="${esc(t.name)}">
      <td>${t.name === "Por asignar" ? `<span class="pending">Por asignar</span>` : `<b>${esc(t.name)}</b>`}</td>
      <td>${[...t.offerings].map((o) => `${esc(o.course)} <span style="color:var(--muted)">(${visiblePrograms(o).map((p) => PROGRAM_SHORT[p]).join("/")}${o.semester !== "Electivas" ? " G" + esc(o.group) : ""})</span>`).join("<br>")}</td>
      <td class="num">${fmtH(t.hours)}</td>
      <td><div class="bar-cell"><div class="hbar" style="width:${Math.min(100, (t.hours / max) * 100)}%">${progs.filter((p) => t.byProg[p]).map((p) => `<span style="flex:${t.byProg[p]};background:${color(p)}" title="${PROGRAM_SHORT[p]}: ${fmtH(t.byProg[p])} h"></span>`).join("")}</div></div></td>
    </tr>`).join("")}</tbody>`;
  $("#teachers-table").querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => {
    if (tr.dataset.name === "Por asignar") return;
    state.q = tr.dataset.name; state.view = "cursos"; update();
  }));
}

// ------------------------------------------------------------------ alertas
function renderAlerts(rows, issues) {
  if (!issues.length) { $("#alerts").innerHTML = `<div class="empty-state"><span class="sev good">✓</span> Sin alertas para los filtros actuales.</div>`; return; }
  const order = Object.keys(ALERT_TYPES);
  const groups = order.map((t) => [t, issues.filter((i) => i.type === t)]).filter(([, l]) => l.length);
  $("#alerts").innerHTML = groups.map(([t, list]) => {
    const meta = ALERT_TYPES[t];
    return `<div class="alert-group"><h3><span class="sev ${meta.sev}" aria-hidden="true">${meta.icon}</span>${meta.label} <span class="tag">${list.length}</span></h3>
      ${list.map((i) => { const o = BY_ID.get(i.offering); return `<div class="alert" data-id="${i.offering}">
        <div class="pills">${o.programs.map(pill).join("")}</div>
        <div><div class="what">${esc(o.course)} · ${esc(o.semester)}${o.semester !== "Electivas" ? " · G" + esc(o.group) : ""}</div><div class="detail">${i.date ? fmtDate(i.date, true) + " · " : ""}${esc(i.detail)}</div></div></div>`; }).join("")}</div>`;
  }).join("");
  $("#alerts").querySelectorAll(".alert").forEach((el) => el.addEventListener("click", () => openDetail(BY_ID.get(el.dataset.id))));
}

// ------------------------------------------------------------------ detalle
const dlg = $("#detail");
function showDialog(title, body) {
  dlg.innerHTML = `<div class="dlg-head"><h2>${title}</h2><button class="icon-btn" type="button" aria-label="Cerrar">✕</button></div><div class="dlg-body">${body}</div>`;
  dlg.querySelector(".dlg-head button").addEventListener("click", () => dlg.close());
  tip.hidden = true;
  dlg.showModal();
}
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

function openDetail(o) {
  const hol = new Map(DATA.holidays.map((h) => [h.date, h.name]));
  const fact = (k, v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const issues = DATA.issues.filter((i) => i.offering === o.id);
  const body = `
    <div class="facts">
      ${fact("Programa", o.programs.map((p) => `${pill(p)} <span style="font-size:12px">${esc(programName(p))}</span>`).join("<br>"))}
      ${fact("Semestre · grupo", `${esc(o.semester)} · Grupo ${esc(o.group)}`)}
      ${fact("Códigos", o.codes.map((c) => `<span class="codes">${esc(c.code)}</span>${c.level ? ` <span class="tag">${esc(c.level)}</span>` : ""}`).join("<br>") || "—")}
      ${fact("Fechas", fmtRange(o.start, o.end))}
      ${fact("Horas de clase", o.directed ? `${o.plannedHours} (trabajo dirigido)` : `${fmtH(o.scheduledHours)} programadas de ${o.plannedHours}${o.integratorHours ? `<div style="font-size:12px;color:var(--muted);font-weight:400">Sin contar ${o.integratorHours} h de Proyecto Integrador</div>` : ""}`)}
      ${fact("Docente", teacherList(o))}
      ${fact("Aula", o.rooms.length ? o.rooms.map(esc).join("<br>") : "—")}
    </div>
    ${issues.length ? `<div style="margin-bottom:16px">${issues.map((i) => `<div class="alert" style="cursor:default"><span class="sev ${ALERT_TYPES[i.type].sev}">${ALERT_TYPES[i.type].icon}</span><div class="detail">${i.date ? fmtDate(i.date, true) + " · " : ""}${esc(i.detail)}</div></div>`).join("")}</div>` : ""}
    ${o.directed ? `<p class="hint">Curso de trabajo dirigido: no tiene sesiones presenciales fijas en la programación.</p>` : `
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Fecha</th><th>Horario</th><th>Aula</th><th>Docente</th></tr></thead><tbody>
      ${o.sessions.map((s, i) => `<tr style="cursor:default"><td class="num">${i + 1}</td><td style="white-space:nowrap">${fmtDate(s.date, true)}${hol.has(s.date) ? ` <span class="tag hol">Festivo</span>` : ""}</td><td style="white-space:nowrap;font-variant-numeric:tabular-nums">${s.start}–${s.end}</td><td>${esc(s.room || "—")}</td><td>${s.teacher ? esc(s.teacher) : `<span class="pending">Por asignar</span>`}</td></tr>`).join("")}
    </tbody></table></div>`}`;
  showDialog(esc(o.course), body);
}

function openDay(iso, evs) {
  const body = `<div class="table-wrap"><table><thead><tr><th>Horario</th><th>Programa</th><th>Curso</th><th>Aula</th><th>Docente</th></tr></thead><tbody>
    ${evs.map(({ o, s }) => `<tr data-id="${o.id}"><td style="white-space:nowrap">${s.start}–${s.end}</td><td><div class="pills">${o.programs.map(pill).join("")}</div></td><td>${esc(o.course)}${o.semester !== "Electivas" ? " G" + esc(o.group) : ""}</td><td>${esc(s.room || "—")}</td><td>${s.teacher ? esc(s.teacher) : `<span class="pending">Por asignar</span>`}</td></tr>`).join("")}
  </tbody></table></div>`;
  showDialog(fmtDate(iso, true), body);
  dlg.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => openDetail(BY_ID.get(tr.dataset.id))));
}

// ------------------------------------------------------------------ tema
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch (_) { /* sin almacenamiento */ }
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme-btn").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (_) { /* sin almacenamiento */ }
  });
}

// ------------------------------------------------------------------ init
async function init() {
  initTheme();
  const res = await fetch("data/programacion.json", { cache: "no-cache" });
  DATA = await res.json();
  BY_ID = new Map(DATA.offerings.map((o) => [o.id, o]));
  $("#period").textContent = DATA.period;
  const gen = new Date(DATA.generated);
  $("#footer").innerHTML = `Datos generados el ${gen.getDate()} de ${MONTHS[gen.getMonth()]} de ${gen.getFullYear()} a partir de los archivos de programación académica (SIS: MCDA, ECD, MIA · calendario EDS). Los nombres de cursos y docentes provienen de esos archivos.`;
  readHash();
  buildFilters();
  initPlanner();
  $("#cal-prev").addEventListener("click", () => { state.month--; update(); });
  $("#cal-next").addEventListener("click", () => { state.month++; update(); });
  $("#csv-btn").addEventListener("click", downloadCSV);
  addEventListener("hashchange", () => { readHash(); update(); });
  update();
}
init().catch((e) => {
  console.error(e);
  document.querySelector("main").innerHTML = `<div class="card empty-state">No se pudieron cargar los datos (${esc(e.message)}).</div>`;
});
