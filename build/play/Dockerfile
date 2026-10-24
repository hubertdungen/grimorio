# Grimório — o Forge com ecrã, para jogar no browser (play.py).
# Xvnc (TigerVNC: ecrã virtual e servidor VNC num só processo) + matchbox (janela sempre maximizada) + a JRE.
# O Forge e o lançador GrimorioPlay vêm montados de fora (/forge, /ext); o VNC fica num socket unix em /run,
# sem porta TCP, e o servidor do Grimório faz a ponte websocket -> VNC.
FROM eclipse-temurin:17-jre
# sem os drivers OpenGL (mesa + llvm, ~180 MB): o Forge desenha em Swing/Java2D e o Xvnc vive sem DRI
RUN apt-get update \
 && apt-get install -y --no-install-recommends tigervnc-standalone-server matchbox-window-manager libxtst6 libxi6 libxrender1 libxext6 \
 && dpkg --purge --force-depends $(dpkg-query -Wf '${Package}\n' | grep -E '^(libgl1-mesa-dri|mesa-libgallium|libllvm[0-9]+)$') \
 && rm -rf /var/lib/apt/lists/*
COPY start.sh /start.sh
ENTRYPOINT ["/start.sh"]
