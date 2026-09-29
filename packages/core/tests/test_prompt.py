from alpine_core.prompt import build_system_prompt, instruction_files


def test_agents_md_is_preferred_and_collected_from_git_root(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    (tmp_path / ".git").mkdir()
    (tmp_path / "AGENTS.md").write_text("root rules")
    sub = tmp_path / "pkg"
    sub.mkdir()
    (sub / "CLAUDE.md").write_text("pkg rules")
    (tmp_path / "CLAUDE.md").write_text("ignored, AGENTS.md wins")

    assert instruction_files(sub) == [tmp_path / "AGENTS.md", sub / "CLAUDE.md"]
    prompt = build_system_prompt(sub)
    assert "alpine-code" in prompt and "root rules" in prompt and "pkg rules" in prompt
    assert "ignored" not in prompt
    assert prompt.index("root rules") < prompt.index("pkg rules")
