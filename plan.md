# Aura Team — Plan de migración a stack React + Django + NeonDB

## Contexto

Existe un prototipo monolítico en un único archivo HTML (`AURA_TEAM_V4.html`, ~1600 líneas) que implementa un "Centro de Control" personal/de equipo con dashboard, gestión financiera, división de gastos, equipo, tareas, integración Gmail/Calendar y análisis de estadísticas con IA. Toda la persistencia hoy es `localStorage`.

El objetivo de esta migración es **replicar exactamente la UI, la UX y todas las funcionalidades actuales** del HTML, pero distribuyendo el sistema en:

- **Frontend**: React 18 + Vite + TailwindCSS + React Router
- **Backend**: Django 5 + Django REST Framework + SimpleJWT
- **Base de datos**: NeonDB (PostgreSQL serverless) vía `psycopg2-binary`
- **Almacenamiento de archivos** (adjuntos, screenshots): primera fase en `MEDIA_ROOT` local; dejar interfaz preparada para migrar a S3-compatible.

> **Regla de oro**: la app final debe verse y comportarse igual al HTML original. No reinterpretar diseño, no cambiar paleta, no cambiar copy, no agregar funcionalidades fuera de las listadas en este plan. Si una decisión técnica obliga a cambiar algo visible, dejarlo igual al HTML y registrar la justificación en un comentario.

---

## 1. Estructura del repositorio

Crear un monorepo con dos carpetas hermanas más la raíz con orquestación:

```
aura-team/
├── README.md
├── .gitignore
├── docker-compose.yml          # opcional fase 2; por ahora dejar TODO
├── .env.example                # variables compartidas (DB_URL, etc.)
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   ├── .env.example            # VITE_API_URL=http://localhost:8000/api
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── router.jsx
│       ├── styles/
│       │   ├── globals.css     # @tailwind + variables CSS originales
│       │   └── tokens.css      # paleta exacta del HTML como CSS vars
│       ├── lib/
│       │   ├── api.js          # cliente axios con interceptor JWT
│       │   ├── auth.js
│       │   ├── format.js       # fmt() del HTML, formatDate()
│       │   └── notify.js       # equivalente a notify() del HTML
│       ├── store/
│       │   └── useAppStore.js  # Zustand: cache de datos del backend
│       ├── components/
│       │   ├── layout/
│       │   │   ├── Sidebar.jsx
│       │   │   ├── Topbar.jsx
│       │   │   ├── PageShell.jsx
│       │   │   └── Hamburger.jsx
│       │   ├── ui/
│       │   │   ├── Card.jsx
│       │   │   ├── StatCard.jsx
│       │   │   ├── Button.jsx
│       │   │   ├── Badge.jsx
│       │   │   ├── Tag.jsx
│       │   │   ├── Modal.jsx
│       │   │   ├── ProgressBar.jsx
│       │   │   ├── Notification.jsx
│       │   │   └── BarChart.jsx
│       │   └── forms/
│       │       └── FormRow.jsx
│       ├── pages/
│       │   ├── Dashboard.jsx
│       │   ├── Ingresos.jsx
│       │   ├── Servicios.jsx
│       │   ├── Personal.jsx
│       │   ├── Perfiles.jsx
│       │   ├── Gmail.jsx
│       │   ├── Calendar.jsx
│       │   ├── Estadisticas.jsx
│       │   └── Config.jsx
│       └── features/
│           ├── transacciones/  # hooks, modales, helpers por dominio
│           ├── servicios/
│           ├── personal/
│           ├── tareas/
│           ├── calendario/
│           ├── gmail/
│           └── stats/
│
└── backend/
    ├── manage.py
    ├── pyproject.toml          # poetry o requirements.txt; elegir uno
    ├── requirements.txt
    ├── .env.example            # DATABASE_URL (Neon), SECRET_KEY, CORS_ORIGINS
    ├── config/
    │   ├── __init__.py
    │   ├── settings.py
    │   ├── urls.py
    │   ├── asgi.py
    │   └── wsgi.py
    └── apps/
        ├── accounts/           # User custom + JWT
        ├── finanzas/           # Transacciones, Adjuntos
        ├── servicios/          # Servicios compartidos
        ├── equipo/             # Personal, Tareas, Asignaciones
        ├── calendario/         # ClienteMensual, EventoUnico
        ├── integraciones/      # Gmail/Calendar (placeholder)
        └── stats/              # Estadísticas con IA
```

---

## 2. Mapeo exacto de funcionalidades del HTML

Cada ítem indica el archivo origen (todas las funciones viven en el `<script>` del HTML), el endpoint REST que lo reemplaza y el componente React responsable. **Cursor: no omitir ninguno.**

### 2.1 Estado global (objeto `state` del HTML, líneas ~736-742)

```js
state = {
  transacciones: [], servicios: [], emails: [], events: [],
  personal: [], tareas: [], calClientes: [], calEventos: [],
  config: { apiKey, clientId, gmail, moneda, nombre },
  googleConnected: false
}
```

Todo lo que hoy está en `state.*` debe pasar a tablas en NeonDB salvo `emails` y `events` que vienen de Google APIs (cache opcional). Ver §4 para el modelo.

### 2.2 Páginas (8 + config) — coinciden 1:1 con rutas

| HTML page id     | Ruta React        | Componente        |
|------------------|-------------------|-------------------|
| `page-dashboard` | `/`               | `Dashboard.jsx`   |
| `page-ingresos`  | `/ingresos`       | `Ingresos.jsx`    |
| `page-servicios` | `/servicios`      | `Servicios.jsx`   |
| `page-personal`  | `/personal`       | `Personal.jsx`    |
| `page-perfil`    | `/perfiles`       | `Perfiles.jsx`    |
| `page-gmail`     | `/gmail`          | `Gmail.jsx`       |
| `page-calendar`  | `/calendar`       | `Calendar.jsx`    |
| `page-estadisticas` | `/estadisticas` | `Estadisticas.jsx`|
| `page-config`    | `/config`         | `Config.jsx`      |

Sidebar y topbar idénticos al HTML, incluyendo el badge de fecha (`date-badge`) y el indicador de estado de Google (`google-status`).

### 2.3 Inventario completo de funciones JS a portar

Todas estas funciones existen en el HTML y deben tener equivalente en React (hook, handler o componente). Marcar entre paréntesis si es lógica de UI pura o si llama al backend.

**Navegación / shell**
- `showPage(name)` → React Router (UI)
- `toggleSidebar()`, `closeSidebar()` → estado local en `Sidebar.jsx` (UI)
- `setCurrentDate()` → componente `Topbar` (UI)
- `notify(msg, type)` → `lib/notify.js` con toaster (UI)
- `openModal(id)`, `closeModal(id)` → `<Modal>` controlado (UI)

**Persistencia**
- `loadState()`, `saveState()` → reemplazar por queries al backend vía `lib/api.js` + cache en Zustand
- `exportData()`, `importData()`, `clearData()` → endpoints `GET/POST /api/me/export`, `POST /api/me/import`, `DELETE /api/me/data`

**Transacciones (Ingresos & Egresos)**
- `openNuevaTx()`, `editarTransaccion(id)`, `guardarTransaccion()` → `POST/PUT /api/transacciones/`
- `eliminarTransaccion(id)` → `DELETE /api/transacciones/{id}/`
- `filtrarTransacciones()`, `renderTransacciones()` → query params `?mes=YYYY-MM&tipo=&categoria=`
- `abrirAdjunto(txId)`, `guardarAdjunto()`, `eliminarAdjunto(txId, adjId)` → `POST /api/transacciones/{id}/adjuntos/`, `DELETE /api/adjuntos/{id}/` (multipart)
- `exportCSV()` → `GET /api/transacciones/export.csv`

**Servicios (división de gastos)**
- `guardarServicio()`, `eliminarServicio(id)`, `renderServicios()` → CRUD `/api/servicios/`
- `toggleMetodo()`, `buildPersonas()`, `calcularDivision()`, `renderResultados()` → puramente UI (lógica en cliente, no toca backend)
- `guardarServicioDesdeCalc()` → `POST /api/servicios/`

**Personal (equipo)**
- `openNuevoPersonal()`, `editarPersonal(id)`, `guardarPersonal()`, `eliminarPersonal(id)`, `renderPersonal()` → CRUD `/api/personal/`
- `actualizarSelectPersonas()` → derivado del store

**Perfiles & tareas**
- `guardarTarea()`, `eliminarTarea(id)`, `renderTareasGlobal()` → CRUD `/api/tareas/`
- `renderAsignacion()`, `guardarAsignacion()` → `GET/PUT /api/personal/{id}/tareas/`

**Gmail (integración Google API)**
- `loadGmail()`, `renderEmails()`, `viewEmail(id)`, `getEmailBody()`, `parseFrom()`, `filterEmails()`, `sendEmail()` → ver §6. En frontend, mantener llamadas directas al cliente GAPI inicialmente; el backend solo guarda credenciales OAuth.

**Calendario**
- `loadCalendar()`, `renderCalendario()` → mezcla de eventos locales + Google Calendar API
- `openModalEvento('unico'|'cliente')`, `crearEvento()` → guarda en `/api/cal-eventos/` o `/api/cal-clientes/`
- `eliminarCalCliente(id)`, `eliminarCalEvento(id)` → DELETE
- `buildMiniCal()` → componente `MiniCalendar.jsx` (UI)

**Estadísticas con IA**
- `handleDrop()`, `handleFiles()`, `renderPreviews()`, `removeImg()`, `checkReadyToAnalyze()` → UI de upload
- `analizarEstadisticas()` → `POST /api/stats/analizar/` (multipart con imágenes "antes" y "despues"); el backend llama a la API de IA y devuelve métricas + interpretación
- `limpiarEstadisticas()` → solo limpia estado local
- `exportarGoogleDocs()`, `exportarMarkdown()` → primera para integración Google (placeholder), segunda genera `.txt` desde el cliente

**Dashboard**
- `renderDashboard()` → reemplaza por `GET /api/dashboard/?mes=YYYY-MM` que devuelve totales agregados, últimos movimientos, próximos eventos, correos recientes

**Google APIs**
- `connectGoogle()`, `initGapiClient()`, `loadGoogleData()`, `updateGoogleStatus()`, `saveConfig()` → ver §6

**Helpers de formato**
- `fmt(n)` → `lib/format.js` con `Intl.NumberFormat('es-AR')`
- `formatDate(s)` → `lib/format.js`

### 2.4 Modales (todos del HTML)

Cada modal del HTML debe ser un componente React reutilizable basado en `<Modal>`:

- `modal-transaccion` (nueva/editar transacción)
- `modal-adjunto`
- `modal-servicio`
- `modal-personal` (nueva/editar persona)
- `modal-tarea`
- `modal-email` (redactar)
- `modal-evento` (único o cliente mensual; el cuerpo cambia según tipo)

---

## 3. Frontend — especificación

### 3.1 Stack y dependencias

```bash
npm create vite@latest frontend -- --template react
cd frontend
npm i react-router-dom axios zustand @tanstack/react-query
npm i -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Opcional pero recomendado: `react-hot-toast` para `notify()`, `date-fns` para formato de fechas, `react-dropzone` para los uploads de estadísticas.

### 3.2 Tailwind y diseño

- Replicar **exactamente** las variables CSS del HTML (`--bg`, `--surface`, `--surface2`, `--border`, `--accent #4fffb0`, `--accent2 #7c6fff`, `--accent3 #ff6b6b`, `--text`, `--text-muted`, `--text-dim`, `--gold #ffd166`).
- En `tailwind.config.js`, extender `theme.colors`, `fontFamily` (DM Serif Display, Outfit, DM Mono) y `borderRadius`.
- `globals.css` importa las fuentes desde Google Fonts igual que el HTML.
- Crear utilidades para los componentes recurrentes: `.btn`, `.btn-primary`, `.card`, `.tag-*`, `.stat-card`, `.staff-card` — pueden ser componentes React o `@apply` en CSS.
- Conservar **idéntico** el comportamiento responsivo ya implementado en el HTML (breakpoints 900/600/380px, sidebar con overlay, modales tipo bottom-sheet en móvil, scroll horizontal en tablas, inputs a 16px en móvil para evitar zoom iOS). Documentar esto en `styles/globals.css`.

### 3.3 Cliente API

```js
// src/lib/api.js
import axios from 'axios';
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });
api.interceptors.request.use(cfg => {
  const t = localStorage.getItem('aura_token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
export default api;
```

Usar **TanStack Query** para queries y mutaciones (sustituye al render manual del HTML). Ejemplo:

```js
const { data: transacciones } = useQuery({
  queryKey: ['transacciones', { mes, tipo, categoria }],
  queryFn: () => api.get('/transacciones/', { params: { mes, tipo, categoria } }).then(r => r.data),
});
```

### 3.4 Routing y layout

- `BrowserRouter` con un layout `<AppShell>` que renderiza `<Sidebar>`, `<Topbar>` y `<Outlet>`.
- Ruta `/login` aparte sin layout para autenticación.
- Guard que redirige a `/login` si no hay token.

### 3.5 Reglas de paridad visual

Para cada página, abrir el HTML, identificar la sección `<div class="page" id="page-XXX">` y reproducir su estructura nodo por nodo. No modificar emojis, copy, orden ni jerarquía de cards. Si se detecta una mejora obvia, dejarla para una fase posterior.

---

## 4. Backend — especificación

### 4.1 Stack y dependencias

```
Django==5.0.*
djangorestframework==3.15.*
djangorestframework-simplejwt==5.3.*
django-cors-headers==4.*
psycopg[binary]==3.2.*
python-dotenv==1.*
django-storages==1.14.*   # preparado para S3 a futuro
Pillow==10.*              # para validar/rotar imágenes
```

### 4.2 Configuración Neon

`backend/.env`:
```
DEBUG=False
SECRET_KEY=<generar>
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/aurateam?sslmode=require
CORS_ORIGINS=http://localhost:5173,https://<frontend-prod>
ALLOWED_HOSTS=localhost,127.0.0.1,<backend-prod>
```

`settings.py` parsea `DATABASE_URL` con `dj-database-url`:
```python
import dj_database_url
DATABASES = { 'default': dj_database_url.config(conn_max_age=600, ssl_require=True) }
```

Importante: Neon cierra conexiones inactivas; configurar `CONN_MAX_AGE=600` y considerar `pgbouncer`/`?pgbouncer=true` en la URL si Neon lo expone.

### 4.3 Modelos (Django ORM → tablas Neon)

```python
# apps/accounts/models.py
class User(AbstractUser):
    moneda = models.CharField(max_length=4, default='$')
    nombre_display = models.CharField(max_length=80, default='Yo')
    google_api_key = models.TextField(blank=True)
    google_client_id = models.TextField(blank=True)
    gmail_account = models.EmailField(blank=True)
    google_connected = models.BooleanField(default=False)

# apps/finanzas/models.py
class Transaccion(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='transacciones')
    fecha = models.DateField()
    descripcion = models.CharField(max_length=200)
    categoria = models.CharField(max_length=40)
    tipo = models.CharField(max_length=10, choices=[('ingreso','ingreso'),('egreso','egreso')])
    monto = models.DecimalField(max_digits=14, decimal_places=2)
    creado = models.DateTimeField(auto_now_add=True)

class AdjuntoTransaccion(models.Model):
    transaccion = models.ForeignKey(Transaccion, on_delete=models.CASCADE, related_name='adjuntos')
    archivo = models.FileField(upload_to='adjuntos/%Y/%m/')
    nombre_original = models.CharField(max_length=255)
    creado = models.DateTimeField(auto_now_add=True)

# apps/servicios/models.py
class Servicio(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='servicios')
    nombre = models.CharField(max_length=120)
    monto_total = models.DecimalField(max_digits=14, decimal_places=2)
    metodo = models.CharField(max_length=24)  # partes-iguales | porcentaje | personalizado
    detalle = models.JSONField(default=list)  # [{nombre, monto, porcentaje?}]
    mi_parte = models.DecimalField(max_digits=14, decimal_places=2)
    creado = models.DateTimeField(auto_now_add=True)

# apps/equipo/models.py
class Persona(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='personas')
    nombre = models.CharField(max_length=120)
    rol = models.CharField(max_length=120, blank=True)
    color = models.CharField(max_length=12, default='#7c6fff')
    contactos = models.JSONField(default=list)  # [{tipo, valor}]
    notas = models.TextField(blank=True)

class Tarea(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tareas')
    titulo = models.CharField(max_length=200)
    descripcion = models.TextField(blank=True)

class AsignacionTarea(models.Model):
    persona = models.ForeignKey(Persona, on_delete=models.CASCADE, related_name='asignaciones')
    tarea = models.ForeignKey(Tarea, on_delete=models.CASCADE, related_name='asignaciones')
    estado = models.CharField(max_length=20, default='pendiente')
    class Meta:
        unique_together = ('persona', 'tarea')

# apps/calendario/models.py
class ClienteMensual(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='cal_clientes')
    nombre = models.CharField(max_length=120)
    dia_mes = models.PositiveSmallIntegerField()  # 1-31
    hora = models.TimeField(null=True, blank=True)
    descripcion = models.TextField(blank=True)
    color = models.CharField(max_length=12, default='#4fffb0')

class EventoUnico(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='cal_eventos')
    nombre = models.CharField(max_length=120)
    inicio = models.DateTimeField()
    fin = models.DateTimeField(null=True, blank=True)
    descripcion = models.TextField(blank=True)
    color = models.CharField(max_length=12, default='#7c6fff')

# apps/stats/models.py
class AnalisisStats(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='analisis')
    plataforma = models.CharField(max_length=40, blank=True)
    metricas = models.JSONField(default=list)         # [{nombre, antes, despues, variacion}]
    interpretacion = models.TextField(blank=True)
    creado = models.DateTimeField(auto_now_add=True)

class ImagenAnalisis(models.Model):
    analisis = models.ForeignKey(AnalisisStats, on_delete=models.CASCADE, related_name='imagenes')
    grupo = models.CharField(max_length=10)  # 'antes' | 'despues'
    archivo = models.ImageField(upload_to='stats/%Y/%m/')
```

### 4.4 Endpoints REST (DRF)

Base: `/api/`. Todos requieren JWT excepto `/auth/*`.

```
POST   /auth/register/
POST   /auth/login/                  # SimpleJWT
POST   /auth/refresh/
GET    /auth/me/

GET    /dashboard/?mes=YYYY-MM       # datos agregados para Dashboard.jsx

GET    /transacciones/?mes=&tipo=&categoria=
POST   /transacciones/
PUT    /transacciones/{id}/
DELETE /transacciones/{id}/
GET    /transacciones/export.csv

POST   /transacciones/{id}/adjuntos/  # multipart
DELETE /adjuntos/{id}/

GET    /servicios/
POST   /servicios/
PUT    /servicios/{id}/
DELETE /servicios/{id}/

GET    /personal/
POST   /personal/
PUT    /personal/{id}/
DELETE /personal/{id}/
GET    /personal/{id}/tareas/        # tareas asignadas a esa persona
PUT    /personal/{id}/tareas/        # body: { tareas: [id...] }

GET    /tareas/
POST   /tareas/
DELETE /tareas/{id}/

GET    /cal-clientes/
POST   /cal-clientes/
DELETE /cal-clientes/{id}/

GET    /cal-eventos/?desde=&hasta=
POST   /cal-eventos/
DELETE /cal-eventos/{id}/

POST   /stats/analizar/              # multipart { antes[], despues[], plataforma }
GET    /stats/                       # historial
DELETE /stats/{id}/

PUT    /me/config/                   # moneda, nombre, gmail, googleConnected, etc.
GET    /me/export                    # devuelve JSON con todo el state del user
POST   /me/import                    # recibe JSON y lo carga
DELETE /me/data                      # borra todo lo del usuario
```

Todos los `ViewSet` filtran por `request.user`. Usar `IsAuthenticated` global.

### 4.5 Auth

- SimpleJWT con `ACCESS_TOKEN_LIFETIME=15m`, `REFRESH_TOKEN_LIFETIME=7d`.
- Permitir registro sin email-verification en fase 1 (un único usuario en mente). Documentar que se puede endurecer después.

### 4.6 CORS y seguridad

- `django-cors-headers` con `CORS_ALLOWED_ORIGINS` desde env.
- `SECURE_SSL_REDIRECT=True`, `SESSION_COOKIE_SECURE=True`, `CSRF_COOKIE_SECURE=True` en producción.
- Subida de archivos: validar `content_type`, tope 10MB para adjuntos y 8MB por screenshot.

---

## 5. Integración con NeonDB

1. Crear proyecto en Neon, base `aurateam`, branch `main`.
2. Copiar la connection string a `backend/.env` como `DATABASE_URL`.
3. Habilitar el rol con `CREATE ROLE` y permisos `CONNECT, CREATE` en la base.
4. Correr migraciones: `python manage.py migrate`.
5. Crear superuser: `python manage.py createsuperuser`.
6. Verificar conexión con `python manage.py dbshell` y `\dt`.
7. Para entornos de preview, usar **branches de Neon** (`neon branches create`) y mapear el preview deploy del frontend a esa rama.

---

## 6. Integración Google (Gmail + Calendar)

El HTML usa `gapi` desde el navegador con API key + Client ID guardados en `localStorage`. Mantener este enfoque en fase 1 con dos cambios:

- Las credenciales se guardan en el backend en `User` (campos `google_api_key`, `google_client_id`) y se exponen vía `GET /auth/me/`.
- `connectGoogle()`, `initGapiClient()`, `loadGmail()`, `loadCalendar()`, `sendEmail()`, `viewEmail()` se implementan en `frontend/src/features/gmail/` y `frontend/src/features/calendario/` usando el SDK oficial de Google Identity Services (`google-auth-library` o `gapi-script`).
- Dejar marcado con TODO un endpoint `POST /api/integraciones/google/exchange/` para fase 2 (intercambio OAuth server-side, más seguro).

---

## 7. IA para estadísticas

`POST /api/stats/analizar/` recibe un multipart con N imágenes "antes" y N "despues". El backend:

1. Guarda las imágenes en `ImagenAnalisis`.
2. Las envía a un proveedor de IA con visión (OpenAI Vision o Anthropic Claude con bloque de imagen) usando un prompt estructurado que pida JSON con `{ plataforma, metricas: [{nombre, antes, despues, variacion}], interpretacion }`.
3. Persiste el resultado en `AnalisisStats` y lo devuelve.

Variable de entorno requerida: `AI_PROVIDER=anthropic|openai` y `AI_API_KEY=...`. Mantener la clave **solo** en el backend, nunca exponerla al frontend.

---

## 8. Variables de entorno (resumen)

**`frontend/.env`**
```
VITE_API_URL=http://localhost:8000/api
VITE_GOOGLE_CLIENT_ID=          # opcional, si se prefiere hardcodear
```

**`backend/.env`**
```
DEBUG=True
SECRET_KEY=
DATABASE_URL=                   # Neon
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ORIGINS=http://localhost:5173
AI_PROVIDER=anthropic
AI_API_KEY=
MEDIA_URL=/media/
MEDIA_ROOT=./media
```

---

## 9. Plan de implementación por fases

**Fase 0 — scaffolding (1 sesión Cursor)**
- Crear estructura de carpetas exacta de §1.
- `frontend/`: Vite + React + Tailwind + router + Zustand + axios funcionando con una página dummy.
- `backend/`: Django + DRF + SimpleJWT + conexión a Neon + endpoint `/auth/me/` funcionando.
- Validar `npm run dev` y `python manage.py runserver` en paralelo.

**Fase 1 — réplica visual sin backend real**
- Portar todo el CSS del HTML a Tailwind/CSS modules.
- Crear todos los componentes de `components/ui/` y `components/layout/`.
- Renderizar las 9 páginas con datos mockeados, replicando estructura nodo por nodo.
- Verificar paridad visual en desktop y móvil contra el HTML original.

**Fase 2 — backend CRUD completo**
- Implementar modelos, migraciones y serializers para: User, Transaccion, AdjuntoTransaccion, Servicio, Persona, Tarea, AsignacionTarea, ClienteMensual, EventoUnico.
- ViewSets + URLs según §4.4.
- Tests con pytest-django para cada endpoint (happy path + auth).

**Fase 3 — conectar frontend al backend**
- Reemplazar mocks por TanStack Query contra los endpoints reales.
- Implementar login/registro y guard de rutas.
- Implementar export/import/clear data.
- Verificar que cada función del listado §2.3 esté cableada.

**Fase 4 — integraciones**
- Google Gmail + Calendar desde frontend (mantener enfoque del HTML).
- Endpoint de estadísticas con IA.
- Export a Google Docs (puede quedar como placeholder funcional).

**Fase 5 — pulido y deploy**
- Notificaciones, manejo de errores global, loaders.
- Build de producción del frontend (servir desde Vercel/Netlify).
- Backend en Railway/Render/Fly con Neon como DB.
- Configurar CORS de producción y dominios.

---

## 10. Criterios de aceptación

La migración está completa cuando:

1. Las 9 páginas del HTML existen como rutas en React y se ven idénticas en desktop y móvil (lado a lado con el HTML, no debe haber diferencias visibles más allá del marcado del navegador).
2. Todas las funciones listadas en §2.3 tienen comportamiento equivalente.
3. Recargar la página no pierde datos (vienen del backend, no de localStorage).
4. Dos navegadores distintos del mismo usuario ven los mismos datos.
5. Borrar `localStorage` del navegador no afecta los datos persistidos.
6. Los modales abren/cierran como en el HTML, con la misma animación de entrada.
7. La sidebar móvil con overlay funciona igual al HTML actual.
8. Las tablas tienen scroll horizontal en pantallas chicas, igual que en el HTML.
9. Tests del backend pasan: `pytest backend/`.
10. Lint del frontend pasa: `npm run lint` en `frontend/`.

---

## 11. No hacer (anti-objetivos)

- No agregar features que no estén en el HTML.
- No cambiar la paleta ni las fuentes.
- No reemplazar emojis por iconos SVG salvo que se documente y se acepte.
- No introducir SSR / Next.js — el HTML es una SPA y eso debe seguir siendo.
- No usar Redux; con Zustand + TanStack Query alcanza.
- No persistir tokens JWT en cookies HttpOnly en fase 1 (queda como mejora de fase 5).
- No reescribir la calculadora de división (`calcularDivision`) en el backend; es lógica puramente de UI.

---

## 12. Referencias para Cursor

- Archivo fuente con la implementación completa actual: `AURA_TEAM_V4.html` (debe estar en la raíz o en `docs/` del repo durante la migración para consultar).
- Cursor debe abrir el HTML antes de implementar cada página y usarlo como única fuente de verdad para markup, copy, IDs de elementos y comportamiento de funciones.
- Ante cualquier ambigüedad, replicar el comportamiento del HTML antes que inventar uno nuevo.
