# Grimório in one container: the web app, the Python server, Forge 2.0.15 and a Java 17 runtime.
#   docker compose up -d   ->  http://SERVER-IP:8107   (docker-compose.yml; data in the «grimorio» volume)
# The Forge games run as Java processes inside this container (GRIMORIO_RUNTIME=local, like the desktop packages):
# no Docker socket in the container, so it works on any NAS and never gets root on the host.
# Card data (grimorio-data.zip of this version's release) is downloaded to the volume on the first start.

FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npx vite build --logLevel warn

# Forge 2.0.15 (official release, checksum-verified, trimmed to what headless games need) + our launcher, AI profiles
# and card scripts (build/forge/build.sh), applied over res/ — the same steps as the desktop packages
FROM eclipse-temurin:17-jdk-noble AS forge
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY packaging/build.py packaging/
COPY build/forge build/forge
RUN python3 packaging/build.py forge /work && rm /work/*.tar.bz2 \
 && JAVAC=javac GRIMORIO_DATA_DIR=/work build/forge/build.sh \
 && python3 -c 'import sys; sys.path.insert(0, "packaging"); import build; build.apply_ext("/work/forge", "/work/forge-ext")'

FROM eclipse-temurin:17-jre-noble
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
ARG VERSION=dev
WORKDIR /opt/grimorio
COPY --from=forge /work/forge forge
COPY --from=forge /work/forge-ext forge-ext
COPY *.py packaging/launcher.py app/
COPY packaging/docker/entrypoint.sh /entrypoint.sh
COPY --from=web /src/web/dist app/web/dist
COPY LICENSE NOTICE ./
RUN echo "$VERSION" > VERSION && mkdir /data && chown 1000:1000 /data
ENV GRIMORIO_DATA_DIR=/data GRIMORIO_RUNTIME=local GRIMORIO_JAVA=/opt/java/openjdk/bin/java \
    GRIMORIO_FORGE_DIR=/opt/grimorio/forge GRIMORIO_VERSION=$VERSION PYTHONUNBUFFERED=1
USER 1000:1000
VOLUME /data
EXPOSE 8107
HEALTHCHECK --start-period=5m CMD python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8107/api/health", timeout=5)'
ENTRYPOINT ["/entrypoint.sh"]
