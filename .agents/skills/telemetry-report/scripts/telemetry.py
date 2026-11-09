#!/usr/bin/env python3
# Token budget: ~0 (executed by the telemetry-report skill, never loaded
# into model context; reading this file costs ~6,000 tokens).
"""Agent telemetry for a CFD project: local dashboard + publishable report.

Reads the session logs that coding agents already keep on this machine,
keeps only counters (never prompts, responses or code), and writes one
self-contained HTML file. No server, no dependencies.

Usage:
  telemetry.py [project-dir] [--open]            build the local dashboard
  telemetry.py [project-dir] --publish           also commit the monthly
                                                 reports to the local
                                                 `cfd-telemetry` branch
  telemetry.py [project-dir] --publish --push    and push that branch

Adapters (add one function to ADAPTERS to support another agent):
  Claude Code  ~/.claude/projects/<slug>/**/*.jsonl   (CLAUDE_CONFIG_DIR)
  Codex        ~/.codex/sessions/**/rollout-*.jsonl[.zst]   (CODEX_HOME)

These log formats are undocumented and change between agent versions.
Every adapter counts what it could not read and the dashboard prints
those counts, so a format change shows up as a number, not as silence.

Agents delete their own logs (Claude Code after 30 days by default). Each
run therefore folds the sessions it can read into a history file next to
the output (index.history.json) and reports from that. Run it at least
once a month, or history is lost.

Publishing writes reports/<developer>/<YYYY-MM>.json on an orphan branch,
through git plumbing: the checkout and the index are never touched. The
developer is the git identity (user.email), so a task shared by several
people adds up per person and per agent. A public repository is refused:
the branch would expose that to everyone. The schema is documented in
../references/report-schema.md.

Token vocabulary (normalized across agents):
  output      tokens the model wrote (reasoning included)
  fresh input uncached input + cache writes: context processed for the
              first time
  cache read  context re-read from the provider cache on each request
"""

import argparse
import collections
import datetime as dt
import glob
import json
import os
import re
import secrets
import shutil
import statistics
import subprocess
import sys
import tempfile
import webbrowser

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
IDLE_CAP_S = 300  # gaps longer than this do not count as active time
REPORT_SCHEMA = "cfd-telemetry/1"
BRANCH = "cfd-telemetry"
CONTEXT_PATHS = [
    "CLAUDE.md", "AGENTS.md", "docs/decisions", "docs/CONVENTIONS.md",
    "docs/ARCHITECTURE.md", "docs/STACK.md", ".agents/skills",
    ".claude/hooks", ".claude/settings.json",
]


def parse_ts(value):
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone()
    except (AttributeError, ValueError):
        return None


def under(path, project):
    return bool(path) and (path == project or path.startswith(project + os.sep))


class Session:
    def __init__(self, agent, sid):
        self.agent, self.sid = agent, sid
        self.requests = []          # dicts: ts branch model i o r w skill sub
        self.marks = []             # every timestamp seen, for active time
        self.turns = 0
        self.first_edit = None


# ---------------------------------------------------------------- Claude Code

def read_claude(project, health):
    home = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    slug = re.sub(r"[^A-Za-z0-9]", "-", project)
    sessions = {}
    for folder in sorted(glob.glob(os.path.join(home, "projects", slug + "*"))):
        for path in glob.glob(os.path.join(folder, "**", "*.jsonl"), recursive=True):
            read_claude_file(path, folder, project, sessions, health)
    return list(sessions.values())


def read_claude_file(path, folder, project, sessions, health):
    rel = os.path.relpath(path, folder).split(os.sep)
    is_sub = len(rel) > 1
    sid = rel[0][:-6] if not is_sub else rel[0]
    reqs = {}
    checked = False
    health["claude_files"] += 1
    with open(path, errors="replace") as fh:
        for line in fh:
            if '"assistant"' not in line and '"user"' not in line:
                continue
            try:
                o = json.loads(line)
            except ValueError:
                health["claude_bad_lines"] += 1
                continue
            kind = o.get("type")
            if kind not in ("assistant", "user"):
                continue
            if not under(o.get("cwd"), project):
                if not checked:      # session belongs to a sibling project
                    health["claude_files"] -= 1
                    return
                continue
            checked = True
            ts = parse_ts(o.get("timestamp"))
            if ts is None:
                health["claude_bad_lines"] += 1
                continue
            s = sessions.setdefault(sid, Session("claude", sid))
            s.marks.append(ts)
            msg = o.get("message") or {}
            content = msg.get("content")
            blocks = [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
            if kind == "user":
                is_tool = any(b.get("type") == "tool_result" for b in blocks)
                if not (o.get("isMeta") or o.get("isSidechain") or is_sub or is_tool):
                    s.turns += 1
                continue
            if msg.get("model") in (None, "<synthetic>"):
                continue
            usage = msg.get("usage")
            if not isinstance(usage, dict):
                health["claude_no_usage"] += 1
                continue
            key = (msg.get("id") or o.get("uuid"), o.get("requestId"))
            r = reqs.get(key)
            if r is None:
                r = reqs[key] = {
                    "ts": ts, "branch": o.get("gitBranch") or "", "model": msg.get("model"),
                    "i": 0, "o": 0, "r": 0, "w": 0,
                    "skill": o.get("attributionSkill") or "",
                    "sub": bool(is_sub or o.get("isSidechain")),
                }
            else:                    # one request is logged once per content block
                health["claude_dup_lines"] += 1
            for field, name in (("i", "input_tokens"), ("o", "output_tokens"),
                                ("r", "cache_read_input_tokens"),
                                ("w", "cache_creation_input_tokens")):
                r[field] = max(r[field], usage.get(name) or 0)
            if any(b.get("type") == "tool_use" and b.get("name") in EDIT_TOOLS for b in blocks):
                if s.first_edit is None or ts < s.first_edit:
                    s.first_edit = ts
    if reqs:
        sessions[sid].requests.extend(reqs.values())


# ----------------------------------------------------------------------- Codex

def open_codex(path, health):
    if not path.endswith(".zst"):
        return open(path, errors="replace"), None
    if not shutil.which("zstd"):
        health["codex_zst_skipped"] += 1
        return None, None
    proc = subprocess.Popen(["zstd", "-dc", path], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, errors="replace")
    return proc.stdout, proc


def read_codex(project, health):
    home = os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")
    sessions = []
    for path in sorted(glob.glob(os.path.join(home, "sessions", "**", "rollout-*"), recursive=True)):
        if not path.endswith((".jsonl", ".jsonl.zst")):
            continue
        fh, proc = open_codex(path, health)
        if fh is None:
            continue
        try:
            s = read_codex_file(fh, project, health)
        finally:
            fh.close()
            if proc:
                proc.kill()
                proc.wait()
        if s and s.requests:
            sessions.append(s)
    return sessions


def read_codex_file(fh, project, health):
    s, branch, model, prev_total = None, "", "", None
    for n, line in enumerate(fh):
        try:
            o = json.loads(line)
        except ValueError:
            health["codex_bad_lines"] += 1
            continue
        kind, p = o.get("type"), o.get("payload")
        if not isinstance(p, dict):
            continue
        if s is None:
            if kind != "session_meta":
                if n > 5:
                    health["codex_unknown_files"] += 1
                    return None
                continue
            if not under(p.get("cwd"), project):
                return None
            health["codex_files"] += 1
            s = Session("codex", p.get("id") or p.get("session_id") or "?")
            git = p.get("git")
            branch = git.get("branch") or "" if isinstance(git, dict) else ""
            continue
        ts = parse_ts(o.get("timestamp"))
        if ts is None:
            continue
        s.marks.append(ts)
        ptype = p.get("type")
        if kind == "turn_context":
            model = p.get("model") or model
        elif kind == "event_msg" and ptype == "task_started":
            s.turns += 1
        elif kind == "response_item" and ptype in ("custom_tool_call", "function_call"):
            body = p.get("input") if ptype == "custom_tool_call" else p.get("arguments")
            if p.get("name") == "apply_patch" or "apply_patch" in str(body or ""):
                s.first_edit = s.first_edit or ts
        elif kind == "event_msg" and ptype == "token_count":
            info = p.get("info")
            if not isinstance(info, dict):
                continue
            total = (info.get("total_token_usage") or {}).get("total_tokens")
            if total == prev_total:  # rate-limit refreshes repeat the same count
                continue
            prev_total = total
            last = info.get("last_token_usage") or {}
            cached = last.get("cached_input_tokens") or 0
            written = last.get("cache_write_input_tokens") or 0
            s.requests.append({
                "ts": ts, "branch": branch, "model": model,
                "i": max((last.get("input_tokens") or 0) - cached - written, 0),
                "o": last.get("output_tokens") or 0, "r": cached, "w": written,
                "skill": "", "sub": False,
            })
    return s


ADAPTERS = [("claude", read_claude), ("codex", read_codex)]


# ------------------------------------------------------------------ aggregation

def context_changes(project, paths):
    try:
        out = subprocess.run(
            ["git", "-C", project, "log", "--format=%h%x09%aI%x09%s", "--"] + paths,
            capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    changes = []
    for line in out.splitlines():
        sha, when, subject = (line.split("\t", 2) + ["", ""])[:3]
        ts = parse_ts(when)
        if ts:
            changes.append({"d": ts.date().isoformat(), "sha": sha, "subject": subject})
    return changes


def active_seconds(marks):
    return sum(min((b - a).total_seconds(), IDLE_CAP_S) for a, b in zip(marks, marks[1:]))


def summarize(sessions):
    """One self-contained record per session: its row, day buckets and skill runs."""
    records = {}
    for s in sessions:
        if not s.requests:
            continue
        reqs = sorted(s.requests, key=lambda r: r["ts"])
        marks = sorted(s.marks) or [reqs[0]["ts"]]
        main = [r for r in reqs if not r["sub"]] or reqs
        ctx = [r["i"] + r["r"] + r["w"] for r in main]
        before = [r for r in reqs if s.first_edit and r["ts"] < s.first_edit]
        row = {
            "id": s.sid[:8], "a": s.agent, "start": marks[0].strftime("%Y-%m-%d %H:%M"),
            "d": marks[0].date().isoformat(), "active": round(active_seconds(marks) / 60),
            "turns": s.turns, "n": len(reqs), "sub": sum(1 for r in reqs if r["sub"]),
            "models": sorted({r["model"] for r in reqs if r["model"]}),
            "branches": list(dict.fromkeys(r["branch"] for r in reqs if r["branch"])),
            "o": sum(r["o"] for r in reqs), "f": sum(r["i"] + r["w"] for r in reqs),
            "r": sum(r["r"] for r in reqs),
            "ctx0": ctx[0], "ctxmax": max(ctx),
            "edit_min": round(active_seconds([m for m in marks if m <= s.first_edit]) / 60, 1)
                        if s.first_edit else None,
            "orient": sum(r["o"] + r["i"] + r["w"] for r in before) if s.first_edit else None,
        }
        buckets, runs, run = collections.defaultdict(lambda: [0, 0, 0, 0, 0]), [], None
        for r in reqs:
            day = r["ts"].date().isoformat()
            b = buckets[(day, r["branch"])]
            b[0] += 1; b[1] += r["i"]; b[2] += r["o"]; b[3] += r["r"]; b[4] += r["w"]
            if r["skill"] and run and run["k"] == r["skill"]:
                run["n"] += 1; run["o"] += r["o"]; run["f"] += r["i"] + r["w"]; run["r"] += r["r"]
            elif r["skill"]:
                run = {"d": day, "a": s.agent, "k": r["skill"], "n": 1, "o": r["o"],
                       "f": r["i"] + r["w"], "r": r["r"]}
                runs.append(run)
            else:
                run = None
        records[s.agent + ":" + s.sid] = {
            "row": row, "runs": runs,
            "buckets": [{"d": k[0], "b": k[1], "n": v[0], "i": v[1], "o": v[2], "r": v[3], "w": v[4]}
                        for k, v in sorted(buckets.items())],
        }
    return records


def merge_history(path, fresh, health):
    """Agents delete old logs (Claude Code after 30 days by default), so every
    run folds what is readable now into a local history file and reports from
    that. A session still on disk always replaces its stored copy."""
    stored = {}
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                stored = json.load(fh)["sessions"]
        except (OSError, ValueError, KeyError, TypeError):
            sys.exit("✗ Cannot read " + path + ". Move it away to start a new history.")
    health["history_only_sessions"] = sum(1 for key in stored if key not in fresh)
    stored.update(fresh)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"version": 1, "sessions": stored}, fh, separators=(",", ":"))
    os.replace(tmp, path)
    return stored


def flatten(records):
    rows, buckets, runs = [], [], []
    for idx, rec in enumerate(sorted(records.values(), key=lambda rec: rec["row"]["start"])):
        rows.append(rec["row"])
        buckets.extend(dict(b, a=rec["row"]["a"], s=idx) for b in rec["buckets"])
        runs.extend(rec["runs"])
    return rows, buckets, runs


# ------------------------------------------------------------------- publishing

def git(project, *args, env=None, stdin=None, check=True):
    done = subprocess.run(["git", "-C", project] + list(args), capture_output=True,
                          text=True, env=env, input=stdin)
    if check and done.returncode:
        raise RuntimeError("git " + " ".join(args) + ": " + done.stderr.strip())
    return done.stdout.strip() if done.returncode == 0 else ""


def repo_identity(project):
    url = git(project, "config", "--get", "remote.origin.url", check=False)
    found = re.match(r"(?:\w+://)?(?:[^@/]+@)?([^:/]+)[:/](.+?)(?:\.git)?/?$", url)
    if not found:
        return os.path.basename(project)
    return found.group(1) + "/" + re.sub(r"^\d+/", "", found.group(2))   # drop an ssh port


def repo_visibility(project):
    """PUBLIC / PRIVATE / INTERNAL as the forge reports it, or "" when unknown."""
    if not shutil.which("gh"):
        return ""
    try:
        done = subprocess.run(["gh", "repo", "view", "--json", "visibility", "-q", ".visibility"],
                              cwd=project, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return ""
    return done.stdout.strip().upper() if done.returncode == 0 else ""


def developer_identity(project, state_dir, anonymous):
    """The git identity by default: it is what already signs the work, and it
    lets a shared task add up per person. --anonymous swaps it for a random id
    kept on this machine only."""
    if anonymous:
        path = os.path.join(state_dir, "developer-id")
        if not os.path.exists(path):
            with open(path, "w") as fh:
                fh.write("anon-" + secrets.token_hex(5))
        with open(path) as fh:
            return {"id": fh.read().strip(), "name": "", "email": ""}
    email = git(project, "config", "user.email", check=False)
    if not email:
        sys.exit("✗ git user.email is not set. Set it, or publish with --anonymous.")
    return {"id": email.lower(), "name": git(project, "config", "user.name", check=False),
            "email": email.lower()}


def build_reports(records, repo, developer, agents, health):
    """One file per developer and month. No timestamps inside a month file:
    an unchanged month must produce an identical blob, hence no commit."""
    folder = "reports/" + re.sub(r"[^A-Za-z0-9._@-]", "_", developer["id"]) + "/"
    months = collections.defaultdict(dict)
    for key, rec in records.items():
        row = dict(rec["row"], start=rec["row"]["d"])   # the day, never the time of day
        months[row["d"][:7]][key] = dict(rec, row=row)
    files = {folder + month + ".json": {
        "schema": REPORT_SCHEMA, "repo": repo, "developer": developer, "month": month,
        "sessions": sessions} for month, sessions in months.items()}
    days = sorted(rec["row"]["d"] for rec in records.values())
    status = {"schema": REPORT_SCHEMA, "repo": repo, "developer": developer,
              "updated": dt.date.today().isoformat(), "agents": agents,
              "first_day": days[0] if days else None, "last_day": days[-1] if days else None,
              "sessions": len(records), "health": dict(health)}
    return files, folder + "status.json", status


def publish(project, files, status_path, status, anonymous, push):
    """Commit the reports on BRANCH without touching the checkout. Returns a summary."""
    if git(project, "rev-parse", "--is-inside-work-tree", check=False) != "true":
        sys.exit("✗ --publish needs a git repository: " + project)
    has_origin = "origin" in git(project, "remote", check=False).split()
    env = dict(os.environ)
    if anonymous:                    # the commit must not name the person either
        for who in ("AUTHOR", "COMMITTER"):
            env["GIT_" + who + "_NAME"] = "cfd-telemetry"
            env["GIT_" + who + "_EMAIL"] = "cfd-telemetry@users.noreply.invalid"
    tmp = tempfile.mkdtemp(prefix="cfd-telemetry-")
    env["GIT_INDEX_FILE"] = os.path.join(tmp, "index")
    try:
        for attempt in (1, 2):
            if has_origin:
                git(project, "fetch", "--quiet", "origin",
                    "+refs/heads/%s:refs/remotes/origin/%s" % (BRANCH, BRANCH), check=False)
            local = git(project, "rev-parse", "--verify", "--quiet", "refs/heads/" + BRANCH, check=False)
            remote = git(project, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + BRANCH, check=False)
            parent = remote or local
            if local and remote and subprocess.run(
                    ["git", "-C", project, "merge-base", "--is-ancestor", remote, local]).returncode == 0:
                parent = local       # local already contains everything on the remote
            if os.path.exists(env["GIT_INDEX_FILE"]):
                os.remove(env["GIT_INDEX_FILE"])
            if parent:
                git(project, "read-tree", parent, env=env)
            merged = 0
            for path, report in sorted(files.items()):
                # Same person, another machine: keep the sessions only that one saw.
                before = git(project, "show", parent + ":" + path, check=False) if parent else ""
                if before:
                    try:
                        theirs = json.loads(before)["sessions"]
                        merged += sum(1 for key in theirs if key not in report["sessions"])
                        report = dict(report, sessions=dict(theirs, **report["sessions"]))
                    except (ValueError, KeyError, TypeError):
                        pass
                add_blob(project, env, path, report)
            add_blob(project, env, status_path, status)
            tree = git(project, "write-tree", env=env)
            # status.json carries today's date: a publish with no new session
            # still commits once a day, which is the heartbeat a reader needs
            # to tell "no activity" from "never reported".
            unchanged = bool(parent) and tree == git(project, "rev-parse", parent + "^{tree}")
            if not unchanged:
                args = ["commit-tree", tree, "-m", "telemetry: %s %s" % (status["developer"]["id"], status["updated"])]
                if parent:
                    args += ["-p", parent]
                if anonymous:
                    args.insert(1, "--no-gpg-sign")
                parent = git(project, *args, env=env)
            git(project, "update-ref", "refs/heads/" + BRANCH, parent)
            if not push:
                return {"commit": parent, "changed": not unchanged, "merged": merged, "pushed": False}
            if not has_origin:
                sys.exit("✗ --push needs a remote named origin.")
            done = subprocess.run(["git", "-C", project, "push", "--quiet", "origin",
                                   "refs/heads/%s:refs/heads/%s" % (BRANCH, BRANCH)],
                                  capture_output=True, text=True)
            if done.returncode == 0:
                return {"commit": parent, "changed": not unchanged, "merged": merged, "pushed": True}
            if attempt == 2:         # someone else pushed twice in a row, or no permission
                sys.exit("✗ Could not push " + BRANCH + ": " + done.stderr.strip())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def add_blob(project, env, path, obj):
    text = json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n"
    blob = git(project, "hash-object", "-w", "--stdin", stdin=text)
    git(project, "update-index", "--add", "--cacheinfo", "100644," + blob + "," + path, env=env)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("project", nargs="?", default=".")
    ap.add_argument("--out", help="output HTML (default: <project>/.cfd/telemetry/index.html)")
    ap.add_argument("--open", action="store_true", help="open the dashboard in the browser")
    ap.add_argument("--context-path", action="append",
                    help="path whose commits count as context changes (repeatable)")
    ap.add_argument("--publish", action="store_true",
                    help="commit monthly counters-only reports to the local %s branch" % BRANCH)
    ap.add_argument("--push", action="store_true", help="with --publish: push that branch to origin")
    ap.add_argument("--anonymous", action="store_true",
                    help="with --publish: a random id instead of the git identity")
    ap.add_argument("--allow-public", action="store_true",
                    help="with --publish: proceed even though the repository is public")
    args = ap.parse_args()

    project = os.path.realpath(args.project)
    if not os.path.isdir(project):
        sys.exit("✗ Not a directory: " + project)
    health = collections.Counter()
    out = args.out or os.path.join(project, ".cfd", "telemetry", "index.html")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    fresh = summarize([s for _, read in ADAPTERS for s in read(project, health)])
    records = merge_history(os.path.splitext(out)[0] + ".history.json", fresh, health)
    rows, buckets, runs = flatten(records)
    agents = [name for name, _ in ADAPTERS if any(r["a"] == name for r in rows)]
    data = {
        "project": os.path.basename(project),
        "generated": dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z"),
        "today": dt.date.today().isoformat(),
        "agents": agents,
        "sessions": rows, "buckets": buckets, "runs": runs,
        "changes": context_changes(project, args.context_path or CONTEXT_PATHS),
        "health": dict(health),
    }

    template = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard.html")
    with open(template, encoding="utf-8") as fh:
        html = fh.read()
    payload = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html.replace("__DATA__", payload))

    print("Project   " + project)
    for agent, _ in ADAPTERS:
        mine = [r for r in rows if r["a"] == agent]
        print("%-9s %3d sessions  %6d requests  %12s output tokens" % (
            agent, len(mine), sum(r["n"] for r in mine), format(sum(r["o"] for r in mine), ",")))
    if rows:
        print("Median context at first request: " + format(
            int(statistics.median(r["ctx0"] for r in rows)), ","))
    for key in sorted(health):
        if not key.endswith("_files") and health[key]:
            print("  note  %-22s %d" % (key, health[key]))
    print("Wrote     " + out)
    if not args.out and subprocess.run(["git", "-C", project, "check-ignore", "-q", out],
                                       capture_output=True).returncode != 0:
        print("⚠ " + os.path.relpath(out, project) + " is not git-ignored. "
              "Add `.cfd/` to .gitignore: this file is per-developer.")
    if args.publish or args.push:
        visibility = repo_visibility(project)
        if visibility == "PUBLIC" and not args.allow_public:
            sys.exit("✗ This repository is PUBLIC. A telemetry branch here would show per-person usage "
                     "and git identities to everyone, so nothing was committed or pushed. Publish from "
                     "private repositories; --allow-public overrides this (pair it with --anonymous).")
        if not visibility:
            print("⚠ Could not tell whether this repository is public (no `gh`, or not a GitHub repo). "
                  "Confirm it is private before pushing.")
        developer = developer_identity(project, os.path.dirname(os.path.abspath(out)), args.anonymous)
        files, status_path, status = build_reports(records, repo_identity(project), developer, agents, health)
        done = publish(project, files, status_path, status, args.anonymous, args.push)
        print("Published %d sessions in %d monthly reports as %s on branch %s (%s)" % (
            len(records), len(files), developer["id"], BRANCH, done["commit"][:8]))
        print("  " + ("new commit" if done["changed"] else "nothing new since the last publish")
              + (", kept %d sessions from another machine" % done["merged"] if done["merged"] else "")
              + (", pushed to origin" if done["pushed"] else ", not pushed (add --push)"))
    if args.open:
        webbrowser.open("file://" + os.path.abspath(out))


if __name__ == "__main__":
    main()
