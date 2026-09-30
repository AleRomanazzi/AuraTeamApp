# AuraTeam · Panel de gestión de la agencia

Contexto para agentes de IA (Cursor, Claude Code) que trabajan en este repo. Respondé siempre en **español**.

## Coordinación Claude ↔ Cursor

- El workspace de Notion de AuraTeam lo trabaja Claude; el código del panel, Cursor. La página de Notion
  **Dirección → 🤝 Coordinación Claude ↔ Cursor** (https://app.notion.com/p/3eb3a68b2dd8813988b4cac0a541816d)
  tiene las fuentes de verdad, los mapeos Notion ↔ panel, las preguntas abiertas y una bitácora.
- Leela antes de tocar algo que afecte a Notion (sincronización, clientes, tareas, contratos) y dejá una entrada en
  la bitácora al terminar.
- **El dinero vive solo en el panel** (NeonDB): cobros, pagos al equipo, movimientos, suscripciones. Notion no es
  fuente de verdad de montos.

## Producción

- Panel: https://aurateamapp.netlify.app (Netlify, build de `frontend/`, ver `netlify.toml`).
- API: https://aura-backend-rj63.onrender.com (Render, plan free, disco efímero; ver `render.yaml`). Salud: `/api/health/`.
  El deploy corre `backend/build.sh` (collectstatic + migrate) en cada push a `main`.
- Base: Neon Postgres, proyecto `empty-grass-50367051`, rama de producción `br-delicate-voice-ac1f536q`.
- **`backend/.env` apunta a la base de PRODUCCIÓN.** Para trabajar local anteponé `DATABASE_URL=` a los comandos de
  Django (usa SQLite). Cualquier comando que modifique producción requiere confirmación explícita del usuario.
- Nunca imprimas ni commitees secretos (`backend/.env`, `client_secret_*.json`).

## Stack

- **Backend** (`backend/`): Django 6 + DRF + simplejwt. Apps en `backend/apps/`:
 - `accounts`: usuarios con acceso `admin` / `equipo` (vinculados a una `Persona`), JWT, y la cuenta de Google fija de
 la agencia (`google.py`: refresh token cifrado, entrega access tokens en `/api/auth/google/token/`). Los de equipo
 tienen uno o varios `roles` (CM, editor, diseño, foto, colaborador); las secciones extra de cada rol están en
 `PERMISOS_POR_ROL` (`accounts/models.py`) y se chequean con `requiere_permiso` / `tiene_permiso` (`core/permissions.py`).
 Todo el equipo ve todas las tareas y edita las suyas; los eventos del calendario solo los edita quien los creó.
  - `clientes`: Cliente, Contrato, Cobro (generación de cobros, registrar pago, ajustes de precio).
  - `equipo`: Persona, Tarea, AsignacionTarea, AsignacionCliente, Liquidacion. Los repartos de un cobro entre el
    equipo son **manuales** (`services.repartir_cobro`); las asignaciones fijas son solo referencia.
    `TareaRecurrente`: plantillas (p. ej. historias diarias) que `services.generar_recurrentes` convierte en tareas
    hasta fin del mes en curso (desde su última semana, también el siguiente) al listar tareas o abrir Mi panel;
    Notion y Google las reciben de a tandas en las sincronizaciones incrementales.
  - `finanzas`: transacciones (ingresos/egresos) y categorías. `servicios`: suscripciones. `stats`: reportes.
  - `integraciones`: sincronización de Tareas con Notion en los dos sentidos (`notion.py`). Panel → Notion al guardar
    desde la API; Notion → panel por webhook (`/api/notion/webhook/`), incremental al abrir Tareas y completa manual.
    Nombres de propiedades/opciones de Notion como constantes al inicio de `notion.py`: si Claude los cambia en Notion,
    hay que actualizarlos ahí. Un fallo de Notion nunca debe impedir guardar en el panel.
  - `calendario`: eventos del panel y Google Calendar (`google_calendar.py`). Cada etiqueta (CEOs, Coberturas,
    Historias, Posteos, Edición, Reuniones & Briefing) es un calendario de la cuenta de la agencia; el cliente se
    distingue por el color del evento (`Cliente.google_color`). Las tareas con fecha van como día completo al
    calendario de su etiqueta. CEOs es solo para admins. Un fallo de Google nunca debe impedir guardar en el panel.
  - `core` (permisos `IsAdmin`, comandos), `api` (config, export/import).
- **Frontend** (`frontend/`): React 19 + Vite + react-query + zustand, CSS propio en `src/styles/` (sin Tailwind).
  - Claves de react-query en `src/lib/queryKeys.js`; tras mover dinero invalidá con `invalidar(qc, DINERO)`.
  - Acciones destructivas pasan por `confirmar(...)` (`src/store/confirmStore`).
  - `QueryState` recibe un único hijo función.
  - Lint con reglas de react-hooks v7: nada de `setState` sincrónico dentro de efectos.
  - Gmail/Calendar usan gapi con el token que entrega el backend (`src/features/google/gapiClient.js`).

## Comandos

```bash
# Backend (desde backend/, con el venv en .venv)
DATABASE_URL= .venv/bin/python -m pytest -q
DATABASE_URL= .venv/bin/python manage.py makemigrations --check --dry-run
DATABASE_URL= .venv/bin/python manage.py runserver

# Frontend (desde frontend/)
npm run lint
npm run build
npm run dev
```

Antes de dar por terminado un cambio: tests del backend, `makemigrations --check`, lint y build del frontend.

## Convenciones

- Código, nombres de modelos/campos y textos de UI en español rioplatense.
- Seguí el estilo del código que rodea al cambio; comentarios solo para restricciones que el código no muestra.
- Commits en español con prefijo tipo `feat(...)`, `fix(...)`, `chore(...)`. No hacer push sin que el usuario lo pida.
