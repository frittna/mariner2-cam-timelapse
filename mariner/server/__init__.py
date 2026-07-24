import logging
import multiprocessing
import os
from typing import Dict

from flask import abort, render_template
from waitress import serve

from mariner import config
from mariner.file_formats.utils import get_supported_extensions
from mariner.server.api import api as api_blueprint
from mariner.server.app import app as flask_app
from mariner.server.routes_sensors import sensors_bp
from mariner.server.routes_timelapse import init_timelapse, timelapse_bp
from mariner.server.utils import (
    read_cached_preview,
    read_cached_sliced_model_file,
)

from itertools import chain


flask_app.register_blueprint(api_blueprint)
flask_app.register_blueprint(sensors_bp)
flask_app.register_blueprint(timelapse_bp)
init_timelapse()


def render_index() -> str:
    template_vars: Dict[str, str] = {
        "supported_extensions": ",".join(get_supported_extensions()),
    }
    printer_display_name = config.get_printer_display_name()
    if printer_display_name is not None:
        template_vars["printer_display_name"] = printer_display_name
    return render_template("index.html", **template_vars)


@flask_app.route("/", methods=["GET"])
def index() -> str:
    return render_index()


@flask_app.get("/<path:spa_path>")
def spa_fallback(spa_path: str) -> str:
    # Let /api/* hit the API blueprint; everything else is a client-side route.
    if spa_path == "api" or spa_path.startswith("api/"):
        abort(404)
    return render_index()


class CacheBootstrapper(multiprocessing.Process):
    def run(self) -> None:
        os.nice(5)
        globs = [
            config.get_files_directory().rglob(f"*{extension}")
            for extension in get_supported_extensions()
        ]
        for file in chain.from_iterable(globs):
            read_cached_sliced_model_file(file.absolute())
            read_cached_preview(file.absolute())


def main() -> None:
    CacheBootstrapper().start()

    # Global log level applies to mariner.* and waitress output.
    log_level = getattr(logging, config.get_log_level(), logging.INFO)
    if not logging.getLogger().handlers:
        logging.basicConfig(level=log_level)
    else:
        logging.getLogger().setLevel(log_level)
    logging.getLogger("mariner").setLevel(log_level)
    logging.getLogger("waitress").setLevel(log_level)

    flask_app.config['WTF_CSRF_ENABLED'] = False
    flask_app.config['MAX_CONTENT_LENGTH'] = 1342177280
    import os
    os.environ['TMPDIR'] = '/var/tmp'

    serve(flask_app, host=config.get_http_host(), port=config.get_http_port(), max_request_body_size=1342177280)
    
