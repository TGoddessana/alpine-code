"""Plans, the trial, payment, the web-pro dev branch and build values, custom domains and the badge, against the
scripted fake API (``fake_cloud.py``)."""

import os
import stat
import threading
import time
import urllib.error
import urllib.request

import pytest
from cloud_project import make_project

from alpine_core.cloud import CloudError, account, auth, billing, links, pro, publish
from alpine_core.cloud.publish import NotLinked


@pytest.fixture(autouse=True)
def quick_polls(monkeypatch):
    monkeypatch.setattr(publish, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(pro, "POLL_SECONDS", 0.01)


@pytest.fixture
def signed_in(cloud):
    auth.save(auth.verify_code("me@example.com", cloud.email_code))


class Heard:
    """The statuses ``cloud/changed`` would carry."""

    def __init__(self):
        self.statuses = []
        self._seen = threading.Event()
        self._unsubscribe = account.subscribe(self._on)

    def _on(self, status):
        self.statuses.append(status)
        self._seen.set()

    def wait(self, seconds=5):
        assert self._seen.wait(seconds), "nothing was announced"
        self._seen.clear()
        return self.statuses[-1]

    def stop(self):
        self._unsubscribe()


@pytest.fixture
def heard():
    h = Heard()
    yield h
    h.stop()


def browser(url):
    """A browser: opens the page, follows the redirects (to the loopback address the app listens on)."""
    with urllib.request.urlopen(url, timeout=5) as response:
        return response.read().decode()


def go_pro(cloud):
    billing.start_trial()
    assert cloud.plan["id"] == "pro"


# ---------------------------------------------------------------- plans, trial, payment


def test_plans_need_no_sign_in(cloud):
    found = billing.plans()
    assert [p["id"] for p in found["plans"]] == ["free", "pro"] and found["plans"][1]["trial_days"] == 7


def test_the_trial_starts_once_and_the_new_plan_is_announced(cloud, signed_in, heard):
    status = billing.start_trial()
    assert status.plan["id"] == "pro" and status.plan["status"] == "trialing" and status.limits["web_pro"] is True
    assert heard.wait().plan["status"] == "trialing"
    with pytest.raises(CloudError) as e:
        billing.start_trial()
    assert e.value.code == "conflict"


def test_checkout_returns_the_payment_page_and_waits_on_a_loopback_address(cloud, signed_in, heard):
    url = billing.checkout("pro")
    assert url.startswith(f"{cloud.url}/v1/billing/fake/checkout/")
    return_url = cloud.calls("POST", "/v1/billing/checkout")[0]["body"]["return_url"]
    assert return_url.startswith("http://127.0.0.1:") and return_url.endswith("/billing")
    assert "Pay (test)" in browser(url)  # the provider's page

    browser(url + "/pay")  # the person pays; the provider sends the browser back to return_url
    status = heard.wait()
    assert status.plan["id"] == "pro" and status.plan["status"] == "active"
    assert account.status().plan["id"] == "pro"
    # one visit and the listener is gone
    time.sleep(0.2)
    with pytest.raises(OSError):
        urllib.request.urlopen(return_url, timeout=1)


def test_cancelling_at_the_payment_page_still_comes_back_and_the_plan_stays(cloud, signed_in, heard):
    url = billing.checkout("pro")
    browser(url + "/cancel")
    assert heard.wait().plan["id"] == "free"


def test_a_stray_request_to_the_listener_is_not_the_return(cloud, signed_in, heard):
    billing.checkout("pro")
    return_url = cloud.calls("POST", "/v1/billing/checkout")[0]["body"]["return_url"]
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(return_url.replace("/billing", "/other"), timeout=2)
    assert e.value.code == 404
    assert not heard.statuses


def test_a_refused_checkout_leaves_no_listener_open(cloud, signed_in, monkeypatch):
    opened = []
    real = billing.CheckoutReturn.start

    def start(*args, **kwargs):
        opened.append(real(*args, **kwargs))
        return opened[-1]

    monkeypatch.setattr(billing.CheckoutReturn, "start", staticmethod(start))
    with pytest.raises(CloudError):
        billing.checkout("gold")
    assert opened and opened[0].closed


def test_the_portal_is_watched_and_cancelling_there_is_announced(cloud, signed_in, heard, monkeypatch):
    monkeypatch.setattr(billing, "WATCH_EVERY", 0.05)
    go_pro(cloud)
    heard.wait()
    url = billing.portal()
    assert "Cancel plan" in browser(url)
    browser(url + "/cancel")
    assert heard.wait().plan["id"] == "free"


def test_the_portal_has_nothing_to_manage_on_free(cloud, signed_in):
    with pytest.raises(CloudError) as e:
        billing.portal()
    assert e.value.code == "conflict"


# ---------------------------------------------------------------- the dev branch and the build values


def web_pro(tmp_path, cloud, **kwargs):
    """A web-pro project linked to a web-pro app (the account is on a trial)."""
    folder = make_project(tmp_path, kind="web-pro", **kwargs)
    app = publish._ensure_app(folder, "web-pro", account_client())
    assert links.get(folder).app_id == app.id
    return folder, app


def account_client():
    from alpine_core.cloud import AlpineTokens, CloudClient

    return CloudClient(AlpineTokens())


def test_a_web_pro_app_needs_pro(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path, kind="web-pro")
    with pytest.raises(CloudError) as e:
        publish._ensure_app(folder, "web-pro", account_client())
    assert e.value.code == "payment_required"


def test_the_dev_branch_is_made_and_its_values_written_privately(cloud, signed_in, tmp_path):
    go_pro(cloud)
    folder, app = web_pro(tmp_path, cloud)
    (folder / ".env.development.local").write_text("# mine\nOTHER=1\nVITE_SUPABASE_URL=old\n")
    assert pro.needs_dev_branch(folder)
    assert pro.ensure_dev_branch(folder) is True
    env = (folder / ".env.development.local").read_text().splitlines()
    assert env == [
        "# mine",
        "OTHER=1",
        "VITE_SUPABASE_URL=https://craft-booking-dev.db.test",
        "VITE_SUPABASE_ANON_KEY=anon-dev-craft-booking",
    ]
    assert stat.S_IMODE(os.stat(folder / ".env.development.local").st_mode) == 0o600
    assert not pro.needs_dev_branch(folder)
    # the branch was "creating" first and was asked again until it was ready
    assert len(cloud.calls("POST", f"/v1/apps/{app.id}/dev-branch")) == 1
    assert len(cloud.calls("GET", f"/v1/apps/{app.id}/dev-branch")) >= 2


def test_an_existing_branch_is_reused_not_made_twice(cloud, signed_in, tmp_path):
    go_pro(cloud)
    folder, app = web_pro(tmp_path, cloud)
    pro.ensure_dev_branch(folder)
    (folder / ".env.development.local").unlink()
    pro.ensure_dev_branch(folder)
    assert len(cloud.calls("POST", f"/v1/apps/{app.id}/dev-branch")) == 1
    assert (folder / ".env.development.local").is_file()


def test_other_projects_have_no_dev_branch(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)  # web-lite
    publish._ensure_app(folder, "web-lite", account_client())
    assert not pro.needs_dev_branch(folder) and pro.ensure_dev_branch(folder) is False
    assert pro.build_env(folder) == {} and not [r for r in cloud.requests if "dev-branch" in r["path"]]
    unlinked = make_project(tmp_path, name="other-one", kind="web-pro")
    assert not pro.needs_dev_branch(unlinked)


def test_the_branch_and_its_values_go_after_a_publish_and_come_back_for_the_next_session(cloud, signed_in, tmp_path):
    go_pro(cloud)
    folder, app = web_pro(tmp_path, cloud)
    (folder / ".env.development.local").write_text("OTHER=1\n")
    pro.ensure_dev_branch(folder)
    plan = publish.prepare(folder, progress=lambda *a: None)
    publish.run(folder, plan.deploy_id, [], progress=lambda *a: None)
    assert cloud.deleted_branches and app.id not in cloud.branches
    assert (folder / ".env.development.local").read_text() == "OTHER=1\n"
    assert pro.needs_dev_branch(folder)
    pro.ensure_dev_branch(folder)
    assert len(cloud.calls("POST", f"/v1/apps/{app.id}/dev-branch")) == 2


def test_the_env_file_is_removed_when_the_branch_values_were_all_it_had(cloud, signed_in, tmp_path):
    go_pro(cloud)
    folder, _ = web_pro(tmp_path, cloud)
    pro.ensure_dev_branch(folder)
    pro.delete_dev_branch(folder)
    assert not (folder / ".env.development.local").exists()


def test_the_build_gets_the_live_database_values_in_its_environment_only(cloud, signed_in, tmp_path):
    go_pro(cloud)
    command = "echo $VITE_SUPABASE_URL $VITE_SUPABASE_ANON_KEY > seen.txt"
    folder, app = web_pro(tmp_path, cloud, command=command)
    messages = []
    plan = publish.prepare(folder, progress=lambda phase, p, message, checks: messages.append(message))
    assert plan.deploy_id
    assert (folder / "seen.txt").read_text().split() == ["https://craft-booking.db.test", "anon-live-craft-booking"]
    assert len(cloud.calls("GET", f"/v1/apps/{app.id}/build-env")) == 1
    assert "VITE_SUPABASE_URL" not in os.environ and not (folder / ".env.development.local").exists()
    assert not any("anon-live" in (m or "") for m in messages)


def test_a_web_lite_build_asks_for_no_values(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path, command="echo $VITE_SUPABASE_URL > seen.txt")
    publish.prepare(folder, progress=lambda *a: None)
    assert (folder / "seen.txt").read_text().strip() == "" and not [
        r for r in cloud.requests if "build-env" in r["path"]
    ]


# ---------------------------------------------------------------- domains and the badge


def linked(tmp_path, cloud):
    folder = make_project(tmp_path)
    publish._ensure_app(folder, "web-lite", account_client())
    return folder


def test_custom_domains_are_a_pro_feature(cloud, signed_in, tmp_path):
    folder = linked(tmp_path, cloud)
    with pytest.raises(CloudError) as e:
        pro.add_domain(folder, "example.com", True)
    assert e.value.code == "payment_required"
    with pytest.raises(NotLinked):
        pro.domains(tmp_path)


def test_a_domain_is_added_checked_until_active_and_removed(cloud, signed_in, tmp_path):
    go_pro(cloud)
    folder = linked(tmp_path, cloud)
    added = pro.add_domain(folder, "craft.example.com", True)
    assert added["status"] == "pending" and [r["purpose"] for r in added["records"]] == [
        "web", "web", "spf", "dkim", "dmarc",
    ]  # fmt: skip
    assert cloud.calls("POST", f"/v1/apps/{linked_id(cloud)}/domains")[0]["body"] == {
        "domain": "craft.example.com",
        "mail": True,
    }
    assert pro.check_domain(folder, added["id"])["status"] == "pending"
    cloud.dns_ready = True
    checked = pro.check_domain(folder, added["id"])
    assert checked["status"] == "active" and all(r["ok"] for r in checked["records"])
    assert [d["name"] for d in pro.domains(folder)] == ["craft.example.com"]
    pro.remove_domain(folder, added["id"])
    assert pro.domains(folder) == []
    with pytest.raises(CloudError) as e:
        pro.check_domain(folder, added["id"])
    assert e.value.code == "not_found"


def test_a_web_only_domain_has_no_mail_records(cloud, signed_in, tmp_path):
    go_pro(cloud)
    added = pro.add_domain(linked(tmp_path, cloud), "craft.example.com", False)
    assert {r["purpose"] for r in added["records"]} == {"web"}


def test_a_bad_domain_name_is_invalid(cloud, signed_in, tmp_path):
    go_pro(cloud)
    with pytest.raises(CloudError) as e:
        pro.add_domain(linked(tmp_path, cloud), "not a domain", False)
    assert e.value.code == "invalid"


def test_taking_the_badge_off_is_402_on_free_and_works_on_pro(cloud, signed_in, tmp_path):
    folder = linked(tmp_path, cloud)
    assert pro.set_badge(folder, True).badge is True
    with pytest.raises(CloudError) as e:
        pro.set_badge(folder, False)
    assert e.value.status == 402 and e.value.code == "payment_required"
    go_pro(cloud)
    assert pro.set_badge(folder, False).badge is False
    assert pro.set_badge(folder, True).badge is True


def linked_id(cloud):
    return next(iter(cloud.apps))
