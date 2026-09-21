"""Push pending migrations to Supabase Postgres over the session pooler."""
import os, sys, time
import psycopg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.basename(ROOT)  # lovable-project-d44a6781

def env(name):
    with open(os.path.join(ROOT, ".env.local"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    return None

PASSWORD = env("SUPABASE_DB_PASSWORD")
assert PASSWORD, "SUPABASE_DB_PASSWORD missing"

# Region guess: try common pooler hosts; project ref decides the subdomain
REF = "mnsfehjctnjprqsaqart"

MIGRATIONS = [
    "supabase/migrations/20260921095849_c18a3a7b-2e52-4bb4-b1ff-2d398935ab62.sql",
    "supabase/migrations/20260921101500_levels_rotations_groups.sql",
    "supabase/migrations/20260921160000_list_groups_rpc.sql",
    "supabase/migrations/20260921160500_student_cards_bucket.sql",
]

def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()

def try_connect(host, port):
    dsn = f"postgresql://postgres.{REF}:{PASSWORD}@{host}:{port}/postgres"
    return psycopg.connect(dsn, connect_timeout=15, sslmode="require")

def main():
    candidates = []
    for aws in ("aws-1", "aws-0"):
        for region in (
            "eu-west-3", "eu-central-1", "eu-west-1", "eu-west-2",
            "us-east-1", "us-east-2", "us-west-1",
            "ap-southeast-1", "ap-southeast-2", "ap-northeast-1",
            "ap-south-1", "ca-central-1", "sa-east-1",
        ):
            candidates.append((f"{aws}-{region}.pooler.supabase.com", 5432))
    conn = None
    for host, port in candidates:
        try:
            print(f"Trying {host}:{port} ...", flush=True)
            conn = try_connect(host, port)
            print(f"Connected via {host}", flush=True)
            break
        except Exception as e:
            print(f"  failed: {type(e).__name__}: {e}", flush=True)
    if not conn:
        sys.exit("Could not reach the session pooler on any region host.")

    with conn.cursor() as cur:
        cur.execute("create schema if not exists supabase_migrations")
        cur.execute("""
            create table if not exists supabase_migrations.schema_migrations (
                version text primary key,
                statements text[] default '{}',
                name text
            )
        """)
        cur.execute("select version from supabase_migrations.schema_migrations")
        applied = {r[0] for r in cur.fetchall()}
        print(f"Applied migrations so far: {sorted(applied)}", flush=True)

        for path in MIGRATIONS:
            version = os.path.basename(path).split("_")[0]
            name = os.path.basename(path)
            if version in applied:
                print(f"SKIP {name} (already applied)", flush=True)
                continue
            sql = read(path)
            print(f"APPLY {name} ...", flush=True)
            try:
                cur.execute(sql)
                cur.execute(
                    "insert into supabase_migrations.schema_migrations (version, name) values (%s, %s)",
                    (version, name),
                )
                print(f"  OK", flush=True)
            except Exception as e:
                conn.rollback()
                print(f"  FAILED: {e}", flush=True)
                sys.exit(1)

    conn.commit()

    # Verify: list tables + columns
    with conn.cursor() as cur:
        cur.execute("""
            select table_name, column_name, data_type
            from information_schema.columns
            where table_schema = 'public'
            order by table_name, ordinal_position
        """)
        rows = cur.fetchall()
        print("\nPublic schema after migration:", flush=True)
        for t, c, d in rows:
            print(f"  {t}.{c} {d}", flush=True)

    conn.close()
    print("\nMIGRATION DONE", flush=True)

if __name__ == "__main__":
    main()
