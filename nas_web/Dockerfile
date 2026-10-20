FROM python:3.12-slim-bookworm
WORKDIR /opt/nasweb
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 10001 nasweb && mkdir /data && chown nasweb /data
COPY app/ ./app/
USER nasweb
EXPOSE 8085
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8085", "--no-server-header"]
