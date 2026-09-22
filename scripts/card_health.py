"""Card-health report: students missing photos, storage usage, join state.

Run from the project root:
    python scripts/card_health.py
"""
import os
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
DSN = f"postgresql://postgres.mnsfehjctnjprqsaqart:{PASSWORD}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres"

with psycopg.connect(DSN, connect_timeout=15, sslmode="require") as conn:
    with conn.cursor() as cur:
        cur.execute(
            "select nom, prenom, photo_error from public.students where photo_missing order by nom"
        )
        missing = cur.fetchall()
        print(f"students with missing cards: {len(missing)}")
        for nom, prenom, err in missing:
            print(f"  {nom} {prenom}  ({err})")

        cur.execute(
            "select count(*), coalesce(sum((metadata->>'size')::bigint), 0)"
            " from storage.objects where bucket_id = 'student-cards'"
        )
        n, total = cur.fetchone()
        print(f"\nstudent-cards bucket: {n} files, {total / 1024 / 1024:.2f} MB")

        if missing:
            print("\nNOTE: photos for flagged students are permanently lost (never stored);")
            print("ask them to re-submit from a fresh browser, or accept the join without a card.")
        cur.execute("select count(*) from public.students where joined")
        print(f"\nstudents joined: {cur.fetchone()[0]}")
        cur.execute("select count(*) from public.students")
        print(f"students total:  {cur.fetchone()[0]}")