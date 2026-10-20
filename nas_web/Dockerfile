FROM python:3.12-slim-bookworm
WORKDIR /opt/nasweb
COPY requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg gosu \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt \
    && useradd -r -u 10001 nasweb \
    && mkdir -p /data
COPY app/ ./app/
COPY entrypoint.sh /usr/local/bin/nasweb-entrypoint
RUN chmod 0755 /usr/local/bin/nasweb-entrypoint
# The entrypoint starts as root only to prepare bind-mounted /data subdirs.
# It immediately drops privileges to the nasweb user for the application.
EXPOSE 8085
ENTRYPOINT ["/usr/local/bin/nasweb-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8085", "--no-server-header"]
