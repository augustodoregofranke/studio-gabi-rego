# Phase 4: Database Performance - Research

**Researched:** 2026-02-20
**Domain:** Prisma/PostgreSQL query optimization for financial, scheduling, and birthday notification workloads
**Confidence:** HIGH

## User Constraints

### Context Status
- No `CONTEXT.md` exists for Phase 4 (`.planning/phases/04-database-performance/`).

### Locked Decisions (from phase brief, requirements, state)
- Add explicit indexes for:
  - `Pagamento(status, dataVencimento)`
  - `Membro(status)`
  - `Agendamento(data)`
- `processarAniversarios` must filter birthdays in SQL with `EXTRACT(MONTH)` and `EXTRACT(DAY)` via `prisma.$queryRaw`.
- Preserve existing behavior and keep the full existing test suite passing.
- Execute index migration in off-hours due write-lock risk on `pagamentos`/`agendamentos`.

### Claude's Discretion (planning freedom)
- Migration naming and plan slicing.
- Whether to add focused regression tests now (beyond “existing tests still pass”).
- Exact SQL shape for birthday query as long as it uses `EXTRACT(MONTH/DAY)` and remains parameterized.

### Deferred Ideas (Out of Scope)
- API pagination (`PERF-03`) is Phase 5, not Phase 4.
- Scheduler test-suite expansion (`TEST-02`) is Phase 6, except optional minimal guardrails directly tied to this change.

## Summary

Phase 4 is a targeted database-optimization phase with two concrete deliverables: index-backed hot-path queries and a database-filtered birthday job. The current schema has no explicit non-unique indexes on the target fields, and `processarAniversarios` currently loads all active members then filters birthdays in memory.

This phase should stay narrow: add the three required indexes in Prisma schema + migration, replace birthday filtering with a parameterized `prisma.$queryRaw` query using `EXTRACT(MONTH/DAY)`, and verify no behavior regression through existing tests. The biggest operational risk is index creation lock behavior, so migration timing matters more than code complexity.

**Primary recommendation:** Plan Phase 4 as two implementation plans plus one verification plan: (1) schema/index migration, (2) scheduler birthday query rewrite, (3) regression + migration-safety verification.

## Standard Stack

### Core
| Library/Platform | Version | Purpose | Why Standard |
|------------------|---------|---------|--------------|
| Prisma ORM (`@prisma/client`, `prisma`) | ^6.19.1 | Schema indexes + migration + raw query execution | Already the project’s DB contract and migration pipeline |
| PostgreSQL (Supabase) | 16.x behavior | Index and `EXTRACT` semantics | Production database engine |
| Next.js route/job runtime | 16.1.1 | Scheduler execution path | `src/lib/scheduler.ts` is existing task orchestration point |
| Vitest | ^4.0.17 | Regression safety | Existing quality gate and pre-commit behavior |

### Supporting
| Tool/API | Version | Purpose | When to Use |
|----------|---------|---------|-------------|
| Prisma Migrate (`prisma migrate dev/deploy`) | ^6.19.1 | Apply schema/index changes safely | Required for any schema change |
| Supabase dashboard | current | Verify indexes are visible after deploy | Required by phase success criteria |
| `EXPLAIN (ANALYZE, BUFFERS)` (optional) | PostgreSQL | Validate query plan/index usage in staging | Use if query performance uncertainty remains |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Prisma-schema-declared indexes (`@@index`) | Handwritten SQL-only migration | Less schema drift with `@@index`; SQL-only adds maintenance risk |
| Standard `CREATE INDEX` timing off-hours | `CREATE INDEX CONCURRENTLY` custom SQL | Lower write blocking, but extra migration complexity and transactional constraints |
| DB-level birthday filtering | Keep JS `.filter()` over all active members | Violates `PERF-02` and scales poorly |

**Installation:**
```bash
# No new dependencies needed for Phase 4.
```

## Architecture Patterns

### Recommended Project Structure
```text
prisma/
├── schema.prisma                               # add @@index declarations
└── migrations/<timestamp>_phase4_db_perf/
    └── migration.sql                           # generated SQL for indexes

src/lib/
└── scheduler.ts                                # rewrite processarAniversarios query

src/__tests__/                                  # existing suite remains mandatory gate
```

### Pattern 1: Declarative Prisma Indexes for Query Hot Paths
**What:** Add index definitions in Prisma schema on filter/sort paths used by finance/schedule workloads.
**When to use:** For required Phase 4 fields and any future query-backed hotspot.
**Example:**
```prisma
model Pagamento {
  // ...
  @@index([status, dataVencimento])
}

model Membro {
  // ...
  @@index([status])
}

model Agendamento {
  // ...
  @@index([data])
}
```

### Pattern 2: Parameterized Raw SQL for Birthday Filtering
**What:** Use `prisma.$queryRaw` with `EXTRACT(MONTH/DAY)` and bound values for month/day.
**When to use:** Queries Prisma query builder cannot express cleanly (date-part filtering here).
**Example:**
```ts
import { Prisma, StatusMembro } from '@prisma/client'

const aniversariantes = await prisma.$queryRaw<Array<{
  id: string
  telefone: string | null
  usuario_nome: string | null
  usuario_email: string | null
}>>(Prisma.sql`
  SELECT m.id, m.telefone, u.nome AS usuario_nome, u.email AS usuario_email
  FROM membros m
  JOIN usuarios u ON u.id = m.usuario_id
  WHERE m.status = ${StatusMembro.ATIVO}
    AND m.data_nascimento IS NOT NULL
    AND EXTRACT(MONTH FROM m.data_nascimento) = ${mes}
    AND EXTRACT(DAY FROM m.data_nascimento) = ${dia}
`)
```

### Anti-Patterns to Avoid
- Using `$queryRawUnsafe` or string concatenation for month/day interpolation.
- Keeping `prisma.membro.findMany({ where: { status: 'ATIVO' }})` + JS birthday filtering.
- Assuming the existing `@@unique([membroId, horarioId, data])` already optimizes date-only schedule queries.
- Running index migration during peak write traffic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Birthday filtering | In-memory JS filters over full member list | SQL `EXTRACT(MONTH/DAY)` with `$queryRaw` | DB does the filtering; less memory and transfer |
| SQL safety | Concatenated SQL strings | Tagged template `$queryRaw` | Parameterization prevents injection vectors |
| Migration orchestration | Ad-hoc SQL in production shell | Prisma migration files + deploy flow | Auditable, repeatable, and aligned with repo rules |
| Index strategy validation | Guesswork | Supabase index visibility + optional `EXPLAIN` | Confirms expected planner behavior |

**Key insight:** the phase is successful when data reduction happens in the database before application logic executes.

## Common Pitfalls

### Pitfall 1: Write blocking during index creation
**What goes wrong:** Deploy appears healthy but write-heavy operations stall temporarily.
**Why it happens:** Standard `CREATE INDEX` takes a lock that blocks writes while building.
**How to avoid:** Schedule migration off-hours (already a locked blocker). Consider concurrent strategy only if planning explicitly accepts complexity.
**Warning signs:** Increased API latency/timeouts on payment/scheduling writes during migration window.

### Pitfall 2: Misreading multicolumn index behavior
**What goes wrong:** Team assumes any query touching indexed columns will be fast.
**Why it happens:** B-tree multicolumn indexes are most effective when predicates include leftmost columns.
**How to avoid:** Keep `Pagamento(status, dataVencimento)` for status/date patterns; do not assume it optimizes unrelated ordering/filtering.
**Warning signs:** Query still performing bitmap/seq scan despite index presence.

### Pitfall 3: Unsafe raw SQL interpolation
**What goes wrong:** Security regression or SQL errors in scheduler.
**Why it happens:** Using raw string building or identifiers as variables in tagged templates.
**How to avoid:** Use tagged `$queryRaw` with values only; keep identifiers static in SQL text.
**Warning signs:** Use of `$queryRawUnsafe`, string concatenation, or dynamic table/column names.

### Pitfall 4: Date-part semantics mismatch
**What goes wrong:** Birthday candidates differ from previous behavior for edge records.
**Why it happens:** `data_nascimento` is timestamp-backed and historical data may include timezone-shifted values.
**How to avoid:** Validate rewritten query against fixture data including null and boundary dates; preserve current notification dedupe behavior.
**Warning signs:** Sudden drop/spike in birthday notifications after deploy.

### Pitfall 5: Planner scope drift into pagination/refactors
**What goes wrong:** Phase extends into unrelated endpoint pagination or UI changes.
**Why it happens:** Nearby performance issues are visible in same files.
**How to avoid:** Keep Phase 4 scoped to PERF-01 and PERF-02 only.
**Warning signs:** Plan includes `/api/horarios`/`/api/planos` pagination tasks.

## Code Examples

### Current Birthday Hotspot (must be replaced)
```ts
// src/lib/scheduler.ts
const membros = await prisma.membro.findMany({
  where: { status: 'ATIVO' },
  include: { usuario: true },
})

const aniversariantes = membros.filter((membro) => {
  if (!membro.dataNascimento) return false
  const dataNasc = new Date(membro.dataNascimento)
  return dataNasc.getMonth() + 1 === mes && dataNasc.getDate() === dia
})
```

### Required Index Scope (Prisma schema)
```prisma
model Pagamento {
  // ...
  @@index([status, dataVencimento])
}

model Membro {
  // ...
  @@index([status])
}

model Agendamento {
  // ...
  @@index([data])
}
```

### Verification Command Set (recommended)
```bash
# 1) Generate and inspect migration SQL
npm run db:migrate -- --name phase4_database_performance

# 2) Apply in target env via deployment flow
npm run db:migrate:deploy

# 3) Regression gate
npm run test:run

# 4) Optional static checks
npm run lint
npm run typecheck
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| App-level birthday filtering | DB-level date-part filtering (`EXTRACT`) | Phase 4 target | Avoids loading all active members into memory |
| Implicit/default-only indexing | Explicit workload indexes | Phase 4 target | Better selectivity for financial/scheduling queries |
| Deploy-anytime migration timing | Planned off-hours DB index migration | Locked in state notes | Lowers operational risk during index build |

**Deprecated/outdated in this phase:**
- Birthday member filtering in JavaScript.
- Relying on default constraints only for query performance.

## Open Questions

1. **Do we keep migration purely Prisma-generated, or adopt custom SQL for concurrent index creation?**
   - What we know: off-hours migration is already an accepted constraint.
   - Recommendation: Keep Prisma-generated standard migration for Phase 4 unless write-volume testing proves unacceptable.

2. **Should Phase 4 add a focused scheduler unit test now?**
   - What we know: current tests cover cron route wrapper, not `processarAniversarios` internals.
   - Recommendation: Optional but valuable; add one direct scheduler test asserting `$queryRaw` path to prevent regression.

3. **Do we validate query plans explicitly in staging?**
   - What we know: success criteria require index presence and passing tests, not `EXPLAIN` evidence.
   - Recommendation: Include optional staging `EXPLAIN` check for high confidence before production apply.

## Sources

### Primary (HIGH confidence)
- Local codebase
  - `prisma/schema.prisma`
  - `src/lib/scheduler.ts`
  - `src/app/api/pagamentos/route.ts`
  - `src/app/api/agendamentos/route.ts`
  - `src/app/(admin)/dashboard/page.tsx`
  - `.planning/ROADMAP.md`
  - `.planning/REQUIREMENTS.md`
  - `.planning/STATE.md`
- Prisma docs
  - Indexes in Prisma schema: https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes
  - Raw queries (`$queryRaw`, safety rules): https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries
  - Unsupported DB features (partial/function index caveats): https://www.prisma.io/docs/orm/prisma-schema/data-model/unsupported-database-features
  - Customizing migrations: https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations
- PostgreSQL docs
  - `CREATE INDEX` locking and `CONCURRENTLY`: https://www.postgresql.org/docs/current/sql-createindex.html
  - Multicolumn index behavior: https://www.postgresql.org/docs/current/indexes-multicolumn.html
  - Date/time `EXTRACT`: https://www.postgresql.org/docs/current/functions-datetime.html

### Secondary (MEDIUM confidence)
- Existing project research snapshots:
  - `.planning/codebase/CONCERNS.md`
  - `.planning/codebase/TESTING.md`

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack and migration path: HIGH (directly aligned with current repo and Prisma docs).
- Index/query architecture: HIGH (direct code hotspot mapping + PostgreSQL indexing semantics).
- Operational lock guidance: HIGH (PostgreSQL `CREATE INDEX` behavior documented).
- Optional concurrent-index path in Prisma workflow: MEDIUM (valid pattern but requires environment-specific validation).

**Research date:** 2026-02-20
**Valid until:** 2026-03-22
