FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    NEXUS_DATA_DIR=/data \
    NEXUS_RENDER_MAX_DIM=1280

# System ffmpeg (with ffprobe) + DejaVu for the locked drawtext watermark.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/nexus
COPY requirements.txt requirements-ml.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Optional heavy stack: docker build --build-arg INSTALL_ML=1
ARG INSTALL_ML=0
RUN if [ "$INSTALL_ML" = "1" ]; then pip install --no-cache-dir -r requirements-ml.txt; fi

COPY app ./app
RUN useradd --create-home --uid 10001 nexus && mkdir -p /data && chown -R nexus:nexus /data /srv/nexus
USER nexus
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
