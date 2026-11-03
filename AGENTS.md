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
- Cron: GitHub Actions (`.github/workflows/cron.yml`) llama cada hora a `POST /api/cron/` con `X-Cron-Token`
  (`CRON_TOKEN` en Render y como secret del repo). `core/cron.py`: recurrentes, tareas de servicios, avisos de deadlines
  (desde las 8 h), resumen diario por email (una vez por día), emails a clientes (desde las 9 h) y limpieza. Si el cron
  no corrió en 2 h, al abrir Tareas o Mi panel se hacen los pasos livianos (`cron.respaldo`).
- Emails: salen del Gmail de la agencia (`notificaciones/email.py`). Fuera de producción solo se registran en el log
  (`EMAILS_SOLO_LOG`). Prueba local: `DATABASE_URL= GOOGLE_CALENDAR_SOLO_LECTURA=1 NOTION_TOKEN= EMAILS_SOLO_LOG=1`.

## Stack

- **Backend** (`backend/`): Django 6 + DRF + simplejwt. Apps en `backend/apps/`:
 - `accounts`: usuarios con acceso `admin` / `equipo` (vinculados a una `Persona`), JWT, y la cuenta de Google fija de
 la agencia (`google.py`: refresh token cifrado, entrega access tokens en `/api/auth/google/token/`). Los de equipo
 tienen uno o varios `roles` (CM, editor, diseño, foto, colaborador); las secciones extra de cada rol están en
 `PERMISOS_POR_ROL` (`accounts/models.py`) y se chequean con `requiere_permiso` / `tiene_permiso` (`core/permissions.py`).
 Todo el equipo ve todas las tareas y edita las suyas; las sin cliente son «AuraTeam - Gestión Interna» (no es un
 cliente) y las edita cualquiera (`es_interna`, salvo las de pagos de servicios). Los eventos del calendario solo los
 edita quien los creó.
  - `clientes`: Cliente, Contrato, Cobro (generación de cobros, registrar pago, ajustes de precio).
    Onboarding (`onboarding.py`): al crear un cliente, los `PasoOnboarding` activos (plantilla en Configuración →
    Onboarding) se vuelven tareas `onboarding=True` asignadas por rol; el paso `accion='drive'` vincula
    la carpeta del cliente en `Mi unidad/CLIENTES` (`integraciones/drive.py`, scope `drive` completo): busca por nombre o
    razón social y solo crea si no existe; CLIENTES nunca se crea (`DRIVE_CARPETA_CLIENTES` fija su id). Si falla queda
    manual (pegar el link en la ficha). «Vincular carpetas existentes» (Configuración → Google) nunca crea.
    Emails a clientes (`envios.py`, registro en `EnvioCliente`): reporte del mes anterior como borrador el día
    `ConfigEnvios.dia_reporte` (sin datos de dinero, `reporte_cliente.py`; `Cliente.reporte_auto` lo manda solo) y
    recordatorios de cobro por etapas (antes, el día, +N días) para clientes con `recordatorios_cobro`.
  - `equipo`: Persona, Tarea, AsignacionTarea, AsignacionCliente, Liquidacion. Los repartos de un cobro entre el
    equipo son **manuales** (`services.repartir_cobro`); las asignaciones fijas son solo referencia.
    `TareaRecurrente`: plantillas (p. ej. historias diarias) que `services.generar_recurrentes` convierte en tareas
    hasta fin del mes en curso (desde su última semana, también el siguiente) al listar tareas o abrir Mi panel;
    Notion y Google las reciben de a tandas en las sincronizaciones incrementales.
 «Plan del mes» (`POST /api/tareas/plan/`, admins y CM en sus clientes asignados): crea varias tareas de un cliente
 de una vez; la copia del mes anterior (mismo día de la semana) se arma en el frontend (`PlanMesModal.jsx`).
 La sincronización incremental de Notion sube de a tandas cualquier tarea sin página, no solo las recurrentes.
    Dependencias (`Tarea.depende_de`, `services.ajustar_por_dependencias`, `dependencias.propagar`): mientras espere a
    tareas no Hechas queda `bloqueada` con `bloqueo_auto` y no puede avanzar (400 en el panel; desde Notion vuelve a
    Bloqueada). Si alguien la deja Bloqueada mientras espera, cuenta como bloqueo automático. Cuando la última pasa a Hecha (o se
    borra) vuelve a Por hacer y avisa por mail a sus responsables. Al pasar a Hecha (o al vincular una ya Hecha), sus
    `links` se suman a los de la que depende (`heredar_links`, sin repetir URLs).
    Sin ciclos. En Notion van como la relación «Bloqueada por» (dual con «Bloquea», en las dos bases); las que Notion no
    puede mostrar (previa sin página o de la otra base) se conservan en el panel. Los pasos de onboarding
    (`PasoOnboarding.despues_de`) y las filas del Plan del mes (`despues_de`: índice de una fila anterior) se encadenan.
    Horario opcional: `fecha_inicio` (rango hasta `fecha_limite`, que sigue siendo el vencimiento), `hora_inicio` y
    `hora_fin` (también en `TareaRecurrente`); van en la propiedad «Fecha» de Notion y como evento con hora en Google.
    Solo entran en la huella de Notion cuando están cargados. Mover o estirar en Google el evento de una tarea le cambia
    fecha y horario en el panel (`aplicar_movimiento_tarea`), salvo que el panel tenga cambios sin subir.
    «Equipo hoy» (`seguimiento.py`, `GET /api/equipo/seguimiento/`, solo admins): vencidas, de hoy, próximas,
    en revisión y % de cumplimiento en fecha (7 y 30 días) por persona.
  - `finanzas`: transacciones (ingresos/egresos) y categorías. Flujo de caja proyectado (`proyeccion.py`,
    `GET /api/finanzas/proyeccion/?meses=`, solo admins, card en el Dashboard): cobros, contratos sin cobro generado,
    deuda atrasada, suscripciones y pagos al equipo; lo que falta se estima con el promedio de los 3 meses anteriores.
    Pagos al equipo: al pagar una liquidación la persona recibe mail con el detalle y link al recibo; las que llevan
    7 días sin pagar avisan a los admins, y el resumen diario las lista. `stats`: reportes.
  - `servicios`: suscripciones. Con `pagador` (Persona) y filas del reparto vinculadas a personas, `services.py`
    genera `dias_aviso` días antes la tarea «Pagar …» y las «Transferir …» (`AvisoServicio`, etiqueta `pagos`).
    Completar la de pago registra el egreso del período. Llevan montos: no van a Notion y el equipo solo ve las suyas.
    Recordatorios por mail (`recordatorios_de_servicios`, cron desde las 8 h): etapas antes (`dias_aviso`), el día y +2
    mientras siga pendiente; un solo mail por persona y día, y las que paga la agencia van a los admins. Crear la tarea
    avisa solo por la campana. «Mis suscripciones» en Mi panel (`suscripciones_de`).
  - `notificaciones`: campana (`Notificacion`, dedupe por `clave`) y emails. `services.notificar` y los disparos
    (`al_asignar`, `al_cambiar_estado`, `asignadas_en_tanda`); las tareas privadas nunca avisan a no admins.
    `User.notif_email` apaga los emails personales.
  - `integraciones`: sincronización de Tareas con Notion en los dos sentidos (`notion.py`). Panel → Notion al guardar
    desde la API; Notion → panel por webhook (`/api/notion/webhook/`), incremental al abrir Tareas y completa manual.
    Para no pasar el tope de bloques del plan de Notion, ahí solo están las recurrentes hasta el domingo de la semana
    (desde el sábado, también la siguiente; `fin_de_ventana`) y las Hechas de los últimos 7 días: el resto lo saca
    `sacar_de_notion` (cron y sincronización incremental), que corta el vínculo antes de mandar la página a la
    papelera, así la tarea sigue en el panel. Nunca borrar tareas a mano en Notion: la papelera borra la tarea del panel.
    Nombres de propiedades/opciones de Notion como constantes al inicio de `notion.py`: si Claude los cambia en Notion,
    hay que actualizarlos ahí. Un fallo de Notion nunca debe impedir guardar en el panel. Las tareas con etiqueta
    privada van a otra base, «Tareas · CEOs» (`NOTION_TAREAS_PRIVADAS_DS`, mismas propiedades), compartida solo con
    los socios; al cambiar de etiqueta la página se muda de base (`Tarea.notion_privada`).
  - `calendario`: eventos del panel y Google Calendar (`google_calendar.py`). Cada etiqueta es un calendario de la
    cuenta de la agencia (`CalendarioGoogle`): las 6 base (CEOs, Coberturas, Historias, Posteos, Edición, Reuniones &
    Briefing) más los calendarios nuevos, que se detectan solos al sincronizar. Lista y reglas en `etiquetas.py`:
    las privadas (CEOs siempre, y las que un admin marque «Solo socios») solo las ven y usan los admins en eventos,
    tareas, Mi panel y reportes; las ocultas no se ofrecen ni se sincronizan. El cliente se distingue por el color del
    evento (`Cliente.google_color`). Las tareas con fecha van como día completo al calendario de su etiqueta (cualquiera).
    Un fallo de Google nunca debe impedir guardar en el panel.
  - `core` (permisos `IsAdmin`, comandos), `api` (config, export/import).
- **Frontend** (`frontend/`): React 19 + Vite + react-query + zustand, CSS propio en `src/styles/` (sin Tailwind).
  - Claves de react-query en `src/lib/queryKeys.js`; tras mover dinero invalidá con `invalidar(qc, DINERO)`.
  - Acciones destructivas pasan por `confirmar(...)` (`src/store/confirmStore`).
  - `QueryState` recibe un único hijo función.
  - Lint con reglas de react-hooks v7: nada de `setState` sincrónico dentro de efectos.
  - Etiquetas de eventos/tareas con `useEtiquetas()` (`GET /api/calendario/etiquetas/`), no constantes.
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
