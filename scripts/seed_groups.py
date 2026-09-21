"""Seed / verify the groups table and students count."""
import os, sys
import psycopg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def env(name):
    with open(os.path.join(ROOT, ".env.local"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    return None

PASSWORD = env("SUPABASE_DB_PASSWORD")
REF = "mnsfehjctnjprqsaqart"
DSN = f"postgresql://postgres.{REF}:{PASSWORD}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres"

GROUPS = [
    # (level, rotation, label, chat_id)  — level/rotation values match the site's VALID_LEVELS/ROTATIONS
    ("5", "rot1", "5e année — Rotation 1 (M22/25 Rotation 1)", "-1004299862715"),
]

with psycopg.connect(DSN, connect_timeout=15, sslmode="require") as conn:
    with conn.cursor() as cur:
        for level, rotation, label, chat_id in GROUPS:
            cur.execute(
                """
                insert into public.groups (level, rotation, label, chat_id)
                values (%s, %s, %s, %s)
                on conflict (level, rotation) do update
                  set label = excluded.label, chat_id = excluded.chat_id
                returning id, level, rotation, label, chat_id
                """,
                (level, rotation, label, chat_id),
            )
            row = cur.fetchone()
            print(f"UPSERTED group {row[0]} -> {row[1]}/{row[2]} chat={row[4]}")
        cur.execute("select count(*) from public.students")
        print(f"students count: {cur.fetchone()[0]}")
        cur.execute("select level, rotation, label, chat_id from public.groups order by level, rotation")
        print("\ngroups table:")
        for r in cur.fetchall():
            print(f"  {r[0]}/{r[1]}  {r[2]}  {r[3]}")
