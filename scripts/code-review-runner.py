"""Hardened launcher for the optional code-review-graph MCP profile.

This is yimo-pi-kit's integration boundary, not vendored upstream code. It
locks the server to the Git repository active when the stdio process starts,
normalizes file-list arguments, disables source-snippet and embedding egress
paths, and then starts the hash-pinned upstream package.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import socket
import stat
import subprocess
import sys
from pathlib import Path
from typing import Iterable

os.umask(0o077)

_EXPECTED_ENV = {
    "FASTMCP_TRANSPORT": "stdio",
    "FASTMCP_CHECK_FOR_UPDATES": "off",
    "FASTMCP_SHOW_SERVER_BANNER": "false",
    "FASTMCP_DEBUG": "false",
    "FASTMCP_DOCKET_URL": "memory://",
    "OTEL_PROPAGATORS": "none",
    "OTEL_PYTHON_TRACER_PROVIDER": "default_tracer_provider",
    "OTEL_PYTHON_METER_PROVIDER": "default_meter_provider",
    "OTEL_TRACES_EXPORTER": "none",
    "OTEL_METRICS_EXPORTER": "none",
    "OTEL_LOGS_EXPORTER": "none",
    "CRG_REPO_ROOT": "",
    "CRG_DATA_DIR": "",
    "CRG_TOOLS": (
        "build_or_update_graph_tool,get_minimal_context_tool,get_impact_radius_tool,"
        "query_graph_tool,semantic_search_nodes_tool,get_review_context_tool,"
        "list_graph_stats_tool,get_docs_section_tool,get_affected_flows_tool,"
        "detect_changes_tool"
    ),
    "CRG_RECURSE_SUBMODULES": "0",
    "CRG_ALLOW_REMOTE_CODE": "0",
    "CRG_BFS_ENGINE": "sql",
    "CRG_PARSE_WORKERS": "4",
    "CRG_PARSE_EXECUTOR": "thread",
    "CRG_SERIAL_PARSE": "0",
    "CRG_PARSER_LOAD_TIMEOUT_SECONDS": "5",
    "CRG_GIT_TIMEOUT": "30",
    "CRG_DEPENDENT_HOPS": "2",
    "CRG_CHURN_WINDOW_DAYS": "90",
    "CRG_MAX_CHANGED_FUNCS": "500",
    "CRG_MAX_TRANSITIVE_FRONTIER": "50",
    "CRG_MAX_IMPACT_NODES": "500",
    "CRG_MAX_IMPACT_DEPTH": "2",
    "CRG_MAX_BFS_DEPTH": "15",
    "CRG_MAX_SEARCH_RESULTS": "20",
    "CRG_IMPACT_DEPTH_DECAY": "0.6",
    "CRG_IMPACT_SCORE_FLOOR": "0.05",
    "CRG_LEIDEN_SEED": "42",
    "CRG_TOOL_TIMEOUT": "300",
    "CRG_ACCEPT_CLOUD_EMBEDDINGS": "0",
    "CRG_EMBEDDING_MODEL": "",
    "CRG_OPENAI_API_KEY": "",
    "CRG_OPENAI_BASE_URL": "",
    "CRG_OPENAI_MODEL": "",
    "CRG_OPENAI_BATCH_SIZE": "",
    "CRG_OPENAI_DIMENSION": "",
    "MINIMAX_API_KEY": "",
    "GOOGLE_API_KEY": "",
    "YIMO_PI_KIT_CODE_REVIEW_PROFILE": "managed-v1",
}
for key, expected in _EXPECTED_ENV.items():
    if os.environ.get(key) != expected:
        raise RuntimeError(f"unexpected curated environment value: {key}")
for key in list(os.environ):
    if (
        (key.startswith(("CRG_", "FASTMCP_", "OTEL_", "MCP_")) and key not in _EXPECTED_ENV and key not in {"FASTMCP_ENV_FILE", "FASTMCP_HOME"})
        or key.startswith(("UV_", "PIP_", "PIPENV_", "POETRY_"))
        or key in {
            "ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
            "all_proxy", "https_proxy", "http_proxy", "no_proxy",
        }
    ):
        os.environ.pop(key, None)

_original_socket_connect = socket.socket.connect
_original_socket_connect_ex = socket.socket.connect_ex
_original_socket_sendto = socket.socket.sendto
_original_socket_sendmsg = getattr(socket.socket, "sendmsg", None)
_original_create_connection = socket.create_connection
_original_getaddrinfo = socket.getaddrinfo
_original_gethostbyname = socket.gethostbyname
_original_gethostbyname_ex = socket.gethostbyname_ex
_original_gethostbyaddr = socket.gethostbyaddr
_original_getnameinfo = socket.getnameinfo


def _local_socket_address(address) -> bool:
    if isinstance(address, (str, bytes, os.PathLike)):
        return False  # Unix-domain sockets can expose privileged local services.
    if not isinstance(address, tuple) or not address:
        return False
    host = address[0]
    if not isinstance(host, str):
        return False
    try:
        return ipaddress.ip_address(host.split("%", 1)[0]).is_loopback
    except ValueError:
        return False


def _guarded_socket_connect(self, address):
    if not _local_socket_address(address):
        raise PermissionError("non-loopback and Unix-socket access is disabled in the curated code-review-graph runtime")
    return _original_socket_connect(self, address)


def _guarded_socket_connect_ex(self, address):
    if not _local_socket_address(address):
        raise PermissionError("non-loopback and Unix-socket access is disabled in the curated code-review-graph runtime")
    return _original_socket_connect_ex(self, address)


def _guarded_socket_sendto(self, data, *args):
    address = args[-1] if args else None
    if not _local_socket_address(address):
        raise PermissionError("non-loopback and Unix-socket access is disabled in the curated code-review-graph runtime")
    return _original_socket_sendto(self, data, *args)


def _guarded_socket_sendmsg(self, buffers, *args):
    address = args[2] if len(args) >= 3 else None
    if address is not None and not _local_socket_address(address):
        raise PermissionError("non-loopback and Unix-socket access is disabled in the curated code-review-graph runtime")
    if _original_socket_sendmsg is None:
        raise NotImplementedError("socket.sendmsg is unavailable")
    return _original_socket_sendmsg(self, buffers, *args)


def _guarded_create_connection(address, *args, **kwargs):
    if not _local_socket_address(address):
        raise PermissionError("non-loopback and Unix-socket access is disabled in the curated code-review-graph runtime")
    return _original_create_connection(address, *args, **kwargs)


def _allow_local_dns_host(host) -> bool:
    return host is None or _local_socket_address((host, 0))


def _guarded_getaddrinfo(host, *args, **kwargs):
    if not _allow_local_dns_host(host):
        raise PermissionError("external DNS resolution is disabled in the curated code-review-graph runtime")
    return _original_getaddrinfo(host, *args, **kwargs)


def _guarded_gethostbyname(host):
    if not _allow_local_dns_host(host):
        raise PermissionError("external DNS resolution is disabled in the curated code-review-graph runtime")
    return _original_gethostbyname(host)


def _guarded_gethostbyname_ex(host):
    if not _allow_local_dns_host(host):
        raise PermissionError("external DNS resolution is disabled in the curated code-review-graph runtime")
    return _original_gethostbyname_ex(host)


def _guarded_gethostbyaddr(host):
    raise PermissionError("reverse DNS resolution is disabled in the curated code-review-graph runtime")


def _guarded_getnameinfo(sockaddr, flags):
    numeric_flags = socket.NI_NUMERICHOST | socket.NI_NUMERICSERV
    if not _local_socket_address(sockaddr) or (flags & numeric_flags) != numeric_flags:
        raise PermissionError("name resolution is disabled in the curated code-review-graph runtime")
    return _original_getnameinfo(sockaddr, flags)


def _preflight_private_runtime() -> None:
    home_value = os.environ.get("HOME", "")
    fastmcp_home_value = os.environ.get("FASTMCP_HOME", "")
    fastmcp_env_value = os.environ.get("FASTMCP_ENV_FILE", "")
    if not home_value or not fastmcp_home_value or not fastmcp_env_value:
        raise RuntimeError("missing private runtime paths")
    home = Path(home_value)
    runtime_root = home.parent
    expected_home = runtime_root / "home"
    expected_fastmcp_home = runtime_root / "fastmcp-home"
    expected_fastmcp_env = runtime_root / "fastmcp.env"
    if runtime_root.name != "code-review-graph" or runtime_root.parent.name != "yimo-pi-kit":
        raise RuntimeError("unexpected private runtime layout")
    for candidate, expected, kind in [
        (home, expected_home, "directory"),
        (Path(fastmcp_home_value), expected_fastmcp_home, "directory"),
        (Path(fastmcp_env_value), expected_fastmcp_env, "file"),
    ]:
        if candidate != expected or candidate.is_symlink():
            raise RuntimeError(f"unsafe private runtime path: {candidate}")
        metadata = candidate.lstat()
        if kind == "directory" and not stat.S_ISDIR(metadata.st_mode):
            raise RuntimeError(f"private runtime path is not a directory: {candidate}")
        if kind == "file" and (not stat.S_ISREG(metadata.st_mode) or metadata.st_size != 0):
            raise RuntimeError(f"private runtime file is not empty and regular: {candidate}")
    for parent in [runtime_root, runtime_root.parent]:
        if parent.is_symlink() or not parent.is_dir():
            raise RuntimeError(f"unsafe private runtime parent: {parent}")


socket.socket.connect = _guarded_socket_connect
socket.socket.connect_ex = _guarded_socket_connect_ex
socket.socket.sendto = _guarded_socket_sendto
if _original_socket_sendmsg is not None:
    socket.socket.sendmsg = _guarded_socket_sendmsg
socket.create_connection = _guarded_create_connection
socket.getaddrinfo = _guarded_getaddrinfo
socket.gethostbyname = _guarded_gethostbyname
socket.gethostbyname_ex = _guarded_gethostbyname_ex
socket.gethostbyaddr = _guarded_gethostbyaddr
socket.getnameinfo = _guarded_getnameinfo
_preflight_private_runtime()

import code_review_graph.context_savings as context_savings
import code_review_graph.incremental as incremental
import code_review_graph.main as server
import code_review_graph.tools.context as context_tools
import code_review_graph.tools.query as query_tools
import code_review_graph.tools.review as review_tools

TOOLS = (
    "build_or_update_graph_tool,get_minimal_context_tool,get_impact_radius_tool,"
    "query_graph_tool,semantic_search_nodes_tool,get_review_context_tool,"
    "list_graph_stats_tool,get_docs_section_tool,get_affected_flows_tool,"
    "detect_changes_tool"
)
MAX_CHANGED_FILES = 500
MAX_PATH_LENGTH = 4096
MAX_TEXT_LENGTH = 4096
_SAFE_GIT_REF = re.compile(r"^[A-Za-z0-9_.~^/@{}-]+$")
_ALLOWED_DOC_SECTIONS = {"usage", "review-delta", "review-pr", "legal", "languages", "troubleshooting"}


def _required_private_file(variable: str, expected: Path | None = None) -> Path:
    raw = os.environ.get(variable, "")
    if not raw:
        raise RuntimeError(f"missing required runtime path: {variable}")
    raw_path = Path(raw)
    try:
        metadata = raw_path.lstat()
        candidate = raw_path.resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as exc:
        raise RuntimeError(f"invalid runtime path in {variable}") from exc
    if raw_path.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"runtime path is not a regular non-symlink file: {raw_path}")
    if expected is not None and (expected.is_symlink() or candidate != expected.resolve(strict=True)):
        raise RuntimeError(f"unexpected runtime path in {variable}")
    return candidate


def _find_locked_root() -> Path:
    current = Path.cwd().resolve()
    for candidate in (current, *current.parents):
        marker = candidate / ".git"
        if marker.is_symlink():
            raise RuntimeError(f"refusing symlinked .git marker: {marker}")
        if marker.is_dir() or marker.is_file():
            return candidate.resolve()
    raise RuntimeError("code-review-graph must start inside a Git repository")


LOCKED_ROOT = _find_locked_root()
os.environ["YIMO_PI_KIT_LOCKED_ROOT"] = str(LOCKED_ROOT)
_runtime_home_value = os.environ.get("HOME", "")
if not _runtime_home_value:
    raise RuntimeError("missing private runtime HOME")
_RUNTIME_HOME = Path(_runtime_home_value).resolve(strict=True)
if not _RUNTIME_HOME.is_dir() or _RUNTIME_HOME.is_symlink():
    raise RuntimeError("unsafe private runtime HOME")
_RUNTIME_ROOT = _RUNTIME_HOME.parent
_fastmcp_home = Path(os.environ.get("FASTMCP_HOME", "")).resolve(strict=True)
if _fastmcp_home != _RUNTIME_ROOT / "fastmcp-home" or not _fastmcp_home.is_dir() or _fastmcp_home.is_symlink():
    raise RuntimeError("unsafe private FastMCP home")
_fastmcp_env = _required_private_file(
    "FASTMCP_ENV_FILE",
    _RUNTIME_ROOT / "fastmcp.env",
)
if _fastmcp_env.stat().st_size != 0:
    raise RuntimeError("private FastMCP environment file must be empty")
_GIT_SHIM = _required_private_file(
    "YIMO_PI_KIT_GIT_SHIM",
    _RUNTIME_ROOT / "bin" / "git-shim.mjs",
)
_NODE = _required_private_file("YIMO_PI_KIT_NODE")
if os.name != "nt":
    shim_mode = _GIT_SHIM.stat().st_mode
    if shim_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise RuntimeError("Git shim is writable by group or other users")
    if hasattr(os, "getuid") and _GIT_SHIM.stat().st_uid != os.getuid():
        raise RuntimeError("Git shim is not owned by the current user")

_original_subprocess_run = subprocess.run
_PARSER_PROBE_CODE = (
    "from tree_sitter_language_pack import get_parser\n"
    "import sys\n"
    "get_parser(sys.argv[1])\n"
)
_SAFE_GRAMMAR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_+.-]{0,63}$")


def _guarded_subprocess_run(args, *positional, **keywords):
    if not isinstance(args, (list, tuple)) or not args:
        raise RuntimeError("string and empty subprocess commands are disabled")
    executable = os.fspath(args[0])
    if executable == "git":
        rewritten = [str(_NODE), str(_GIT_SHIM), *(os.fspath(arg) for arg in args[1:])]
        return _original_subprocess_run(rewritten, *positional, **keywords)
    if executable == "svn":
        raise FileNotFoundError("SVN is disabled in the curated code-review-graph profile")
    try:
        resolved = Path(executable).resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as exc:
        raise RuntimeError(f"unapproved subprocess executable: {executable!r}") from exc
    if resolved != Path(sys.executable).resolve(strict=True):
        raise RuntimeError(f"unapproved subprocess executable: {resolved}")

    normalized = [os.fspath(argument) for argument in args]
    if (
        positional
        or len(normalized) != 5
        or normalized[1:4] != ["-I", "-c", _PARSER_PROBE_CODE]
        or not isinstance(normalized[4], str)
        or not _SAFE_GRAMMAR.fullmatch(normalized[4])
    ):
        raise RuntimeError("only the fixed Tree-sitter parser probe subprocess is allowed")
    if set(keywords) - {"stdin", "stdout", "stderr", "timeout", "check"}:
        raise RuntimeError("unexpected parser probe subprocess options")
    timeout = keywords.get("timeout")
    if not isinstance(timeout, (int, float)) or not 0 < float(timeout) <= 5:
        raise RuntimeError("parser probe timeout is missing or exceeds the curated limit")
    if (
        keywords.get("stdin") != subprocess.DEVNULL
        or keywords.get("stdout") != subprocess.DEVNULL
        or keywords.get("stderr") != subprocess.DEVNULL
        or keywords.get("check") is not False
    ):
        raise RuntimeError("parser probe stdio or check mode is not curated")
    return _original_subprocess_run(normalized, **keywords)


subprocess.run = _guarded_subprocess_run


def _locked_repo_root(requested: str | None = None) -> str:
    if requested is not None and str(requested).strip():
        candidate = Path(str(requested)).expanduser()
        if not candidate.is_absolute():
            candidate = LOCKED_ROOT / candidate
        try:
            resolved = candidate.resolve(strict=False)
        except (OSError, RuntimeError, ValueError) as exc:
            raise ValueError(f"invalid repo_root: {requested!r}") from exc
        if resolved != LOCKED_ROOT:
            raise ValueError(
                "curated code-review-graph profile is locked to "
                f"{LOCKED_ROOT}; requested {resolved}"
            )
    return str(LOCKED_ROOT)


def _has_symlink_component(candidate: Path) -> bool:
    current = candidate
    while current != LOCKED_ROOT:
        if current.is_symlink():
            return True
        parent = current.parent
        if parent == current:
            return True
        current = parent
    return False


def _safe_changed_files(values: Iterable[str] | None) -> list[str] | None:
    if values is None:
        return None
    if isinstance(values, (str, bytes)):
        raise ValueError("changed_files must be a list of repository-relative paths")
    items = list(values)
    if len(items) > MAX_CHANGED_FILES:
        raise ValueError(f"changed_files exceeds the {MAX_CHANGED_FILES}-path limit")

    normalized: list[str] = []
    seen: set[str] = set()
    for value in items:
        if not isinstance(value, str) or not value or "\x00" in value:
            raise ValueError("changed_files contains an invalid path")
        if len(value) > MAX_PATH_LENGTH:
            raise ValueError("changed_files contains an overlong path")
        path_value = Path(value)
        if ".." in path_value.parts or path_value.is_absolute() or path_value.drive or path_value.root:
            raise ValueError(f"changed file must be repository-relative: {value!r}")
        lexical = LOCKED_ROOT / path_value
        try:
            resolved = lexical.resolve(strict=False)
            relative = resolved.relative_to(LOCKED_ROOT)
        except (OSError, RuntimeError, ValueError) as exc:
            raise ValueError(f"changed file escapes the locked repository: {value!r}") from exc
        if relative == Path(".") or _has_symlink_component(lexical):
            raise ValueError(f"unsafe changed file path: {value!r}")
        portable = relative.as_posix()
        if portable not in seen:
            seen.add(portable)
            normalized.append(portable)
    return normalized


def _safe_estimate_file_tokens(root: Path, changed_files: Iterable[str]) -> int:
    try:
        safe_files = _safe_changed_files(changed_files) or []
    except ValueError:
        safe_files = []
    return _original_estimate_file_tokens(LOCKED_ROOT, safe_files)


def _detail_level(value: str) -> str:
    return value if value in {"minimal", "standard"} else "minimal"


def _safe_base(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 256 or value.startswith("-") or not _SAFE_GIT_REF.fullmatch(value):
        raise ValueError("invalid Git base ref")
    return value


def _bounded_text(value: str, label: str, maximum: int = MAX_TEXT_LENGTH) -> str:
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value:
        raise ValueError(f"invalid or overlong {label}")
    return value


def _safe_graph_data_dir(repo_root: Path) -> Path:
    _locked_repo_root(str(repo_root))
    ignore_file = LOCKED_ROOT / ".code-review-graphignore"
    if os.path.lexists(ignore_file):
        metadata = ignore_file.lstat()
        if ignore_file.is_symlink() or not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError(f"refusing unsafe graph ignore file: {ignore_file}")

    data_dir = LOCKED_ROOT / ".code-review-graph"
    if os.path.lexists(data_dir):
        metadata = data_dir.lstat()
        if data_dir.is_symlink() or not stat.S_ISDIR(metadata.st_mode):
            raise RuntimeError(f"refusing unsafe graph data directory: {data_dir}")
    else:
        data_dir.mkdir(mode=0o700)
    if os.name != "nt":
        data_dir.chmod(0o700)

    protected = [
        data_dir / ".gitignore",
        data_dir / "graph.db",
        data_dir / "graph.db-wal",
        data_dir / "graph.db-shm",
        data_dir / "graph.db-journal",
        LOCKED_ROOT / ".code-review-graph.db",
        LOCKED_ROOT / ".code-review-graph.db-wal",
        LOCKED_ROOT / ".code-review-graph.db-shm",
        LOCKED_ROOT / ".code-review-graph.db-journal",
    ]
    for candidate in protected:
        if not os.path.lexists(candidate):
            continue
        metadata = candidate.lstat()
        if candidate.is_symlink() or not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError(f"refusing unsafe graph data file: {candidate}")
        if metadata.st_nlink != 1:
            raise RuntimeError(f"refusing hard-linked graph data file: {candidate}")
        if os.name != "nt":
            candidate.chmod(0o600)

    inner_ignore = data_dir / ".gitignore"
    if not inner_ignore.exists():
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(inner_ignore, flags, 0o600)
        try:
            os.write(
                descriptor,
                b"# Generated by yimo-pi-kit for code-review-graph.\n*\n",
            )
        finally:
            os.close(descriptor)
    return data_dir


_original_get_changed_files = incremental.get_changed_files
_original_get_staged_and_unstaged = incremental.get_staged_and_unstaged
_original_find_dependents = incremental.find_dependents


def _safe_get_changed_files(repo_root: Path, base: str = "HEAD~1") -> list[str]:
    _locked_repo_root(str(repo_root))
    return _safe_changed_files(
        _original_get_changed_files(LOCKED_ROOT, _safe_base(base))
    ) or []


def _safe_get_staged_and_unstaged(repo_root: Path) -> list[str]:
    _locked_repo_root(str(repo_root))
    return _safe_changed_files(_original_get_staged_and_unstaged(LOCKED_ROOT)) or []


def _safe_find_dependents(store, file_path: str, max_hops: int = 2):
    result = _original_find_dependents(store, file_path, max_hops=max_hops)
    safe: list[str] = []
    for value in result:
        candidate = Path(value)
        if candidate.is_absolute():
            try:
                resolved = candidate.resolve(strict=False)
                resolved.relative_to(LOCKED_ROOT)
            except (OSError, RuntimeError, ValueError):
                continue
            if not _has_symlink_component(candidate):
                safe.append(str(resolved))
        else:
            normalized = _safe_changed_files([str(candidate)]) or []
            safe.extend(normalized)
    return incremental.DependentList(safe, truncated=getattr(result, "truncated", False))


incremental.get_data_dir = _safe_graph_data_dir
incremental.get_changed_files = _safe_get_changed_files
incremental.get_staged_and_unstaged = _safe_get_staged_and_unstaged
incremental.find_dependents = _safe_find_dependents
context_tools.get_changed_files = _safe_get_changed_files
query_tools.get_changed_files = _safe_get_changed_files
query_tools.get_staged_and_unstaged = _safe_get_staged_and_unstaged
review_tools.get_changed_files = _safe_get_changed_files
review_tools.get_staged_and_unstaged = _safe_get_staged_and_unstaged

_original_estimate_file_tokens = context_savings.estimate_file_tokens
context_savings.estimate_file_tokens = _safe_estimate_file_tokens
query_tools.estimate_file_tokens = _safe_estimate_file_tokens
review_tools.estimate_file_tokens = _safe_estimate_file_tokens

_original_build = server.build_or_update_graph
_original_minimal = server.get_minimal_context
_original_impact = server.get_impact_radius
_original_query = server.query_graph
_original_search = server.semantic_search_nodes
_original_review = server.get_review_context
_original_stats = server.list_graph_stats
_original_docs = server.get_docs_section
_original_flows = server.get_affected_flows_func
_original_detect = server.detect_changes_func


def _build(
    full_rebuild: bool = False,
    repo_root: str | None = None,
    base: str = "HEAD~1",
    postprocess: str = "full",
    recurse_submodules: bool | None = None,
    embedding_provider: str | None = None,
    embedding_model: str | None = None,
):
    _locked_repo_root(repo_root)
    if postprocess not in {"none", "minimal", "full"}:
        raise ValueError("postprocess must be none, minimal, or full")
    return _original_build(
        full_rebuild=bool(full_rebuild),
        repo_root=str(LOCKED_ROOT),
        base=_safe_base(base),
        postprocess=postprocess,
        recurse_submodules=False,
        embedding_provider=None,
        embedding_model=None,
    )


def _minimal(
    task: str = "",
    changed_files: list[str] | None = None,
    repo_root: str | None = None,
    base: str = "HEAD~1",
):
    _locked_repo_root(repo_root)
    return _original_minimal(
        task=_bounded_text(task, "task"),
        changed_files=_safe_changed_files(changed_files),
        repo_root=str(LOCKED_ROOT),
        base=_safe_base(base),
    )


def _impact(
    changed_files: list[str] | None = None,
    max_depth: int = 2,
    max_results: int = 500,
    repo_root: str | None = None,
    base: str = "HEAD~1",
    detail_level: str = "standard",
):
    _locked_repo_root(repo_root)
    return _original_impact(
        changed_files=_safe_changed_files(changed_files),
        max_depth=max(1, min(int(max_depth), 2)),
        max_results=max(1, min(int(max_results), 500)),
        repo_root=str(LOCKED_ROOT),
        base=_safe_base(base),
        detail_level=_detail_level(detail_level),
    )


def _query(
    pattern: str,
    target: str,
    repo_root: str | None = None,
    detail_level: str = "standard",
    max_results: int = 100,
):
    _locked_repo_root(repo_root)
    return _original_query(
        pattern=_bounded_text(pattern, "query pattern", 64),
        target=_bounded_text(target, "query target"),
        repo_root=str(LOCKED_ROOT),
        detail_level=_detail_level(detail_level),
        max_results=max(1, min(int(max_results), 100)),
    )


def _search(
    query: str,
    kind: str | None = None,
    limit: int = 20,
    repo_root: str | None = None,
    context_files: list[str] | None = None,
    model: str | None = None,
    provider: str | None = None,
    detail_level: str = "standard",
):
    _locked_repo_root(repo_root)
    return _original_search(
        query=_bounded_text(query, "search query"),
        kind=_bounded_text(kind, "node kind", 64) if kind is not None else None,
        limit=max(1, min(int(limit), 20)),
        repo_root=str(LOCKED_ROOT),
        context_files=_safe_changed_files(context_files),
        model=None,
        provider=None,
        detail_level=_detail_level(detail_level),
    )


def _review(
    changed_files: list[str] | None = None,
    max_depth: int = 2,
    include_source: bool = True,
    max_lines_per_file: int = 200,
    repo_root: str | None = None,
    base: str = "HEAD~1",
    detail_level: str = "standard",
):
    _locked_repo_root(repo_root)
    return _original_review(
        changed_files=_safe_changed_files(changed_files),
        max_depth=max(1, min(int(max_depth), 2)),
        include_source=False,
        max_lines_per_file=max(1, min(int(max_lines_per_file), 200)),
        repo_root=str(LOCKED_ROOT),
        base=_safe_base(base),
        detail_level=_detail_level(detail_level),
    )


def _stats(repo_root: str | None = None):
    _locked_repo_root(repo_root)
    return _original_stats(repo_root=str(LOCKED_ROOT))


def _docs(section_name: str, repo_root: str | None = None):
    _locked_repo_root(repo_root)
    section = _bounded_text(section_name, "documentation section", 64)
    if section not in _ALLOWED_DOC_SECTIONS:
        raise ValueError(
            "documentation section is not exposed by the curated profile: "
            f"{section}"
        )
    # The packaged reference wins when repo_root is omitted, preventing a
    # repository-controlled docs/LLM-OPTIMIZED-REFERENCE.md override.
    return _original_docs(section_name=section, repo_root=None)


def _flows(
    changed_files: list[str] | None = None,
    base: str = "HEAD~1",
    repo_root: str | None = None,
):
    _locked_repo_root(repo_root)
    return _original_flows(
        changed_files=_safe_changed_files(changed_files),
        base=_safe_base(base),
        repo_root=str(LOCKED_ROOT),
    )


def _detect(
    base: str = "HEAD~1",
    changed_files: list[str] | None = None,
    include_source: bool = False,
    max_depth: int = 2,
    repo_root: str | None = None,
    detail_level: str = "standard",
):
    _locked_repo_root(repo_root)
    return _original_detect(
        base=_safe_base(base),
        changed_files=_safe_changed_files(changed_files),
        include_source=False,
        max_depth=max(1, min(int(max_depth), 2)),
        repo_root=str(LOCKED_ROOT),
        detail_level=_detail_level(detail_level),
    )


server._resolve_repo_root = _locked_repo_root
server.build_or_update_graph = _build
server.get_minimal_context = _minimal
server.get_impact_radius = _impact
server.query_graph = _query
server.semantic_search_nodes = _search
server.get_review_context = _review
server.list_graph_stats = _stats
server.get_docs_section = _docs
server.get_affected_flows_func = _flows
server.detect_changes_func = _detect


async def _remove_upstream_prompts() -> None:
    for prompt in await server.mcp.list_prompts():
        server.mcp.local_provider.remove_prompt(prompt.name)


asyncio.run(_remove_upstream_prompts())

if sys.argv[1:] != ["serve", "--tools", TOOLS]:
    raise RuntimeError("unexpected code-review runner arguments")

server.main(
    repo_root=str(LOCKED_ROOT),
    tools=TOOLS,
    auto_watch=False,
    transport="stdio",
)
