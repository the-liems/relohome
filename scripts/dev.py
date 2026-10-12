"""Local launcher: dev.py COMPONENT [--env-file PATH] -- COMMAND [ARGS]."""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.local_env import ROOT, load_config, scope_environment


def main():
    # npm appends options after the command; consume our option in either position.
    args = sys.argv[1:]
    env_file = None
    for index, arg in enumerate(args):
        if arg == "--env-file":
            if index + 1 >= len(args):
                raise SystemExit("--env-file requires a path")
            env_file = args[index + 1]
            del args[index : index + 2]
            break
        if arg.startswith("--env-file="):
            env_file = arg.split("=", 1)[1]
            del args[index]
            break
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    parsed = parser.parse_args(args)
    command = parsed.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("Provide a command after --")
    try:
        values = load_config(env_file)
        values["PYTHONPATH"] = str(ROOT)
        values["PYTHONIOENCODING"] = "utf-8"
        env = scope_environment(parsed.component, values)
    except ValueError as error:
        parser.error(str(error))
    if command[0] == "python":
        command[0] = sys.executable
    executable = shutil.which(command[0])
    if not executable:
        parser.error(f"Command not found: {command[0]}")
    if command[:2] == ["docker", "compose"]:
        command[2:2] = ["--env-file", os.devnull]
    command[0] = executable
    if os.name != "nt":
        os.execve(executable, command, env)
    raise SystemExit(subprocess.call(command, env=env))


if __name__ == "__main__":
    main()
