#!/usr/bin/env python3
# Token budget: ~0 (executed by the telemetry-report skill, never loaded
# into model context; reading this file costs ~3,500 tokens).
"""Team view of agent telemetry: reads the `cfd-telemetry` branch of one or
more repositories and renders the same dashboard as telemetry.py, with the
repository and the contributor as filters.

Usage:
  central.py REPO [REPO ...] [--config FILE] [--out PATH] [--stale-days N] [--open]

REPO is a local clone or a git URL. A local clone is read from its
origin/cfd-telemetry (fetched first) or, failing that, its local branch.
A URL is cloned once, bare and without file contents, next to the output,
and fetched on every later run. --config names a file with one REPO per
line (# comments allowed).

What the page shows follows adrs/ai-workflow/agent-telemetry-from-local-logs.md:
a contributor filter beside the agent filter, never a ranking of people;
a contributor whose last report is older than --stale-days is listed as
not reporting, which is different from zero usage. Only counters are read:
the reports hold nothing else.
"""

import argparse
import collections
import datetime as dt
import json
import os
import re
import subprocess
import sys
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import telemetry  # noqa: E402  (same folder: shared schema, git and context helpers)

KNOWN_MAJOR = telemetry.REPORT_SCHEMA.rsplit("/", 1)[1].split(".")[0]
REPORT_PATH = re.compile(r"^reports/([^/]+)/(\d{4}-\d{2}|status)\.json$")


def git(path, *args):
    done = subprocess.run(["git", "-C", path] + list(args), capture_output=True, text=True)
    return done.stdout if done.returncode == 0 else None


def is_url(repo):
    return bool(re.match(r"^(\w+://|[^/@]+@[^:]+:)", repo))


def open_repo(repo, cache, health):
    """Return (git dir to read, ref of the telemetry branch, label) or None."""
    if is_url(repo):
        slug = re.sub(r"[^A-Za-z0-9._-]+", "_", re.sub(r"^\w+://", "", repo)).strip("_")
        path = os.path.join(cache, slug + ".git")
        if not os.path.isdir(path):
            done = subprocess.run(["git", "clone", "--quiet", "--bare", "--filter=blob:none", repo, path],
                                  capture_output=True, text=True)
            if done.returncode:
                health["repos_unreachable"] += 1
                return None
        elif git(path, "fetch", "--quiet", "--prune", "origin", "+refs/heads/*:refs/heads/*") is None:
            health["repos_fetch_failed"] += 1      # read what the cache already has
        refs = ["refs/heads/" + telemetry.BRANCH]
    else:
        path = os.path.realpath(os.path.expanduser(repo))
        if git(path, "rev-parse", "--git-dir") is None:
            health["repos_unreachable"] += 1
            return None
        git(path, "fetch", "--quiet", "origin",
            "+refs/heads/%s:refs/remotes/origin/%s" % (telemetry.BRANCH, telemetry.BRANCH))
        refs = ["refs/remotes/origin/" + telemetry.BRANCH, "refs/heads/" + telemetry.BRANCH]
    for ref in refs:
        if git(path, "rev-parse", "--verify", "--quiet", ref):
            return path, ref
    health["repos_without_branch"] += 1
    return None


def read_reports(path, ref, health):
    """Every report file on the branch, as {(developer, name): parsed json}."""
    files = {}
    listing = git(path, "ls-tree", "-r", "--name-only", ref, "reports/") or ""
    for name in listing.splitlines():
        found = REPORT_PATH.match(name)
        if not found:
            continue
        text = git(path, "show", ref + ":" + name)
        try:
            doc = json.loads(text or "")
            major = str(doc["schema"]).rsplit("/", 1)[1].split(".")[0]
        except (ValueError, KeyError, TypeError, IndexError):
            health["unreadable_files"] += 1
            continue
        if major != KNOWN_MAJOR:
            health["unknown_schema_files"] += 1
            continue
        files[(found.group(1), found.group(2))] = doc
    return files


def developer_label(dev):
    """Name when the report carries one, else the id (anonymous publishers)."""
    return (dev.get("name") or dev.get("id") or "?") if isinstance(dev, dict) else str(dev)


def collect(repos, cache, stale_days, health):
    records, changes, reporting, agents = {}, [], [], set()
    today = dt.date.today()
    for repo in repos:
        opened = open_repo(repo, cache, health)
        if not opened:
            continue
        path, ref = opened
        health["repos_read"] += 1
        files = read_reports(path, ref, health)
        name = None
        for (dev_dir, kind), doc in sorted(files.items()):
            name = name or doc.get("repo")
            dev = doc.get("developer") or {}
            dev_id = (dev.get("id") if isinstance(dev, dict) else None) or dev_dir
            if kind == "status":
                try:
                    updated = dt.date.fromisoformat(doc.get("updated") or "")
                except ValueError:
                    updated = None
                reporting.append({"repo": doc.get("repo") or repo, "dev": dev_id, "label": developer_label(dev),
                                  "updated": updated.isoformat() if updated else None,
                                  "stale": updated is None or (today - updated).days > stale_days,
                                  "gaps": sorted(k for k, v in (doc.get("health") or {}).items()
                                                 if v and not k.endswith(("_files", "_scanned", "_source_missing")))})
                continue
            sessions = doc.get("sessions")
            if not isinstance(sessions, dict):
                health["unreadable_files"] += 1
                continue
            for key, rec in sessions.items():
                try:
                    row = rec["row"]
                    agents.add(row["a"])
                except (KeyError, TypeError):
                    health["unreadable_sessions"] += 1
                    continue
                rec = dict(rec, repo=doc.get("repo") or repo, dev=dev_id, label=developer_label(dev))
                records[(rec["repo"], dev_id, key)] = rec
        for c in telemetry.context_changes(path, telemetry.CONTEXT_PATHS):
            changes.append(dict(c, repo=name or repo))
    return records, changes, reporting, agents


def flatten(records):
    rows, buckets, runs = [], [], []
    for idx, rec in enumerate(sorted(records.values(), key=lambda r: (r["row"]["d"], r["repo"], r["dev"]))):
        extra = {"repo": rec["repo"], "dev": rec["dev"]}
        rows.append(dict(rec["row"], **extra))
        buckets.extend(dict(b, a=rec["row"]["a"], s=idx, **extra) for b in rec.get("buckets") or [])
        runs.extend(dict(r, **extra) for r in rec.get("runs") or [])
    return rows, buckets, runs


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("repos", nargs="*", help="local clone or git URL")
    ap.add_argument("--config", help="file with one repository per line")
    ap.add_argument("--out", default=os.path.join(".cfd", "team", "index.html"), help="output HTML")
    ap.add_argument("--stale-days", type=int, default=14,
                    help="a contributor whose last report is older is shown as not reporting (default 14)")
    ap.add_argument("--open", action="store_true", help="open the page in the browser")
    args = ap.parse_args()

    repos = list(args.repos)
    if args.config:
        with open(args.config, encoding="utf-8") as fh:
            repos += [ln.split("#", 1)[0].strip() for ln in fh if ln.split("#", 1)[0].strip()]
    if not repos:
        sys.exit("✗ Name at least one repository, or a --config file listing them.")
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    health = collections.Counter()
    records, changes, reporting, agents = collect(repos, os.path.join(os.path.dirname(out), "repos"),
                                                  args.stale_days, health)
    rows, buckets, runs = flatten(records)
    people = {}
    for rec in records.values():
        people.setdefault(rec["dev"], rec["label"])
    for r in reporting:
        people.setdefault(r["dev"], r["label"])
    repo_names = sorted({r["repo"] for r in rows} | {r["repo"] for r in reporting})
    order = [name for name, _ in telemetry.ADAPTERS] + sorted(agents)
    data = {
        "mode": "team",
        "project": "%d repositor%s" % (len(repo_names), "y" if len(repo_names) == 1 else "ies"),
        "generated": dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z"),
        "today": dt.date.today().isoformat(),
        "agents": list(dict.fromkeys(a for a in order if a in agents)),
        # Alphabetical by label, never by consumption: a filter, not a ranking.
        "people": [{"id": k, "label": v} for k, v in sorted(people.items(), key=lambda kv: kv[1].lower())],
        "repos": repo_names,
        "reporting": sorted(reporting, key=lambda r: (r["repo"], r["label"].lower())),
        "stale_days": args.stale_days,
        "sessions": rows, "buckets": buckets, "runs": runs, "changes": changes,
        "health": dict(health),
    }
    template = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard.html")
    with open(template, encoding="utf-8") as fh:
        html = fh.read()
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html.replace("__DATA__", json.dumps(data, separators=(",", ":")).replace("</", "<\\/")))

    stale = [r for r in reporting if r["stale"]]
    print("Repositories  %d read of %d" % (health["repos_read"], len(repos)))
    print("Contributors  %d, %d not reporting in the last %d days" % (len(people), len(stale), args.stale_days))
    print("Sessions      %d" % len(rows))
    for key in sorted(health):
        if key != "repos_read" and health[key]:
            print("  note  %-22s %d" % (key, health[key]))
    print("Wrote         " + out)
    if git(os.getcwd(), "rev-parse", "--git-dir") is not None and subprocess.run(
            ["git", "check-ignore", "-q", out], capture_output=True).returncode != 0:
        print("⚠ " + os.path.relpath(out) + " is not git-ignored. It names people: add `.cfd/` to .gitignore.")
    if args.open:
        webbrowser.open("file://" + out)


if __name__ == "__main__":
    main()
