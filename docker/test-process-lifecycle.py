"""Linux Docker integration; exclusively uses disposable tmpfs vaults."""
import json
import pathlib
import subprocess
import sys
import time

IMAGE = sys.argv[1]
ROOT = pathlib.Path(__file__).resolve().parent


def docker(*args, timeout=30):
    return subprocess.check_output(["docker", *args], text=True, timeout=timeout).strip()


for mode, signal in [("gateway", "SIGTERM"), ("server", "SIGINT")]:
    name = f"mcpvault-lifecycle-{mode}"
    try:
        docker("run", "-d", "--name", name, "--pids-limit", "256",
               "--tmpfs", "/vault:rw,uid=1000,gid=1000,mode=0700",
               "-e", "SESSION_TIMEOUT=1500", "-e", f"HEALTH_CHECK={mode}", IMAGE)
        info = json.loads(docker("inspect", name))[0]
        assert info["HostConfig"]["PidsLimit"] == 256
        docker("cp", str(ROOT / "process-regression.mjs"), f"{name}:/app/process-regression.mjs")
        deadline = time.monotonic() + 60
        while True:
            try:
                docker("exec", name, "node", "/app/docker/healthcheck.mjs", timeout=16)
                break
            except subprocess.CalledProcessError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.5)
        print(docker("exec", "-e", "MCP_TEST_VAULT_IS_DISPOSABLE=yes", name, "node",
                     "/app/process-regression.mjs", timeout=180), flush=True)
        # Leave an active session running during real PID 1 signal forwarding.
        docker("exec", "-d", "-e", "MCP_TEST_VAULT_IS_DISPOSABLE=yes", name,
               "node", "/app/process-regression.mjs", "--hold")
        deadline = time.monotonic() + 30
        while subprocess.run(["docker", "exec", name, "test", "-f", "/tmp/lifecycle-ready"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5).returncode:
            assert time.monotonic() < deadline, "Active session did not become ready"
            time.sleep(0.2)
        started = time.monotonic()
        docker("kill", f"--signal={signal}", name)
        code = docker("wait", name, timeout=20)
        assert code == "0", f"Unclean {signal}: {code}"
        assert json.loads(docker("inspect", name))[0]["State"]["Pid"] == 0
        print(f"PASS {mode}: {signal} with active session exited 0 in {time.monotonic() - started:.2f}s", flush=True)
    except BaseException:
        subprocess.run(["docker", "logs", name], check=False)
        raise
    finally:
        subprocess.run(["docker", "rm", "-f", name], check=False, stdout=subprocess.DEVNULL)
