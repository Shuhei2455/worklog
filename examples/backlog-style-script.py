#!/usr/bin/env python3
"""
本家 Backlog 向けに書かれた想定のスクリプト。
SPACE を書き換えるだけで別のホストに向く、という作りにしてある。

やること: 指定プロジェクトの未対応の課題を数えて、一覧を出す。
"""
import os, json, urllib.request, urllib.parse

SPACE   = os.environ.get("BACKLOG_SPACE", "https://example.backlog.com")
API_KEY = os.environ["BACKLOG_API_KEY"]
PROJECT = os.environ.get("BACKLOG_PROJECT", "AA")

def api(path, **params):
    params["apiKey"] = API_KEY
    qs = urllib.parse.urlencode(params, doseq=True)
    with urllib.request.urlopen(f"{SPACE}/api/v2/{path}?{qs}", timeout=30) as r:
        return json.load(r)

me = api("users/myself")
print(f"接続先: {SPACE}")
print(f"ログイン: {me['name']} (roleType={me['roleType']})")

project = api(f"projects/{PROJECT}")
statuses = api(f"projects/{PROJECT}/statuses")
open_id = next(s["id"] for s in statuses if s["displayOrder"] == 1000)

issues = api("issues", **{
    "projectId[]": [project["id"]],
    "statusId[]": [open_id],
    "sort": "created",
    "order": "desc",
    "count": 10,
})
print(f"\n{project['name']} の未対応: {len(issues)} 件")
for i in issues:
    who = i["assignee"]["name"] if i["assignee"] else "未割り当て"
    print(f"  {i['issueKey']:<8} {i['summary'][:26]:<28} {who}")
