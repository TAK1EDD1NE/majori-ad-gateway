"""One-shot: import 4AM ROT2 group + students from JSON into Supabase.

Reads .env.local for SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (never prints
secrets), parses the JSON roster, inserts the missing group row and student
rows, then verifies by reading back + live bot admin check.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON = ROOT.parent / "4AM ROT 2 2026-2027.json"
LABEL = "4e année — Rotation 2"
CHAT_ID = "-1004339328400"
LEVEL, ROTATION = "4", "rot2"


def load_env(path: Path) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
            if m:
                env[m[1]] = m[2].strip().strip('"').strip("'")
    return env


env = load_env(ROOT / ".env.local")
url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY")
if not url or not key:
    sys.exit("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local")


def rest(method: str, path: str, body=None, params=""):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}{params}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return {"__http_error__": e.code, "__body__": e.read().decode(errors="replace")}


# --- 1) parse JSON ----------------------------------------------------------
data = json.loads(JSON.read_text(encoding="utf-8"))
assert isinstance(data, list) and data and set(data[0]) == {"Nom", "Prénom"}, data[:1]
students = []
for r in data:
    nom = re.sub(r"\s+", " ", str(r["Nom"]).strip())
    prenom = re.sub(r"\s+", " ", str(r["Prénom"]).strip())
    if nom and prenom:
        students.append({"nom": nom, "prenom": prenom})
print(f"JSON: {len(students)} students parsed")

# --- 2) group row -----------------------------------------------------------
existing = rest("GET", "groups", params="?level=eq.4&rotation=eq.rot2")
if isinstance(existing, list) and existing:
    print("group 4/rot2 already present:", existing[0]["label"], existing[0]["chat_id"])
else:
    ins = rest("POST", "groups", {"level": LEVEL, "rotation": ROTATION, "label": LABEL, "chat_id": CHAT_ID})
    if isinstance(ins, dict) and "__http_error__" in ins:
        sys.exit(f"group insert failed: {ins}")
    print("inserted group 4/rot2:", ins or "ok")

# --- 3) admin check (live) --------------------------------------------------


def rest_tg(token, method, body=None):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(body or {}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


token = env.get("TELEGRAM_BOT_TOKEN")
if token:
    me = rest_tg(token, "getMe")
    chat = rest_tg(token, "getChat", {"chat_id": CHAT_ID})
    member = rest_tg(token, "getChatMember", {"chat_id": CHAT_ID, "user_id": me["result"]["id"]})
    title = chat.get("result", {}).get("title", CHAT_ID)
    status = member.get("result", {}).get("status")
    print(f"live check: \"{title}\" ({CHAT_ID}) -> bot status: {status}")
    assert status in ("administrator", "creator"), f"bot is NOT admin there: {status}"

# --- 4) students (skip rows already present in 4/rot2) -----------------------


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


existing_all = rest("GET", "students", params="?select=nom,prenom,level,rotation&limit=100000")
if not isinstance(existing_all, list):
    sys.exit(f"cannot list students: {existing_all}")
existing_rot2 = {
    norm(f"{s['nom']} {s['prenom']}")
    for s in existing_all
    if s.get("level") == LEVEL and s.get("rotation") == ROTATION
}
to_insert = [s for s in students if norm(f"{s['nom']} {s['prenom']}") not in existing_rot2]
print(f"to insert: {len(to_insert)} (4/rot2 already has {len(existing_rot2)})")

BATCH = 200
for i in range(0, len(to_insert), BATCH):
    chunk = to_insert[i : i + BATCH]
    payload = [
        {"nom": s["nom"], "prenom": s["prenom"], "level": LEVEL, "rotation": ROTATION, "joined": False}
        for s in chunk
    ]
    res = rest("POST", "students", payload)
    if isinstance(res, dict) and "__http_error__" in res:
        sys.exit(f"insert batch {i // BATCH + 1} failed: {res}")
    print(f"  inserted batch {i // BATCH + 1}: {len(chunk)}")

# --- 5) verify ---------------------------------------------------------------
check = rest("GET", "students", params="?select=nom,prenom&level=eq.4&rotation=eq.rot2")
print("verify: students in DB 4/rot2 =", len(check) if isinstance(check, list) else check)
groups = rest("GET", "groups", params="?select=level,rotation,label,chat_id&order=level.desc")
if isinstance(groups, list):
    for g in groups:
        print("verify group:", g)