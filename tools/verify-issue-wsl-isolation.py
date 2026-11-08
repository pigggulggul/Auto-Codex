"""Exercise a narrow WSL/bubblewrap boundary with synthetic data only.

This is a diagnostic, not an authorization to enable command execution.
"""
import json
import os
import socket
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
scratch = root / ".cache"
if not scratch.is_dir() or scratch.is_symlink():
    raise SystemExit("Workspace cache is unavailable")

fd, name = tempfile.mkstemp(prefix="issue-isolation-", dir=scratch)
original_stat = os.fstat(fd)
os.write(fd, b"synthetic fixture")
os.close(fd)
listener = socket.socket()
try:
    listener.bind(("127.0.0.1", 0))
    listener.listen(2)
    listener.settimeout(2)
    port = listener.getsockname()[1]
    with socket.create_connection(("127.0.0.1", port), timeout=2):
        connection, _ = listener.accept()
        connection.close()

    check = r'''
import json, os, socket, sys
file_write_blocked = False
try:
    with open('/fixture', 'ab') as f: f.write(b'changed')
except OSError:
    file_write_blocked = True
network_blocked = False
try:
    with socket.create_connection(('127.0.0.1', int(sys.argv[1])), timeout=2): pass
except OSError:
    network_blocked = True
print(json.dumps({'file_write_blocked': file_write_blocked,
                  'network_blocked': network_blocked,
                  'host_etc_hidden': not os.path.exists('/etc/hostname')}))
'''
    command = ["bwrap", "--unshare-all", "--die-with-parent", "--ro-bind", "/usr", "/usr",
               "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64",
               "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
               "--ro-bind", name, "/fixture", "--", "/usr/bin/python3", "-c", check, str(port)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=10, check=True)
    observed = json.loads(result.stdout)
    listener.settimeout(0.2)
    try:
        connection, _ = listener.accept()
        connection.close()
        unexpected_connection = True
    except TimeoutError:
        unexpected_connection = False
    with open(name, "rb") as fixture:
        unchanged = fixture.read() == b"synthetic fixture"
    if observed != {"file_write_blocked": True, "network_blocked": True, "host_etc_hidden": True} or unexpected_connection or not unchanged:
        raise RuntimeError("Synthetic isolation control failed")
    print(json.dumps({"status": "passed", "positive_loopback": True, **observed, "fixture_unchanged": unchanged}))
finally:
    listener.close()
    # Never delete a replacement, link, or directory provided by another process.
    try:
        current = os.lstat(name)
        if current.st_dev == original_stat.st_dev and current.st_ino == original_stat.st_ino:
            os.unlink(name)
    except FileNotFoundError:
        pass
