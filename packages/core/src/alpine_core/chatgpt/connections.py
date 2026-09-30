"""ChatGPT accounts as connections: one signed-in account (and workspace) is one ``[connections.<name>]``."""

from __future__ import annotations

from collections.abc import Mapping

from ..config import Connection, save_connection
from ..providers import Auth
from ..secrets import OAuthTokens
from .oauth import Account, revoke

#: The first ChatGPT connection's name; later ones are ``chatgpt-2``, ``chatgpt-3``...
BASE_NAME = "chatgpt"


def is_chatgpt(connection: Connection) -> bool:
    return connection.provider is not None and connection.provider.auth is Auth.CHATGPT


def account_of(connection: Connection, store: OAuthTokens) -> Account | None:
    """The account saved for ``connection``, signed in or not; ``None`` if it never signed in."""
    record = store.get_oauth(connection.name)
    return Account.from_record(record) if record is not None else None


def save_account(account: Account, store: OAuthTokens, connections: Mapping[str, Connection]) -> str:
    """Keeps a signed-in account and returns its connection's name.

    The connection that already holds this registration (same issued ``client_id`` and ``sub``) gets the new
    tokens; otherwise a new connection is added under the first free name.
    """
    name = next(
        (
            c.name
            for c in connections.values()
            if is_chatgpt(c)
            and (saved := account_of(c, store)) is not None
            and (saved.client_id, saved.subject) == (account.client_id, account.subject)
        ),
        None,
    )
    if name is None:
        name = _free_name(connections)
        save_connection(name, provider="chatgpt")
    store.set_oauth(name, account.to_record())
    return name


def sign_out(connection: Connection, store: OAuthTokens) -> bool:
    """Ends the sign-in at OpenAI and forgets its tokens; the registration stays for the next sign-in.

    Returns whether OpenAI confirmed it. Either way nothing here uses the tokens again; if OpenAI did not confirm,
    the user can disconnect alpine-code in ChatGPT settings.
    """
    account = account_of(connection, store)
    if account is None or not account.signed_in:
        return True
    confirmed = revoke(account)
    store.set_oauth(connection.name, account.signed_out().to_record())
    return confirmed


def _free_name(connections: Mapping[str, Connection]) -> str:
    if BASE_NAME not in connections:
        return BASE_NAME
    n = 2
    while f"{BASE_NAME}-{n}" in connections:
        n += 1
    return f"{BASE_NAME}-{n}"
