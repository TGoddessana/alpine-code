<h1 align="center">Alpine Code</h1>

<p align="center">
  <b>Tell it what you want changed. It does the work on your computer, and shows you what it did.</b>
</p>

<p align="center">
  <a href="https://github.com/TGoddessana/alpine-code/releases/latest"><b>Download for Mac</b></a>
&nbsp;·&nbsp;
  <a href="#use-it-from-the-terminal">Terminal version</a>
&nbsp;·&nbsp;
  <a href="LICENSE">MIT license</a>
</p>

<p align="center">
  <img src="docs/images/demo.gif" alt="Alpine Code at work: asked to make a bakery website's menu page fit on a phone, it reads two files, asks before editing the stylesheet and before running the build, then reports what changed. The work result panel fills in as it goes" width="900">
</p>

Alpine Code is an AI agent for the projects on your computer: a website, an app, a folder of files. You open a folder,
say what you want in plain words, and it reads the files, makes the changes and checks that they work. You don't need to
know how to code to use it, and if you do, it stays out of your way.

## What it's like

**You ask the way you'd ask a person.** "Make the menu page look good on a phone." "Explain what this project is,
simply." "Check that it still runs." It works out which files matter and what to change. Not sure where to start? A new
session suggests a few things to try.

<p align="center">
  <img src="docs/images/start.png" alt="A new session in the bakery-site folder: 'What shall we build?' with four suggestions, such as 'Make the screen look good on a phone'" width="800">
</p>

**Nothing changes without your OK.** It reads freely inside the folder you opened. Before it changes a file or runs a
command, it shows you what it wants to do and waits: **Allow**, **Always allow**, or **Skip** and tell it what to do
instead. A project that needs you is marked in the list, so you can leave it working and come back.

<p align="center">
  <img src="docs/images/approval.png" alt="Alpine Code asking before it edits menu.css: the change line by line, with Allow, Always allow and Skip, and 'Needs your OK' next to the session in the list" width="800">
</p>

**You always see what it did.** The work result panel lists every file it changed, line by line, and every command it
ran. When it's done, it tells you what changed and whether it checked that it works.

**No word left unexplained.** Where a technical word can't be avoided, Alpine Code says what it means. Click the memory
meter to see how much of the conversation the model is keeping in mind, and what the chat has cost so far.

<table>
  <tr>
    <td width="50%" valign="top"><img src="docs/images/work-result.png" alt="The work result panel with menu.css opened: removed lines in red, added lines in green, and the build command it ran"></td>
    <td width="50%" valign="top"><img src="docs/images/memory.png" alt="The memory popover: 12% of the model's memory used, explained in plain words, with tokens sent and received, requests and cost"></td>
  </tr>
  <tr>
    <td align="center">Every change, line by line</td>
    <td align="center">Memory and cost, in plain words</td>
  </tr>
</table>

**Your work stays where it is.** Alpine Code works on your own folders, not a copy in the cloud. Your conversations are
saved on your computer, so you can come back to them, one list per project.

## Get started

1. **Download** Alpine Code from the [latest release](https://github.com/TGoddessana/alpine-code/releases/latest)
   (`Alpine Code_…_aarch64.dmg`), open it and drag Alpine Code into Applications.
2. **Connect a model.** Alpine Code asks the first time you open it.
3. **Open a folder** and say what you'd like to do.

Alpine Code runs on Macs with Apple silicon (M1 or later) and macOS 11 or later. It updates itself: a new version
downloads in the background and is installed when you quit. Windows is coming.

## Connect a model

Alpine Code works with the AI model you choose. Pick whichever you already have:

- **Your ChatGPT plan.** Sign in with ChatGPT to use your Plus or Pro plan. No API key, no separate bill.
- **An API key** from Anthropic (Claude), OpenAI, Google Gemini or OpenRouter, billed by what you use. Coding plans work
  too: GLM Coding Plan, Kimi For Coding and MiniMax Coding Plan.
- **A model on your own computer** through Ollama, LM Studio or vLLM. Free, and nothing leaves your machine. Any other
  server that speaks the OpenAI API works too.

You can connect several and switch models in the middle of a conversation without losing it.

Claude's Pro and Max plans can't be used in other apps, so Claude models connect with an API key.

<p align="center">
  <img src="docs/images/connect-a-model.png" alt="The Connect a model dialog: Sign in with ChatGPT, API key, or a local or compatible server" width="560">
</p>

## Make it yours

**Teach it new tools.** In Settings › Tools you can write a tool as a single Python function, and it's ready to use from
then on. Packages the tool needs are installed for you.

**Different setups for different work.** Tool profiles choose which tools are on for a project or a model.

**Project notes.** If a folder has an `AGENTS.md` (or `CLAUDE.md`) file, Alpine Code reads it before it starts, so you
can write down how the project works once instead of repeating it.

## Your data

Alpine Code has no account and no server of its own, and it sends us nothing. What you ask goes straight from your
computer to the model you connected. API keys are saved only on your computer, in `~/.alpine-code`, readable only by
you.

## Use it from the terminal

The same agent runs in a terminal, for people who live there. With [uv](https://docs.astral.sh/uv/):

```sh
uv tool install alpine-code
alpine
```

Keys, commands and settings are in the [terminal guide](apps/cli/README.md).

## Questions and feedback

Found a bug or have an idea? [Open an issue](https://github.com/TGoddessana/alpine-code/issues). Alpine Code is built on
[alpineagents](https://tgoddessana.github.io/alpineagents/) and is open source under the [MIT license](LICENSE).
