#!/bin/sh
# Arranque do contentor grimorio-play: ecrã virtual com VNC no socket /run/vnc.sock, gestor de janelas e o Forge.
# Os argumentos vão para o GrimorioPlay (saída em /run/forge.log). Quando o Forge fecha, o contentor termina.
rm -f /run/vnc.sock
Xvnc :1 -geometry "${GEOMETRY:-1600x900}" -depth 24 -SecurityTypes None -rfbport -1 -rfbunixpath /run/vnc.sock -rfbunixmode 0600 \
  -AlwaysShared -AcceptSetDesktopSize -AcceptCutText=0 -SendCutText=0 >/run/xvnc.log 2>&1 &
export DISPLAY=:1
i=0; while [ ! -S /run/vnc.sock ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done
matchbox-window-manager -use_titlebar no -use_cursor yes >/dev/null 2>&1 &
cd /forge
# os Add-Opens do manifesto do jar só valem com -jar; aqui é -cp (para juntar o /ext), por isso vão à mão.
# user.home: o Java lê-o do /etc/passwd (o uid do servidor não existe no contentor), não do $HOME.
OPENS=""
for m in java.desktop/java.beans java.desktop/javax.swing.border java.desktop/javax.swing.event java.desktop/sun.swing \
  java.desktop/java.awt.image java.desktop/java.awt.color java.desktop/sun.awt.image java.desktop/javax.swing \
  java.desktop/java.awt java.base/java.util java.base/java.lang java.base/java.lang.reflect java.base/java.text \
  java.desktop/java.awt.font java.base/jdk.internal.misc java.base/sun.nio.ch java.base/java.nio java.base/java.math \
  java.base/java.util.concurrent java.base/java.net; do OPENS="$OPENS --add-opens $m=ALL-UNNAMED"; done
exec java -Xmx"${XMX:-1500m}" -XX:+UseSerialGC $OPENS -Duser.home="$HOME" -Dio.netty.tryReflectionSetAccessible=true \
  -Dfile.encoding=UTF-8 -Dsun.java2d.opengl=false -cp "$FORGE_JAR:/ext" GrimorioPlay "$@" >/run/forge.log 2>&1
