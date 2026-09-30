"""Use a ChatGPT Plus or Pro plan through OpenAI's Sign in with ChatGPT (docs/chatgpt-sign-in.md).

``SignIn`` runs the browser sign-in, ``save_account`` keeps the result as a connection, ``ChatGPTTokens`` keeps
its token fresh and ``ChatGPTModel`` runs a model on the plan.
"""

from .connections import account_of, is_chatgpt, save_account, sign_out
from .model import ChatGPTModel, ModelInfo, fetch_models
from .oauth import Account, SignIn, SignInError, host_id
from .tokens import ChatGPTError, ChatGPTTokens, PlanUsageOff, SignInNeeded, UsageLimitError

__all__ = [
    "Account",
    "ChatGPTError",
    "ChatGPTModel",
    "ChatGPTTokens",
    "ModelInfo",
    "PlanUsageOff",
    "SignIn",
    "SignInError",
    "SignInNeeded",
    "UsageLimitError",
    "account_of",
    "fetch_models",
    "host_id",
    "is_chatgpt",
    "save_account",
    "sign_out",
]
