"""Alpine Cloud: signing in to Alpine, publishing a project (올리기), its data, plans, and the Node.js web apps need.

The contract with the cloud service is docs/alpine-cloud-api.md (section 6.2 lists these methods). Open enums (a
``reason``, a ``phase``, a check ``id``, a finding ``code``) are plain strings: a newer server may send a value an
older app does not know, and the app then shows the finding's ``fallback`` text or skips the value.

Errors are the server's usual ``ErrorData.reason``: ``invalid_code`` (``cloud/verifyCode``), ``signed_out`` (a method
that needs a sign-in), ``unreachable`` (the API did not answer), ``build_failed`` (``publish/prepare``; the message is
the last 40 lines of output), ``read_only`` (``data/save`` on live data), ``not_available`` (a method this server does
not do yet), and the cloud API's own ``code`` otherwise (``limit_reached``, ``payment_required``, ``name_taken``...).
"""

from typing import Any, Literal

from pydantic import Field

from .base import Message

# ---------------------------------------------------------------- account


class CloudAccount(Message):
    id: str
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None
    status: str = "active"
    """``active`` | ``suspended`` (open)."""


class CloudPlan(Message):
    id: str
    """``free`` | ``pro`` (open)."""
    status: str
    """``active`` | ``trialing`` | ``past_due`` | ``cancelled`` (open)."""
    trial_ends_at: str | None = None
    trial_used: bool = False
    renews_at: str | None = None


class CloudLimits(Message):
    """The plan's limits, as ``GET /v1/me`` sends them; a limit a newer server adds is not here until the app knows."""

    apps: int
    mails_per_day: int
    d1_mb: int
    monthly_credits: int
    restore_days: int
    custom_domains: bool
    badge: bool
    web_pro: bool


class CloudCredits(Message):
    """1 credit is one US cent."""

    balance: int
    monthly: int
    refills_at: str | None = None


class CloudStatus(Message):
    signed_in: bool
    api_url: str
    """The Alpine API this app talks to (one setting)."""
    app_domain: str | None = None
    """Where apps live (``alpinesite.app``), as the API says; ``None`` until it has answered once."""
    account: CloudAccount | None = None
    plan: CloudPlan | None = None
    limits: CloudLimits | None = None
    credits: CloudCredits | None = None
    reachable: bool = True
    """``False``: signed in, but the API did not answer; the rest is what was known last."""


class CloudStatusParams(Message):
    refresh: bool = False
    """Ask the API now instead of using what was fetched in the last 30 seconds."""


class CloudSignInMethodsParams(Message):
    pass


class CloudSignInMethodsResult(Message):
    """The ways to sign in on this server, in the order to show them: ``google`` | ``github`` | ``email`` (open). A
    server that offers only ``email`` has no Google or GitHub; the app hides those buttons."""

    methods: list[str]


class CloudSignInParams(Message):
    """Starts a browser sign-in. The app opens ``url`` and waits for ``cloud/signInFinished``. Starting one cancels
    the one still waiting."""

    method: Literal["google", "github"]


class CloudSignInResult(Message):
    attempt_id: str
    url: str
    """The sign-in page. Also show it, for when no browser opens."""


class CloudCancelSignInParams(Message):
    attempt_id: str


class CloudCancelSignInResult(Message):
    pass


class CloudSendCodeParams(Message):
    email: str
    locale: str = "ko"


class CloudSendCodeResult(Message):
    pass


class CloudVerifyCodeParams(Message):
    email: str
    code: str


class CloudSignOutParams(Message):
    pass


class CloudSignOutResult(Message):
    pass


class CloudSignInFinishedParams(Message):
    """The end of a browser sign-in, whichever way it ended."""

    attempt_id: str
    result: Literal["connected", "cancelled", "timed_out", "failed"]
    status: CloudStatus | None = None
    """With ``connected``: the signed-in status."""
    message: str | None = None
    """With ``failed``: what went wrong, in English."""


class CloudChangedParams(Message):
    """Sign-in, plan or credits changed (after each model answer the credits come with it, at most once a second)."""

    status: CloudStatus


# ---------------------------------------------------------------- plans and Pro


class PlanInfo(Message):
    id: str
    limits: CloudLimits
    price: dict[str, Any] | None = None
    """``{amount, currency, interval}``; a placeholder until the price is decided."""
    trial_days: int | None = None


class CloudPlansParams(Message):
    pass


class CloudPlansResult(Message):
    plans: list[PlanInfo]


class CloudStartTrialParams(Message):
    pass


class CloudCheckoutParams(Message):
    plan: str = "pro"


class CloudUrlResult(Message):
    url: str
    """The page to open in the browser."""


class CloudPortalParams(Message):
    pass


# ---------------------------------------------------------------- publishing


class AppInfo(Message):
    id: str
    name: str
    address: str
    url: str
    status: str
    """``empty`` | ``live`` | ``paused`` | ``taken_down`` (open)."""
    kind: str
    badge: bool = True


class PublishCwdParams(Message):
    cwd: str


class PublishStatus(Message):
    publishable: bool
    reason: str | None = None
    """Why not: ``no_description`` | ``not_web`` | ``signed_out`` | ``no_node`` | ``taken_down`` (open)."""
    app: AppInfo | None = None
    last_published_at: str | None = None
    changes: int = 0
    """Files changed since the last publish."""


class Finding(Message):
    check: str
    code: str
    """``secret.stripe_live``, ``open_api.readable``... (open): the app words it by code and falls back to
    ``fallback``."""
    severity: str
    """``block`` | ``warn`` | ``info``."""
    file: str | None = None
    line: int | None = None
    params: dict[str, str] = Field(default_factory=dict)
    fallback: str | None = None
    """A plain sentence in the request's language, for a code the app has no words for."""
    fix: str = ""
    """English, for the agent: what and where, never the secret itself."""


class Check(Message):
    id: str
    """``secret`` | ``open-api`` | ``advisor`` (open)."""
    state: str
    """``running`` | ``ok`` | ``attention`` | ``blocked`` | ``skipped`` (open)."""
    findings: list[Finding] = Field(default_factory=list)


class ShapeColumn(Message):
    table: str
    column: str


class ShapeAdded(Message):
    tables: list[str] = Field(default_factory=list)
    columns: list[ShapeColumn] = Field(default_factory=list)


class ShapeConfirm(Message):
    """A change the person has to say yes to before it is published."""

    id: str
    """``drop_column:bookings.memo``; stays the same between the check and the publish."""
    kind: str
    """``drop_table``, ``drop_column``, ``rename_table``, ``rename_column``, ``data_change``, ``unknown`` (open)."""
    table: str | None = None
    column: str | None = None
    rows_affected: int | None = None
    to: str | None = None
    """For ``rename_table`` and ``rename_column``: the new name."""
    statement: str | None = None
    """For ``data_change`` and ``unknown``: the statement's first 200 characters."""


class PublishShape(Message):
    pending: list[str] = Field(default_factory=list)
    """Migrations that will run."""
    added: ShapeAdded = Field(default_factory=ShapeAdded)
    confirms: list[ShapeConfirm] = Field(default_factory=list)


class PublishPrepareParams(Message):
    id: str
    """Chosen by the app; ``publish/changed`` and ``publish/cancel`` carry it."""
    cwd: str
    locale: str = "ko"


class PublishPlan(Message):
    deploy_id: str
    checks: list[Check]
    blocked: bool
    shape: PublishShape
    app: AppInfo | None = None


class PublishRunParams(Message):
    id: str
    cwd: str
    deploy_id: str
    confirm: list[str] = Field(default_factory=list)


class PublishRunResult(Message):
    app: AppInfo
    published_at: str


class PublishCancelParams(Message):
    id: str


class PublishCancelResult(Message):
    pass


class PublishChangedParams(Message):
    """Where a ``publish/prepare`` or ``publish/run`` is."""

    id: str
    phase: str
    """``build`` | ``checks`` | ``upload`` | ``restore`` | ``files`` | ``shape`` | ``live`` (open)."""
    progress: float = 0
    """0 to 1 within the phase."""
    checks: list[Check] | None = None
    message: str | None = None


class RestorePoint(Message):
    id: str
    at: str
    reason: str
    """``publish`` | ``data_write`` | ``before_restore`` | ``manual`` (open)."""


class PublishRestorePointsResult(Message):
    points: list[RestorePoint]
    window_days: int


class PublishRestoreParams(Message):
    cwd: str
    point: str


class PublishRestoreResult(Message):
    pass


class DomainRecord(Message):
    type: str
    name: str
    value: str
    purpose: str
    """``web`` | ``spf`` | ``dkim`` | ``dmarc`` (open)."""
    ok: bool = False


class DomainConnect(Message):
    provider: str
    url: str


class Domain(Message):
    id: str
    name: str
    status: str
    """``pending`` | ``active`` | ``failed`` (open)."""
    records: list[DomainRecord] = Field(default_factory=list)
    domain_connect: DomainConnect | None = None


class PublishDomainsResult(Message):
    domains: list[Domain]


class PublishAddDomainParams(Message):
    cwd: str
    domain: str
    mail: bool = False


class PublishDomainParams(Message):
    cwd: str
    id: str


class PublishDomainResult(Message):
    domain: Domain


class PublishRemoveDomainResult(Message):
    pass


class PublishSetBadgeParams(Message):
    cwd: str
    badge: bool


class PublishSetBadgeResult(Message):
    app: AppInfo


# ---------------------------------------------------------------- data (the 데이터 tab)

DataSourceKind = Literal["practice", "live"]
"""``practice``: the project's local database on this Mac, editable. ``live``: the published app's, read-only here."""


class DataSource(Message):
    kind: DataSourceKind
    available: bool


class DataSourcesResult(Message):
    sources: list[DataSource]


class DataTablesParams(Message):
    cwd: str
    source: DataSourceKind


class DataColumn(Message):
    name: str
    type: str
    """The declared SQLite type as written; the app maps it to its own kinds."""
    pk: bool = False
    nullable: bool = True
    references: str | None = None


class DataTable(Message):
    name: str
    rows: int
    columns: list[DataColumn]


class DataTablesResult(Message):
    tables: list[DataTable]


class DataRowsParams(Message):
    cwd: str
    source: DataSourceKind
    table: str
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)
    order: str | None = None
    dir: Literal["asc", "desc"] | None = None


class DataRowsResult(Message):
    columns: list[str]
    rows: list[list[Any]]
    total: int


class DataSaveParams(Message):
    cwd: str
    source: DataSourceKind
    table: str
    key: dict[str, Any] | None = None
    """The row's primary key (column -> value); ``None`` adds a row."""
    cells: dict[str, Any]


class DataSaveResult(Message):
    pass


class DataDeleteParams(Message):
    cwd: str
    source: DataSourceKind
    table: str
    key: dict[str, Any]


class DataDeleteResult(Message):
    pass


class DataReadsParams(Message):
    cwd: str


class DataRead(Message):
    at: str
    session: str | None = None
    sql: str
    tables: list[str] = Field(default_factory=list)
    rows: int = 0


class DataReadsResult(Message):
    reads: list[DataRead]
    """What the AI read from the live data, newest first (kept 30 days)."""


# ---------------------------------------------------------------- Node.js


class ProjectsNodeToolsParams(Message):
    pass


class ProjectsNodeToolsResult(Message):
    ready: bool
    """A Node.js that web apps can use (22.12 or newer) is on this computer."""
    version: str | None = None
    required: str = "22.12"
    alpine_managed: bool = False
    """The one in use is Alpine's own copy (``~/.alpine-code/runtimes/node``)."""


class ProjectsInstallNodeToolsParams(Message):
    """Installs Alpine's own Node.js (about 50 MB from nodejs.org, checked against its published checksum). Answers at
    once; ``projects/nodeToolsChanged`` follows the download."""


class ProjectsInstallNodeToolsResult(Message):
    pass


class ProjectsNodeToolsChangedParams(Message):
    state: Literal["downloading", "done", "failed"]
    progress: float | None = None
    """0 to 1 while ``downloading``."""
    message: str | None = None
    """With ``failed``: what went wrong, in English."""
    reason: str | None = None
    """With ``failed``: ``unsupported`` | ``download`` | ``checksum`` | ``unpack``."""


CLOUD_METHODS = {
    "cloud/status": (CloudStatusParams, CloudStatus),
    "cloud/signInMethods": (CloudSignInMethodsParams, CloudSignInMethodsResult),
    "cloud/signIn": (CloudSignInParams, CloudSignInResult),
    "cloud/cancelSignIn": (CloudCancelSignInParams, CloudCancelSignInResult),
    "cloud/sendCode": (CloudSendCodeParams, CloudSendCodeResult),
    "cloud/verifyCode": (CloudVerifyCodeParams, CloudStatus),
    "cloud/signOut": (CloudSignOutParams, CloudSignOutResult),
    "cloud/plans": (CloudPlansParams, CloudPlansResult),
    "cloud/startTrial": (CloudStartTrialParams, CloudStatus),
    "cloud/checkout": (CloudCheckoutParams, CloudUrlResult),
    "cloud/portal": (CloudPortalParams, CloudUrlResult),
    "publish/status": (PublishCwdParams, PublishStatus),
    "publish/prepare": (PublishPrepareParams, PublishPlan),
    "publish/run": (PublishRunParams, PublishRunResult),
    "publish/cancel": (PublishCancelParams, PublishCancelResult),
    "publish/restorePoints": (PublishCwdParams, PublishRestorePointsResult),
    "publish/restore": (PublishRestoreParams, PublishRestoreResult),
    "publish/domains": (PublishCwdParams, PublishDomainsResult),
    "publish/addDomain": (PublishAddDomainParams, PublishDomainResult),
    "publish/checkDomain": (PublishDomainParams, PublishDomainResult),
    "publish/removeDomain": (PublishDomainParams, PublishRemoveDomainResult),
    "publish/setBadge": (PublishSetBadgeParams, PublishSetBadgeResult),
    "data/sources": (PublishCwdParams, DataSourcesResult),
    "data/tables": (DataTablesParams, DataTablesResult),
    "data/rows": (DataRowsParams, DataRowsResult),
    "data/save": (DataSaveParams, DataSaveResult),
    "data/delete": (DataDeleteParams, DataDeleteResult),
    "data/reads": (DataReadsParams, DataReadsResult),
    "projects/nodeTools": (ProjectsNodeToolsParams, ProjectsNodeToolsResult),
    "projects/installNodeTools": (ProjectsInstallNodeToolsParams, ProjectsInstallNodeToolsResult),
}

CLOUD_NOTIFICATIONS = {
    "cloud/signInFinished": CloudSignInFinishedParams,
    "cloud/changed": CloudChangedParams,
    "publish/changed": PublishChangedParams,
    "projects/nodeToolsChanged": ProjectsNodeToolsChangedParams,
}
