from alpine_core.home import home_dir
from alpine_core.prompt import build_system_prompt, instruction_files


def test_agents_md_is_preferred_and_collected_from_git_root(tmp_path):
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


def test_every_source_is_labelled_with_what_it_is_for(tmp_path):
    (tmp_path / ".git").mkdir()
    (tmp_path / "AGENTS.md").write_text("root rules")
    home_dir().mkdir(parents=True, exist_ok=True)
    (home_dir() / "AGENTS.md").write_text("my rules")
    prompt = build_system_prompt(tmp_path)
    assert (
        f"# Instructions from {home_dir() / 'AGENTS.md'}\nThe user's own rules for every project.\n\nmy rules" in prompt
    )
    purpose = "The project's working rules, for whoever works in it."
    assert f"# Instructions from {tmp_path / 'AGENTS.md'}\n{purpose}\n\nroot rules" in prompt


def test_agent_instructions_come_after_project_files_and_before_memory(tmp_path):
    (tmp_path / "AGENTS.md").write_text("root rules")
    prompt = build_system_prompt(tmp_path, "# Memory\nremember", "  Only comment.  ")
    block = "# Instructions for this agent\nThe role and way of working the user gave this agent.\n\nOnly comment.\n"
    assert block in prompt
    assert prompt.index("root rules") < prompt.index(block) < prompt.index("# Memory")
    assert "win" not in prompt.split("# Instructions for this agent")[1].lower()


def test_no_agent_block_without_instructions(tmp_path):
    assert "Instructions for this agent" not in build_system_prompt(tmp_path, "", "  \n")
