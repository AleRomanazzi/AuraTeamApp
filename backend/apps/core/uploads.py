from PIL import Image, UnidentifiedImageError

PDF_MAGIC = b'%PDF'


def detectar_tipo(upload) -> str | None:
    """Detecta el tipo real del archivo por su contenido (no por lo que declara el navegador)."""
    head = upload.read(2048)
    upload.seek(0)
    if head.startswith(PDF_MAGIC):
        return 'application/pdf'
    try:
        with Image.open(upload) as img:
            img.verify()
            fmt = (img.format or '').upper()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        fmt = ''
    finally:
        upload.seek(0)
    return {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}.get(fmt)
