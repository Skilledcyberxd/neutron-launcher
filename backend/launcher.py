#!/usr/bin/env python3
"""
Neutron Launcher - Python Backend
Handles Java process spawning, system info, and launch argument generation.
Can be invoked from Node.js via child_process or run as a standalone tool.

Usage:
  python launcher.py launch --version <id> --username <name> --token <token>
                            --uuid <uuid> --type <msa|legacy>
                            --gameDir <path> --ram <GB> [--fullscreen] [--perf]
  python launcher.py sysinfo
  python launcher.py verify-java --path <java_path>
"""

import sys
import os
import json
import subprocess
import platform
import argparse
import hashlib
import shutil
from pathlib import Path
from typing import Optional


# ── Helpers ────────────────────────────────────────────────────────────────

def log(msg: str, level: str = "INFO"):
    """Output structured log to stdout."""
    print(json.dumps({"type": "log", "level": level, "msg": msg}), flush=True)


def emit(event: str, data: dict):
    """Emit a structured event to stdout (parsed by Node.js)."""
    print(json.dumps({"type": "event", "event": event, "data": data}), flush=True)


def error(msg: str):
    print(json.dumps({"type": "error", "msg": msg}), flush=True)
    sys.exit(1)


# ── System Info ────────────────────────────────────────────────────────────

def get_system_info() -> dict:
    import psutil
    mem = psutil.virtual_memory()
    cpu = psutil.cpu_count(logical=True)
    return {
        "os": platform.system(),
        "os_version": platform.version(),
        "arch": platform.machine(),
        "cpu_count": cpu,
        "total_ram_gb": round(mem.total / (1024 ** 3), 1),
        "free_ram_gb": round(mem.available / (1024 ** 3), 1),
        "used_ram_percent": mem.percent,
        "python_version": platform.python_version(),
    }


def cmd_sysinfo(_args):
    try:
        info = get_system_info()
    except ImportError:
        import os
        info = {
            "os": platform.system(),
            "os_version": platform.version(),
            "arch": platform.machine(),
            "python_version": platform.python_version(),
        }
    print(json.dumps({"type": "result", "data": info}), flush=True)


# ── Java Verification ──────────────────────────────────────────────────────

def verify_java(java_path: str) -> dict:
    try:
        result = subprocess.run(
            [java_path, "-version"],
            capture_output=True, text=True, timeout=10
        )
        version_output = result.stderr or result.stdout
        return {
            "found": True,
            "path": java_path,
            "version_output": version_output.strip(),
        }
    except FileNotFoundError:
        return {"found": False, "path": java_path, "error": "Java not found"}
    except Exception as e:
        return {"found": False, "path": java_path, "error": str(e)}


def cmd_verify_java(args):
    result = verify_java(args.path)
    print(json.dumps({"type": "result", "data": result}), flush=True)


# ── Classpath Builder ──────────────────────────────────────────────────────

def build_classpath(version_dir: Path, libraries_dir: Path, mc_version: str,
                    versions_dir: Path) -> str:
    """
    Reads the Fabric version JSON and assembles a classpath string.
    """
    sep = ";" if platform.system() == "Windows" else ":"
    cp = []

    # Find the Fabric profile JSON
    fabric_jsons = list(version_dir.glob("*.json"))
    if not fabric_jsons:
        raise FileNotFoundError(f"No version JSON in {version_dir}")

    with open(fabric_jsons[0]) as f:
        profile = json.load(f)

    os_name = "windows" if platform.system() == "Windows" else "linux"

    for lib in profile.get("libraries", []):
        # Check OS rules
        rules = lib.get("rules", [])
        if rules:
            allowed = False
            for rule in rules:
                os_rule = rule.get("os", {})
                matches = (not os_rule) or (os_rule.get("name") == os_name)
                if rule.get("action") == "allow" and matches:
                    allowed = True
                elif rule.get("action") == "disallow" and matches:
                    allowed = False
            if not allowed:
                continue

        artifact = lib.get("downloads", {}).get("artifact")
        if artifact and artifact.get("path"):
            lib_path = libraries_dir / artifact["path"]
            if lib_path.exists():
                cp.append(str(lib_path))

    # Add Minecraft client jar
    client_jar = versions_dir / mc_version / f"{mc_version}.jar"
    if client_jar.exists():
        cp.append(str(client_jar))

    return sep.join(cp)


# ── Game Launch ────────────────────────────────────────────────────────────

def build_jvm_args(ram_gb: int, natives_dir: Path, perf_mode: bool = False,
                   custom_args: str = "") -> list:
    args = [
        f"-Xmx{ram_gb}G",
        f"-Xms{max(1, ram_gb // 2)}G",
        f"-Djava.library.path={natives_dir}",
        "-Dminecraft.launcher.brand=NeutronLauncher",
        "-Dminecraft.launcher.version=1.0",
    ]

    if perf_mode:
        args += [
            "-XX:+UseG1GC",
            "-XX:+ParallelRefProcEnabled",
            "-XX:MaxGCPauseMillis=200",
            "-XX:+UnlockExperimentalVMOptions",
            "-XX:+DisableExplicitGC",
            "-XX:G1NewSizePercent=30",
            "-XX:G1MaxNewSizePercent=40",
            "-XX:G1HeapRegionSize=8M",
            "-XX:G1ReservePercent=20",
            "-XX:G1MixedGCLiveThresholdPercent=90",
            "-XX:SurvivorRatio=32",
            "-XX:+PerfDisableSharedMem",
            "-XX:MaxTenuringThreshold=1",
        ]
    elif custom_args:
        args += [a for a in custom_args.split() if a]

    return args


def build_game_args(profile: dict, username: str, token: str, uuid: str,
                    user_type: str, game_dir: Path, assets_dir: Path,
                    version_id: str, fullscreen: bool = False) -> list:
    mc_version = version_id.replace("fabric-", "").split("-")[0]
    asset_index = profile.get("assetIndex", {}).get("id", mc_version)

    vars_map = {
        "${auth_player_name}": username,
        "${version_name}": version_id,
        "${game_directory}": str(game_dir),
        "${assets_root}": str(assets_dir),
        "${assets_index_name}": asset_index,
        "${auth_uuid}": uuid,
        "${auth_access_token}": token,
        "${user_type}": user_type,
        "${version_type}": "release",
        "${clientid}": "0",
        "${auth_xuid}": "0",
    }

    def resolve(arg: str) -> str:
        for k, v in vars_map.items():
            arg = arg.replace(k, v or "")
        return arg

    args = []
    game_args = profile.get("arguments", {}).get("game", [])

    if game_args:
        for arg in game_args:
            if isinstance(arg, str):
                args.append(resolve(arg))
    else:
        # Legacy minecraftArguments
        legacy = profile.get("minecraftArguments", "")
        args = [resolve(a) for a in legacy.split()]

    if fullscreen:
        args.append("--fullscreen")

    return args


def cmd_launch(args):
    game_dir = Path(args.gameDir)
    versions_dir = game_dir / "versions"
    libraries_dir = game_dir / "libraries"
    assets_dir = game_dir / "assets"

    version_id = args.version
    version_dir = versions_dir / version_id
    mc_version = version_id.replace("fabric-", "").split("-")[0]

    # Load Fabric profile JSON
    fabric_jsons = list(version_dir.glob("*.json"))
    if not fabric_jsons:
        error(f"Version {version_id} not installed (no JSON found)")

    with open(fabric_jsons[0]) as f:
        profile = json.load(f)

    # Classpath
    try:
        classpath = build_classpath(version_dir, libraries_dir, mc_version, versions_dir)
    except Exception as e:
        error(f"Classpath error: {e}")

    # Natives dir
    natives_dir = game_dir / "natives" / version_id
    natives_dir.mkdir(parents=True, exist_ok=True)

    # JVM args
    jvm_args = build_jvm_args(
        ram_gb=int(args.ram),
        natives_dir=natives_dir,
        perf_mode=args.perf,
        custom_args=getattr(args, "jvmArgs", ""),
    )

    # Game args
    game_args = build_game_args(
        profile=profile,
        username=args.username,
        token=args.token,
        uuid=args.uuid,
        user_type=args.type,
        game_dir=game_dir,
        assets_dir=assets_dir,
        version_id=version_id,
        fullscreen=args.fullscreen,
    )

    main_class = profile.get("mainClass", "net.fabricmc.loader.launch.knot.KnotClient")

    final_cmd = (
        [args.java_path or "java"]
        + jvm_args
        + ["-cp", classpath, main_class]
        + game_args
    )

    log(f"Launching Minecraft: {version_id}")
    log(f"Main class: {main_class}")
    emit("launch:start", {"version": version_id, "username": args.username})

    try:
        proc = subprocess.Popen(
            final_cmd,
            cwd=str(game_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        for line in iter(proc.stdout.readline, ""):
            line = line.rstrip()
            if line:
                emit("game:log", {"line": line})

        proc.wait()
        exit_code = proc.returncode
        emit("game:exit", {"code": exit_code})

        if exit_code != 0:
            emit("game:crash", {"code": exit_code})
            log(f"Game crashed with code {exit_code}", "ERROR")
        else:
            log(f"Game exited normally (code {exit_code})")

    except Exception as e:
        error(f"Failed to launch: {e}")


# ── File Hash Utility ──────────────────────────────────────────────────────

def cmd_verify_file(args):
    path = Path(args.path)
    if not path.exists():
        print(json.dumps({"valid": False, "error": "File not found"}), flush=True)
        return

    sha1 = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha1.update(chunk)

    actual = sha1.hexdigest()
    valid = actual == args.expected if args.expected else True
    print(json.dumps({"valid": valid, "hash": actual}), flush=True)


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Neutron Launcher Python Backend")
    subparsers = parser.add_subparsers(dest="command")

    # sysinfo
    subparsers.add_parser("sysinfo", help="Print system information as JSON")

    # verify-java
    p_java = subparsers.add_parser("verify-java", help="Check if Java exists")
    p_java.add_argument("--path", default="java", help="Path to java executable")

    # launch
    p_launch = subparsers.add_parser("launch", help="Launch Minecraft")
    p_launch.add_argument("--version",    required=True, help="Version ID (fabric-1.21.1)")
    p_launch.add_argument("--username",   required=True, help="Player username")
    p_launch.add_argument("--token",      required=True, help="Access token")
    p_launch.add_argument("--uuid",       required=True, help="Player UUID")
    p_launch.add_argument("--type",       default="legacy", help="msa or legacy")
    p_launch.add_argument("--gameDir",    required=True, help="Game directory path")
    p_launch.add_argument("--ram",        default=2,     type=int, help="RAM in GB")
    p_launch.add_argument("--java-path",  default="java", dest="java_path")
    p_launch.add_argument("--jvmArgs",    default="")
    p_launch.add_argument("--perf",       action="store_true", help="Performance mode")
    p_launch.add_argument("--fullscreen", action="store_true")

    # verify-file
    p_vf = subparsers.add_parser("verify-file")
    p_vf.add_argument("--path", required=True)
    p_vf.add_argument("--expected", default=None)

    args = parser.parse_args()

    if args.command == "sysinfo":
        cmd_sysinfo(args)
    elif args.command == "verify-java":
        cmd_verify_java(args)
    elif args.command == "launch":
        cmd_launch(args)
    elif args.command == "verify-file":
        cmd_verify_file(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
