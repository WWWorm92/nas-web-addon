"""Allow same-origin framing only for successfully streamed inline PDF."""
BASE_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; "
    "base-uri 'none'; "
)


def permitted_inline_pdf(path, response):
    """Never rely on query arguments alone to relax frame restrictions."""
    if path != "/api/file" or response.status_code not in (200, 206):
        return False
    mime = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    disposition = response.headers.get("content-disposition", "").split(";", 1)[0].strip().lower()
    return mime == "application/pdf" and disposition == "inline"


def apply_headers(path, response):
    """Keep legacy no-frame policy except for authenticated inline PDF streams."""
    allow = permitted_inline_pdf(path, response)
    response.headers["X-Frame-Options"] = "SAMEORIGIN" if allow else "DENY"
    response.headers["Content-Security-Policy"] = BASE_CSP + (
        "frame-ancestors 'self'" if allow else "frame-ancestors 'none'"
    )
