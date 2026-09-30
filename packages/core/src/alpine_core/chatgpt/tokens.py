"""A connection's ChatGPT tokens: read from the store, refreshed when due, saved back, one process at a time."""

from __future__ import annotations

from alpineagents import AuthError, ProviderError, RateLimitError

from ..secrets import OAuthTokens
from .oauth import Account, PostForm, RefreshError, post_form, refresh


class ChatGPTError(ProviderError):
    """A ChatGPT plan request failed. ``code`` is OpenAI's error code when it sent one."""

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


class UsageLimitError(ChatGPTError, RateLimitError):
    """The ChatGPT plan, or this app's share of it, is used up for now. Nothing switches to another way of paying."""


class SignInNeeded(ChatGPTError, AuthError):
    """The connection has no usable sign-in: never signed in, signed out, or the tokens died. Sign in again."""


class PlanUsageOff(ChatGPTError, AuthError):
    """Signed in, but the user did not allow alpine-code to use their ChatGPT plan."""


class ChatGPTTokens:
    """The access token for connection ``name``, refreshed five minutes before it runs out.

    A refresh happens under the store's lock and re-reads the store first, so when the CLI and the app both find
    the token due, only one of them spends the rotating refresh token and the other picks up its result.
    """

    def __init__(self, store: OAuthTokens, name: str, post: PostForm = post_form) -> None:
        self.store = store
        self.name = name
        self._post = post

    def account(self) -> Account:
        """The saved account, signed in or not.

        Raises:
            SignInNeeded: Nothing is saved for this connection.
        """
        record = self.store.get_oauth(self.name)
        if record is None:
            raise SignInNeeded(f"Connection {self.name!r} is not signed in to ChatGPT.")
        return Account.from_record(record)

    def access_token(self) -> str:
        """A token that is good for at least a few more minutes.

        Raises:
            SignInNeeded: Signed out, or the refresh token no longer works.
            PlanUsageOff: The user did not allow plan usage.
            ChatGPTError: OpenAI could not be reached to refresh; the saved tokens are kept.
        """
        account = self._usable(self.account())
        if not account.needs_refresh():
            return account.access_token
        return self._refresh(lambda current: current.needs_refresh())

    def refresh_after_rejection(self, rejected: str) -> str:
        """A new token after the API turned ``rejected`` down (401), unless another process has already replaced it."""
        return self._refresh(lambda current: current.access_token == rejected)

    def _refresh(self, still_due) -> str:
        with self.store.locked():
            account = self._usable(self.account())  # re-read: another process may have refreshed meanwhile
            if not still_due(account):
                return account.access_token
            try:
                account = refresh(account, self._post)
            except RefreshError as e:
                if e.for_good:
                    self.store.set_oauth(self.name, account.signed_out().to_record())
                    raise SignInNeeded(f"The ChatGPT sign-in of {self.name!r} has ended. Sign in again.") from e
                raise ChatGPTError(str(e)) from e
            self.store.set_oauth(self.name, account.to_record())
            return account.access_token

    def _usable(self, account: Account) -> Account:
        if not account.signed_in:
            raise SignInNeeded(f"Connection {self.name!r} is signed out of ChatGPT. Sign in again.")
        if not account.plan_usage:
            raise PlanUsageOff(
                f"Connection {self.name!r} is signed in, but using the ChatGPT plan was not allowed. "
                "Allow it by signing in again, or connect with an API key."
            )
        return account
