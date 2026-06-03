"""Core FP types: Result, Option, frozen dataclasses for harness state."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import TypeVar, Callable, Generic, Any
import re

T = TypeVar("T")
E = TypeVar("E")
U = TypeVar("U")


# ---------------------------------------------------------------------------
# Result[T, E] — tagged union: Ok | Err
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Ok(Generic[T]):
    _value: T

    def is_ok(self) -> bool:
        return True

    def is_err(self) -> bool:
        return False

    def unwrap(self) -> T:
        return self._value

    def unwrap_err(self) -> Any:
        raise ValueError("Called unwrap_err on Ok")

    def unwrap_or(self, default: T) -> T:
        return self._value

    def map(self, fn: Callable[[T], U]) -> Result[U, E]:
        return Ok(fn(self._value))

    def and_then(self, fn: Callable[[T], "Result[U, E]"]) -> "Result[U, E]":
        return fn(self._value)


@dataclass(frozen=True)
class Err(Generic[E]):
    _error: E

    def is_ok(self) -> bool:
        return False

    def is_err(self) -> bool:
        return True

    def unwrap(self) -> Any:
        raise ValueError(f"Called unwrap on Err: {self._error}")

    def unwrap_err(self) -> E:
        return self._error

    def unwrap_or(self, default: T) -> T:
        return default

    def map(self, fn: Callable[[T], U]) -> "Result[U, E]":
        return self  # type: ignore[return-value]

    def and_then(self, fn: Callable[[T], "Result[U, E]"]) -> "Result[U, E]":
        return self  # type: ignore[return-value]


Result = Ok[T] | Err[E]


# ---------------------------------------------------------------------------
# Option[T] — tagged union: Some | Nothing
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Some(Generic[T]):
    _value: T

    def is_some(self) -> bool:
        return True

    def is_nothing(self) -> bool:
        return False

    def unwrap(self) -> T:
        return self._value

    def unwrap_or(self, default: T) -> T:
        return self._value

    def map(self, fn: Callable[[T], U]) -> "Option[U]":
        return Some(fn(self._value))


@dataclass(frozen=True)
class _NothingType:
    def is_some(self) -> bool:
        return False

    def is_nothing(self) -> bool:
        return True

    def unwrap(self) -> Any:
        raise ValueError("Called unwrap on Nothing")

    def unwrap_or(self, default: T) -> T:
        return default

    def map(self, fn: Callable[[T], U]) -> "Option[U]":
        return self


Nothing = _NothingType()
Option = Some[T] | _NothingType


# ---------------------------------------------------------------------------
# Error type — frozen dataclass, not an exception
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class HarnessError:
    message: str
    details: Option[str] = Nothing


# ---------------------------------------------------------------------------
# Configuration — frozen dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class HarnessConfig:
    project_root: str
    test_dir: str
    socket_path: str
    client_cmd: str
    daemon_cmd: str
    tui_cmd: str
    session_name: str
    test_window: str
    mode: str  # "daemon" | "daemon-tmux" | "tmux" | "direct"
    key_delay: float
    operation_delay: float
    startup_wait: float
    default_timeout: int
    capture_lines: int


# ---------------------------------------------------------------------------
# Harness state — frozen dataclass, threaded through all functions
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class HarnessState:
    config: HarnessConfig
    daemon_pid: Option[int] = Nothing
    editor_pid: Option[int] = Nothing
    active_window: Option[str] = Nothing


# ---------------------------------------------------------------------------
# Assertion types — frozen dataclasses
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AssertionResult:
    passed: bool
    message: str
    details: Option[str] = Nothing

    @property
    def failed(self) -> bool:
        return not self.passed


@dataclass(frozen=True)
class AssertionSummary:
    results: tuple[AssertionResult, ...]

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if r.failed)

    @property
    def total(self) -> int:
        return len(self.results)


# ---------------------------------------------------------------------------
# T-Lisp output parser — pure function
# ---------------------------------------------------------------------------

def parse_value(raw: str) -> str | int | float | list | bool | None:
    """Parse bare T-Lisp output into a Python value.

    Handles: symbols (str), numbers (int/float), strings (str),
    lists ([...]), booleans, nil.
    """
    raw = raw.strip()
    if not raw:
        return None

    # nil / false
    if raw in ("nil", "false"):
        return None

    # true
    if raw == "true":
        return True

    # Quoted string: "..."
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]

    # List: [...]
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        items: list = []
        for part in _split_list(inner):
            items.append(parse_value(part))
        return items

    # Number (int)
    if re.match(r"^-?\d+$", raw):
        return int(raw)

    # Number (float)
    if re.match(r"^-?\d+\.\d+$", raw):
        return float(raw)

    # Symbol / bare string
    return raw


def _split_list(s: str) -> list[str]:
    """Split comma-separated list items respecting brackets and quotes."""
    parts: list[str] = []
    depth = 0
    in_str = False
    current = ""
    for ch in s:
        if ch == '"' and not (current.endswith("\\")):
            in_str = not in_str
        if not in_str:
            if ch in ("[", "("):
                depth += 1
            elif ch in ("]", ")"):
                depth -= 1
            elif ch == "," and depth == 0:
                parts.append(current.strip())
                current = ""
                continue
        current += ch
    if current.strip():
        parts.append(current.strip())
    return parts
