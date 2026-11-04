# Programación académica 2027-1 · Posgrados

Tablero web de la programación académica de:

- **MIA** — Maestría en Inteligencia Artificial
- **MCDA** — Maestría en Ciencia de Datos y Analítica
- **ECD** — Especialización en Ciencia de Datos y Analítica
- **EDS** — Especialización en Desarrollo de Software

Vistas: resumen por programa, cronograma (Gantt) del semestre, **semana y electivas**
(calendario semanal por horas donde los cursos simultáneos se ven lado a lado, con un
planificador para probar la franja de una electiva y ver con qué cohortes y electivas
coincide, más un mapa de ocupación por día y hora), calendario mensual,
tabla de cursos (con descarga CSV de todas las sesiones), carga docente y alertas
automáticas (cruces de aula/docente/cohorte, sesiones en festivo, horas incompletas,
docentes y aulas por asignar). Los filtros se guardan en la URL, así que un enlace
filtrado se puede compartir.

## Estructura

```
docs/                 sitio estático (GitHub Pages sirve esta carpeta)
  index.html, app.js, styles.css
  data/programacion.json   datos ya procesados (lo único que se publica)
scripts/build_data.py convierte los Excel en el JSON
```

## Actualizar los datos

Los Excel **no se suben al repositorio** (contienen cédulas e IDs de docentes).
Ponlos en una carpeta `excel/` (ignorada por git) o en cualquier otra ruta y ejecuta:

```bash
uv run --with openpyxl python scripts/build_data.py \
  --sis "excel/MCDA,MMA,DIM,MIA 4.xlsx" \
  --eds "excel/Calendario Posgrado 2027-1.xlsx"
git add docs/data/programacion.json && git commit -m "Actualiza programación" && git push
```

(Sin `uv`: `pip install openpyxl` y `python scripts/build_data.py ...`.)

Qué lee el script:

- **Excel del SIS** (`--sis`): hojas `MCDA` y `MIA`. Las filas con el mismo
  *ID Sección Combinada* se agrupan en un solo curso. Los códigos `SI7xxx/NM7xxx`
  se asignan a MCDA, `SI6xxx/NM6xxx` a ECD; los demás (pregrado, doctorado) se
  muestran como códigos combinados. Las sesiones se generan con cada día de la
  semana entre la fecha inicial y final de cada franja, omitiendo festivos.
- **Calendario EDS** (`--eds`): hoja `2027-1 V1`, bloques de cada curso con sus
  fechas explícitas, y la lista de festivos y fechas académicas.

Del JSON se excluyen cédulas, IDs, correos y notas internas de las hojas.

## Ver localmente

```bash
python3 -m http.server 8000 --directory docs
# abrir http://localhost:8000
```

## Publicar en GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `/docs`.
