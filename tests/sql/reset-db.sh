#!/usr/bin/env bash
# Rebuild the local test database: Supabase shim + all migrations + demo seed.
set -euo pipefail
cd "$(dirname "$0")/../.."
PG="psql -h ${PGHOST:-127.0.0.1} -p ${PGPORT:-54329} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
DB=${PGDATABASE:-knotily_test}
$PG -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
$PG -d $DB -f tests/sql/supabase-shim.sql >/dev/null
for f in supabase/migrations/*.sql; do $PG -d $DB -f "$f" >/dev/null; done
$PG -d $DB -f supabase/seed.sql >/dev/null
echo "database $DB ready"
