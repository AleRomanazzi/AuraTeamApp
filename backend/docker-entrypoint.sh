#!/bin/sh
set -e

python manage.py migrate --no-input
python manage.py createcachetable

exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers "${GUNICORN_WORKERS:-3}" \
    --threads "${GUNICORN_THREADS:-4}" \
    --timeout 120 \
    --access-logfile -
