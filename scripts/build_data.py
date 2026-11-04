"""Convierte los Excel de programación académica en docs/data/programacion.json.

Uso:
    uv run --with openpyxl python scripts/build_data.py \
        --sis "excel/MCDA,MMA,DIM,MIA 4.xlsx" \
        --eds "excel/Calendario Posgrado 2027-1.xlsx"

El JSON resultante es lo único que se publica: no incluye cédulas, IDs de
empleado, correos ni notas internas de las hojas.
"""

import argparse
import datetime as dt
import json
import re
from collections import defaultdict
from pathlib import Path

import openpyxl

YEAR = 2027

PROGRAMS = [
    {"id": "MIA", "name": "Maestría en Inteligencia Artificial"},
    {"id": "MCDA", "name": "Maestría en Ciencia de Datos y Analítica"},
    {"id": "ECD", "name": "Especialización en Ciencia de Datos y Analítica"},
    {"id": "EDS", "name": "Especialización en Desarrollo de Software"},
]

DAYS = {
    "lunes": 0, "martes": 1, "miercoles": 2, "miércoles": 2, "jueves": 3,
    "viernes": 4, "sabado": 5, "sábado": 5, "domingo": 6,
}

# Columnas de las hojas exportadas del SIS (MCDA, MIA)
C_GRADO, C_CODE, C_NAME, C_SECTION, C_CLASS = 0, 2, 4, 5, 6
C_START, C_END, C_TSTART, C_TEND, C_DAYS, C_ROOM, C_TEACHER = 10, 11, 12, 13, 14, 15, 16
C_TOTAL_HRS, C_SCHED_HRS, C_COMBINED = 19, 30, 35


def clean_name(s):
    s = re.sub(r"\S+@\S+", "", s or "").strip(" -")
    if not s or s.lower() == "por asignar":
        return None
    small = {"de", "del", "la", "las", "los", "y"}
    return " ".join(w.lower() if w.lower() in small else w.capitalize() for w in s.split())


def sis_teacher(raw):
    # "1000259651-CC-1060647014-NOMBRE APELLIDO-Profesor Titular" -> "Nombre Apellido"
    if not raw:
        return None
    parts = str(raw).split("-")
    return clean_name(parts[3] if len(parts) >= 4 else raw)


def program_for_code(code, sheet):
    if sheet == "MIA":
        return "MIA"
    if re.match(r"^(SI|NM)7", code):
        return "MCDA"
    if re.match(r"^(SI|NM)6", code):
        return "ECD"
    return None  # pregrado / doctorado combinados


def hhmm(t):
    return str(t)[:5]


def to_date(v):
    return v.date() if isinstance(v, dt.datetime) else v


def daterange(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


# ---------------------------------------------------------------- festivos

def parse_calendar_notes(ws):
    """Lee la columna de festivos y fechas académicas de la hoja de EDS."""
    holidays, academic = [], []
    target = None
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            if not isinstance(v, str):
                continue
            v = v.strip()
            if v == "Días festivos":
                target = holidays
            elif v.startswith("FECHAS ACADÉMICAS"):
                target = academic
            m = re.match(r"^(\d{2})/(\d{2})\s+\w+\s+-\s+(.+)$", v)
            if m and target is not None:
                d = dt.date(YEAR, int(m.group(2)), int(m.group(1))).isoformat()
                item = {"date": d, "name": m.group(3).strip()}
                if item not in target:
                    target.append(item)
    return holidays, academic


# ---------------------------------------------------------------- hojas SIS

def parse_sis(path, holidays):
    wb = openpyxl.load_workbook(path, data_only=True)
    holiday_set = {h["date"] for h in holidays}
    offerings, issues = [], []

    for sheet in ("MCDA", "MIA"):
        ws = wb[sheet]
        block = "Primer semestre"
        groups = defaultdict(list)
        order = []
        for r in ws.iter_rows(values_only=True):
            if r[C_GRADO] and isinstance(r[C_GRADO], str) and r[C_CODE] is None:
                label = r[C_GRADO].strip()
                if label != "Grado":
                    block = re.sub(r"\s+MCDA$", "", re.sub(r"\s+", " ", label)).capitalize()
                continue
            if r[C_CODE] is None or r[C_GRADO] == "Grado":
                continue
            key = (sheet, block, r[C_COMBINED] or f"{r[C_CODE]}-{r[C_SECTION]}")
            if key not in groups:
                order.append(key)
            groups[key].append(r)

        for key in order:
            rows = groups[key]
            sheet, block, _ = key
            codes, seen = [], set()
            for r in rows:
                if r[C_CODE] not in seen:
                    seen.add(r[C_CODE])
                    codes.append({"code": r[C_CODE], "level": r[C_GRADO], "class": r[C_CLASS],
                                  "program": program_for_code(r[C_CODE], sheet)})
            programs = sorted({c["program"] for c in codes if c["program"]},
                              key=[p["id"] for p in PROGRAMS].index)
            # Nombre: el del código de posgrado principal
            main = next((r for r in rows if program_for_code(r[C_CODE], sheet) in ("MIA", "MCDA")), rows[0])
            name = main[C_NAME]
            # Las filas de reunión se repiten por cada código combinado: usar las del principal
            meetings = [r for r in rows if r[C_CODE] == main[C_CODE]]
            planned = main[C_TOTAL_HRS]
            directed = all(not r[C_ROOM] for r in meetings) and all(
                "domingo" in str(r[C_DAYS]).lower() for r in meetings)

            sessions = []
            for r in meetings:
                a, b = to_date(r[C_START]), to_date(r[C_END])
                wd = {DAYS[d.strip().lower()] for d in str(r[C_DAYS]).split(",")}
                n = 0
                for d in daterange(a, b):
                    if d.weekday() not in wd:
                        continue
                    if d.isoformat() in holiday_set:
                        issues.append({"type": "festivo_omitido", "offering": None, "date": d.isoformat(),
                                       "detail": f"{name}: {r[C_DAYS]} {d.isoformat()} es festivo y se omitió"})
                        continue
                    n += 1
                    sessions.append({
                        "date": d.isoformat(), "start": hhmm(r[C_TSTART]), "end": hhmm(r[C_TEND]),
                        "room": r[C_ROOM] or None, "teacher": sis_teacher(r[C_TEACHER]),
                    })
                if n == 0:
                    issues.append({"type": "fila_sin_sesiones", "offering": None, "date": a.isoformat(),
                                   "detail": f"{name}: la fila {r[C_DAYS]} {a}–{b} no produce ninguna fecha"})
            sessions.sort(key=lambda s: (s["date"], s["start"]))
            section = str(main[C_SECTION])
            # MIA es una sola cohorte aunque sus secciones tengan números distintos
            cohort = "1" if sheet == "MIA" else section
            offerings.append({
                "id": f"{sheet}-{main[C_CODE]}-{section}-{block[:3].lower()}",
                "source": "sis",
                "sheet": sheet,
                "programs": programs,
                "course": name,
                "codes": codes,
                "semester": block,
                "group": cohort,
                "section": section,
                "plannedHours": planned,
                "directed": directed,
                "sessions": [] if directed else sessions,
                "start": min(to_date(r[C_START]) for r in meetings).isoformat(),
                "end": max(to_date(r[C_END]) for r in meetings).isoformat(),
                "teachers": sorted({s["teacher"] for s in sessions if s["teacher"]}),
                "rooms": sorted({s["room"] for s in sessions if s["room"]}),
            })
    return offerings, issues


# ---------------------------------------------------------------- hoja EDS

def parse_eds(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["2027-1 V1"]
    grid = {(c.row, c.column): c.value for row in ws.iter_rows() for c in row
            if c.value is not None and str(c.value).strip()}
    val = lambda r, c: str(grid.get((r, c), "")).strip()

    # Bloques de semestre según los títulos de la columna A
    sections = sorted((r, v) for (r, c), v in grid.items() if c == 1 and isinstance(v, str) and "ESPECIALIZACIÓN" in v)

    def semester_for(row):
        label = "Primer semestre"
        for r, v in sections:
            if r <= row:
                label = {"PRIMER": "Primer semestre", "SEGUNDO": "Segundo semestre",
                         "ELECTIVAS": "Electivas"}[v.split()[0]]
        return label

    offerings = []
    for (r, c), v in sorted(grid.items()):
        if not (isinstance(v, str) and v.startswith("Periodo:")):
            continue
        # Hacia arriba desde "Periodo": docentes, horas, códigos, grupo, nombre
        teachers, codes, group, name = [], [], None, None
        rr = r - 1
        while rr > r - 12 and name is None:
            t = val(rr, c)
            if not t:
                pass
            elif re.match(r"^\d+ Horas$", t):
                pass
            elif t.startswith("("):
                m = re.match(r"^\(([A-Z]{2}\d{4})\)\s*(?:->\s*(.+))?$", t)
                if m:
                    codes.insert(0, {"code": m.group(1), "level": m.group(2), "class": None,
                                     "program": "EDS" if (m.group(2) or "") == "Pos" else None})
            elif t.startswith("Grupo"):
                group = t.split()[-1]
            else:
                if codes or group:
                    name = t
                    break
                teachers.insert(0, t)
            rr -= 1
        # Columnas de la tabla Día | Fechas | Horario | Ses. | Hrs
        hdr = r + 1
        cols = {}
        for cc in range(c, c + 12):
            if (hdr, cc) in grid:
                cols.setdefault(val(hdr, cc), cc)
        if cols.get("Día") != c:
            continue
        sessions, issues = [], []
        rr = hdr + 1
        while val(rr, c) and val(rr, c) != "TOTAL":
            day = val(rr, c)
            horario = val(rr, cols["Horario"]).replace(" ", "")
            t0, t1 = [f"{int(x.split(':')[0]):02d}:{x.split(':')[1]}" for x in horario.split("-")]
            for ds in re.findall(r"(\d{2})/(\d{2})", val(rr, cols["Fechas (dd/mm)"])):
                d = dt.date(YEAR, int(ds[1]), int(ds[0]))
                if d.weekday() != DAYS[day.lower()]:
                    issues.append({"type": "dia_no_coincide", "date": d.isoformat(),
                                   "detail": f"{name}: {d.strftime('%d/%m')} está listado como {day}"})
                sessions.append({"date": d.isoformat(), "start": t0, "end": t1, "room": None,
                                 "teacher": None})
            rr += 1
        sessions.sort(key=lambda s: (s["date"], s["start"]))
        names = [n for n in (clean_name(t) for t in teachers) if n]
        for s in sessions:
            s["teacher"] = ", ".join(names) or None
        m = re.findall(r"(\d{2})/(\d{2})/(\d{4})", v)
        semester = semester_for(r)
        main = next((x["code"] for x in codes if x["program"] == "EDS"), codes[0]["code"] if codes else name)
        offerings.append({
            "id": f"EDS-{main}-{group or '1'}-{semester[:3].lower()}",
            "source": "eds",
            "sheet": "EDS",
            "programs": ["EDS"],
            "course": name,
            "codes": codes,
            "semester": semester,
            "group": group or "1",
            "section": group or "1",
            "plannedHours": int(re.match(r"\d+", next(val(x, c) for x in range(r - 8, r)
                                                       if re.match(r"^\d+ Horas$", val(x, c)))).group()),
            "directed": False,
            "sessions": sessions,
            "start": dt.date(int(m[0][2]), int(m[0][1]), int(m[0][0])).isoformat(),
            "end": dt.date(int(m[1][2]), int(m[1][1]), int(m[1][0])).isoformat(),
            "teachers": names,
            "rooms": [],
            "_issues": issues,
        })
    holidays, academic = parse_calendar_notes(ws)
    return offerings, holidays, academic


# ---------------------------------------------------------------- validaciones

def minutes(t):
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def validate(offerings, holidays):
    issues = []
    hol = {h["date"]: h["name"] for h in holidays}
    for o in offerings:
        issues += [dict(i, offering=o["id"]) for i in o.pop("_issues", [])]
        if o["directed"]:
            continue
        hours = sum(minutes(s["end"]) - minutes(s["start"]) for s in o["sessions"]) / 60
        o["scheduledHours"] = hours
        if o["plannedHours"] and abs(hours - o["plannedHours"]) > 0.01:
            issues.append({"type": "horas", "offering": o["id"],
                           "detail": f"{hours:g} h programadas de {o['plannedHours']} h"})
        for s in o["sessions"]:
            if s["date"] in hol:
                issues.append({"type": "festivo", "offering": o["id"], "date": s["date"],
                               "detail": f"Sesión en festivo: {hol[s['date']]}"})
        if not o["teachers"]:
            issues.append({"type": "sin_docente", "offering": o["id"], "detail": "Docente por asignar"})
        elif any(not s["teacher"] for s in o["sessions"]):
            n = sum(1 for s in o["sessions"] if not s["teacher"])
            issues.append({"type": "sin_docente", "offering": o["id"],
                           "detail": f"{n} sesión(es) sin docente (evaluación final u otra)"})
        if o["source"] == "sis":
            n = sum(1 for s in o["sessions"] if not s["room"])
            if n:
                issues.append({"type": "sin_aula", "offering": o["id"],
                               "detail": f"{n} sesión(es) sin aula asignada"})

    # Cruces: misma aula, mismo docente o misma cohorte a la misma hora
    def overlaps(key_fn, kind, label):
        buckets = defaultdict(list)
        for o in offerings:
            for s in o["sessions"]:
                for k in key_fn(o, s):
                    buckets[(s["date"], k)].append((o, s))
        seen = set()
        for (date, k), items in buckets.items():
            for i in range(len(items)):
                for j in range(i + 1, len(items)):
                    (o1, s1), (o2, s2) = items[i], items[j]
                    if o1["id"] == o2["id"]:
                        continue
                    if minutes(s1["start"]) < minutes(s2["end"]) and minutes(s2["start"]) < minutes(s1["end"]):
                        sig = (kind, date, k, *sorted([o1["id"], o2["id"]]))
                        if sig in seen:
                            continue
                        seen.add(sig)
                        issues.append({"type": kind, "offering": o1["id"], "other": o2["id"], "date": date,
                                       "detail": f"{label} {k}: {o1['course']} y {o2['course']} "
                                                 f"({s1['start']}–{s1['end']} / {s2['start']}–{s2['end']})"})

    overlaps(lambda o, s: [s["room"]] if s["room"] else [], "cruce_aula", "Aula")
    overlaps(lambda o, s: [t.strip() for t in (s["teacher"] or "").split(",") if t.strip()],
             "cruce_docente", "Docente")
    overlaps(lambda o, s: [f"{p} · {o['semester']} · Grupo {o['group']}" for p in o["programs"]]
             if o["semester"] != "Electivas" else [], "cruce_cohorte", "Cohorte")
    return issues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sis", required=True, help="Excel exportado del SIS (hojas MCDA, MIA)")
    ap.add_argument("--eds", required=True, help="Excel del calendario de la Especialización en Desarrollo de Software")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "docs/data/programacion.json"))
    args = ap.parse_args()

    eds, holidays, academic = parse_eds(args.eds)
    sis, sis_issues = parse_sis(args.sis, holidays)
    offerings = sis + eds
    issues = validate(offerings, holidays)
    # Los festivos omitidos en filas del SIS son esperados; solo se reportan si no fueron previstos
    issues += [i for i in sis_issues if i["type"] != "festivo_omitido"]

    data = {
        "period": "2027-1",
        "generated": dt.datetime.now().isoformat(timespec="minutes"),
        "programs": PROGRAMS,
        "holidays": holidays,
        "academicDates": academic,
        "offerings": offerings,
        "issues": issues,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    n_sessions = sum(len(o["sessions"]) for o in offerings)
    print(f"{len(offerings)} cursos, {n_sessions} sesiones, {len(issues)} alertas -> {args.out}")


if __name__ == "__main__":
    main()
