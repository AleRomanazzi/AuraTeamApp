# Aura Team Monorepo

Scaffolding inicial de migración según `plan.md`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

## Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```
# AuraTeamApp
