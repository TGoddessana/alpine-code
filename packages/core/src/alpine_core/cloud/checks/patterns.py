"""The secret patterns of the publish checks (contract 4.6); the server keeps the same table and test vectors."""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Severity = Literal["block", "warn", "info"]

# The text file types that end up in a browser; worker modules never do, so they are not scanned.
TEXT_SUFFIXES = frozenset({".js", ".mjs", ".css", ".html", ".json", ".map", ".txt", ".svg"})


@dataclass(frozen=True)
class Rule:
    code: str
    kind: str  # plain words for the agent: "Stripe secret key"
    severity: Severity
    pattern: re.Pattern[str]
    prefixes: tuple[str, ...]  # the one the key starts with stays visible in the redacted form
    advice: str  # what the agent should do about it


_B = r"(?<![A-Za-z0-9_-])"  # a key is not the tail of a longer word

_STRIPE_ADVICE = "Move the call that uses it into the Worker, read the key from a Worker secret, and rotate the key."

RULES: tuple[Rule, ...] = (
    Rule(
        "secret.stripe_live",
        "Stripe secret key",
        "block",
        re.compile(_B + r"[sr]k_live_[A-Za-z0-9]{20,}"),
        ("sk_live_", "rk_live_"),
        _STRIPE_ADVICE,
    ),
    Rule(
        "secret.openai",
        "OpenAI API key",
        "block",
        re.compile(_B + r"(?:sk-proj-[A-Za-z0-9_-]{40,}|sk-(?!ant-|proj-)[A-Za-z0-9]{40,})"),
        ("sk-proj-", "sk-"),
        "Move the call that uses it into the Worker, read the key from a Worker secret, and rotate the key.",
    ),
    Rule(
        "secret.anthropic",
        "Anthropic API key",
        "block",
        re.compile(_B + r"sk-ant-[A-Za-z0-9_-]{20,}"),
        ("sk-ant-",),
        "Move the call that uses it into the Worker, read the key from a Worker secret, and rotate the key.",
    ),
    Rule(
        "secret.private_key",
        "private key",
        "block",
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----"),
        (),
        "Remove the key from the project's frontend files, keep it in a Worker secret if the Worker needs it, and "
        "replace the key because it was exposed.",
    ),
    Rule(
        "secret.github",
        "GitHub token",
        "block",
        re.compile(_B + r"(?:gh[po]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})"),
        ("ghp_", "gho_", "github_pat_"),
        "Remove the token from the frontend, call GitHub from the Worker with a Worker secret, and revoke the token.",
    ),
    Rule(
        "secret.resend",
        "Resend API key",
        "block",
        re.compile(_B + r"re_[A-Za-z0-9]{20,}"),
        ("re_",),
        "Mail goes through sendMail in the Worker, with the app's own address; remove this key and revoke it.",
    ),
    Rule(
        "secret.alpine_app",
        "Alpine app token",
        "block",
        re.compile(_B + r"alp_app_[A-Za-z0-9_-]{30,}"),
        ("alp_app_",),
        "The app token belongs to the Worker (the ALPINE_APP_TOKEN binding); remove it from the frontend.",
    ),
    Rule(
        "secret.google_api",
        "Google API key",
        "warn",
        re.compile(_B + r"AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])"),
        ("AIza",),
        "If this key is meant to be public (a Maps key, for example) restrict it to this app's address in Google "
        "Cloud; otherwise move the call into the Worker.",
    ),
    Rule(
        "secret.stripe_test",
        "Stripe test key",
        "warn",
        re.compile(_B + r"sk_test_[A-Za-z0-9]{10,}"),
        ("sk_test_",),
        "A test key is harmless for customers but should not be in the frontend; move the call into the Worker.",
    ),
)

# AWS and Supabase need more than one pattern, so they are checked by hand below.
AWS = Rule(
    "secret.aws",
    "AWS access key",
    "block",
    re.compile(_B + r"AKIA[0-9A-Z]{16}(?![0-9A-Za-z])"),
    ("AKIA",),
    "Remove the key pair from the frontend, call AWS from the Worker with Worker secrets, and deactivate the key.",
)
_AWS_SECRET = re.compile(r"(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])")
_AWS_NEAR = 200

SUPABASE = Rule(
    "secret.supabase_service",
    "Supabase service_role key",
    "block",
    re.compile(_B + r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),
    ("eyJ",),
    "The service_role key skips every row-level rule. Remove it from the frontend (the app may only use the anon "
    "key), and rotate the service_role key in Supabase.",
)

ALL_RULES: tuple[Rule, ...] = (*RULES, AWS, SUPABASE)
BY_CODE: dict[str, Rule] = {r.code: r for r in ALL_RULES}


def redact(rule: Rule, value: str) -> str:
    """'prefix…last4'; the middle of a secret never leaves this function."""
    if rule.code == "secret.private_key":
        return "-----BEGIN PRIVATE KEY-----"  # a header, not a secret
    prefix = next((p for p in rule.prefixes if value.startswith(p)), "")
    return f"{prefix}…{value[-4:]}"


def _looks_like_aws_secret(value: str) -> bool:
    # Mixed case rules out hashes and plain words of the same length.
    return value.lower() != value and value.upper() != value


def _jwt_role(token: str) -> str | None:
    try:
        payload = token.split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, IndexError):
        return None
    role = data.get("role") if isinstance(data, dict) else None
    return role if isinstance(role, str) else None


def scan_text(text: str) -> list[tuple[str, str, int]]:
    """(code, redacted, offset) for every secret in text. The parity test with the server uses this."""
    hits: list[tuple[str, str, int]] = []
    for rule in RULES:
        for m in rule.pattern.finditer(text):
            hits.append((rule.code, redact(rule, m.group()), m.start()))
    for m in AWS.pattern.finditer(text):
        # An access key id alone is not a secret; the 40-character secret next to it is what makes it one.
        around = text[max(0, m.start() - _AWS_NEAR) : m.end() + _AWS_NEAR]
        if any(_looks_like_aws_secret(s.group()) for s in _AWS_SECRET.finditer(around)):
            hits.append((AWS.code, redact(AWS, m.group()), m.start()))
    for m in SUPABASE.pattern.finditer(text):
        if _jwt_role(m.group()) == "service_role":
            hits.append((SUPABASE.code, redact(SUPABASE, m.group()), m.start()))
    return sorted(hits, key=lambda h: (h[2], h[0]))


def is_text_asset(path: Path) -> bool:
    return path.suffix.lower() in TEXT_SUFFIXES
