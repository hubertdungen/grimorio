"""App Android: o servidor do Grimório (server.py, o mesmo dos pacotes de computador) a correr dentro da app.

O Python vem do Chaquopy; o código do Grimório e o web/dist vêm no APK (assets/grimorio-app.zip) e a app desembrulha-os
para <files>/app (LocalServer.java). Ouve só em 127.0.0.1 e só responde à WebView da app (GRIMORIO_APP_TOKEN: o cookie
grimorio_app que a MainActivity põe). Sem Forge (GRIMORIO_NO_FORGE): o Java do Forge não corre no telemóvel.
"""
import os, runpy, socketserver, sys, threading, traceback

STATE = {"thread": None, "server": None, "error": ""}


def start(app_dir, data_dir, port, token, version):
    """Arranca o servidor numa thread (volta logo; a app espera por /api/health). Uma vez por processo."""
    if STATE["thread"] and STATE["thread"].is_alive():
        return
    os.environ.update(GRIMORIO_VERSION=str(version), GRIMORIO_RUNTIME="local", GRIMORIO_NO_FORGE="1", GRIMORIO_ANDROID="1",
                      GRIMORIO_APP_TOKEN=str(token))
    os.makedirs(data_dir, exist_ok=True)
    if app_dir not in sys.path:
        sys.path.insert(0, app_dir)
    argv = [os.path.join(app_dir, "server.py"), "--host", "127.0.0.1", "--port", str(int(port)), "--data-dir", data_dir]

    serve = socketserver.BaseServer.serve_forever

    def keep(self, *a, **k):  # o server.py cria o servidor lá dentro: guarda-se para o stop()
        STATE["server"] = self
        return serve(self, *a, **k)
    socketserver.BaseServer.serve_forever = keep

    def run():
        sys.argv = argv
        try:
            runpy.run_path(argv[0], run_name="__main__")
        except BaseException as e:  # porta ocupada, base de dados estragada…: a app mostra isto
            STATE["error"] = f"{type(e).__name__}: {e}"
            traceback.print_exc()
    STATE["error"] = ""
    STATE["thread"] = threading.Thread(target=run, name="grimorio-server", daemon=True)
    STATE["thread"].start()


def error():
    """O erro que parou o servidor ('' se está a correr ou a arrancar)."""
    return STATE["error"] or ("" if STATE["thread"] and STATE["thread"].is_alive() else "o servidor parou")


def stop():
    """A app vai fechar: pára de aceitar pedidos e espera pelos que estão a meio."""
    s = STATE["server"]
    if s:
        s.shutdown()
        s.server_close()
    STATE["server"] = None
