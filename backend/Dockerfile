FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# collectstatic no necesita base ni secretos reales.
RUN DATABASE_URL= SECRET_KEY=solo-para-collectstatic python manage.py collectstatic --no-input \
    && useradd --create-home --uid 1000 app \
    && mkdir -p /app/media \
    && chown -R app:app /app/media \
    && chmod +x docker-entrypoint.sh

USER app
EXPOSE 8000
CMD ["./docker-entrypoint.sh"]
