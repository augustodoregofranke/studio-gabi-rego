# Roadmap: Studio Gabi Rego — Hardening & Performance

## Overview

This milestone transforms the Studio Gabi Rego gym management system from a functioning but vulnerable codebase into a production-hardened application. The work proceeds in a deliberate sequence: close active security exploits first (phases 1-2), then stabilize data integrity and database performance (phases 3-5), then add the test safety net (phase 6), then execute structural refactoring under that safety net (phases 7-10). Every phase leaves the application in a working, deployable state with all 226 existing tests passing.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Security Hardening** - Close three active exploits in server actions, rate limiter, and cron endpoints; unify password policy
- [x] **Phase 2: Bug Fixes and Dependency Cleanup** - Fix broken revalidatePath calls, remove gender heuristic, verify and remove unused dependencies
- [x] **Phase 3: Data Integrity** - Centralize ANAMNESE canonical fields and migrate placeholder-email behavior to explicit nullable-email integrity
- [ ] **Phase 4: Database Performance** - Add composite indexes on high-query fields; push birthday filtering to the database
- [ ] **Phase 5: API Pagination** - Add pagination to all currently unpaginated list endpoints
- [ ] **Phase 6: Test Coverage** - Add middleware route protection tests and scheduler core logic tests
- [ ] **Phase 7: Financeiro Component Split** - Break the 1,612-line financeiro page into focused sub-components and extract inline schemas
- [ ] **Phase 8: Financeiro SWR Caching** - Replace manual fetch/useEffect with SWR caching and deduplication on the refactored financeiro page
- [ ] **Phase 9: Treinos Refactor and RSC Conversion** - Split the 785-line treinos generator; convert applicable pages to React Server Components
- [ ] **Phase 10: Email Template Deduplication** - Replace 948 lines of duplicated HTML email templates with a shared layout approach

## Phase Details

### Phase 1: Security Hardening
**Goal**: The application is no longer exploitable by authenticated members; rate limiting is reliable in production; cron endpoints resist timing attacks; password policy is consistent across all flows
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. An authenticated member session cannot invoke toggleMembroStatus, deleteMembro, or deactivateMembro — requests are rejected with 403
  2. When Redis is unavailable in production, the rate limiter returns { success: false } and blocks the request rather than allowing it through
  3. Both cron endpoints use crypto.timingSafeEqual for secret comparison — the comparison is immune to timing-based secret recovery
  4. Creating or updating a member password with fewer than 8 characters, no uppercase, or no number is rejected by the same Zod schema in both the registration and admin update flows
**Plans**: TBD

### Phase 2: Bug Fixes and Dependency Cleanup
**Goal**: Broken cache invalidation is fixed so UI reflects mutations; the gender heuristic is removed from anamnese; confirmed-unused dependencies are removed from the production bundle
**Depends on**: Phase 1
**Requirements**: BUG-01, BUG-02, SEC-05
**Success Criteria** (what must be TRUE):
  1. After toggling a member's status or deleting a member, the /alunos page reflects the change without a manual browser refresh
  2. The anamnese API returns null for the sexo field when it is not set in the database — no guessing from names
  3. dompurify and isomorphic-dompurify are absent from package.json dependencies; pdf-lib is present only in devDependencies
**Plans**: 3/3 plans complete
Plans:
- [x] 02-01-PLAN.md — Fix BUG-01 by correcting member action revalidatePath targets to /alunos with regression assertions.
- [x] 02-02-PLAN.md — Fix BUG-02 by removing sexo heuristics in both anamnese GET endpoints and enforcing null fallback.
- [x] 02-03-PLAN.md — Deliver SEC-05 by removing unused runtime deps and moving pdf-lib to devDependencies with build/test verification.

### Phase 3: Data Integrity
**Goal**: ANAMNESE field behavior is defined in exactly one place; missing member email is represented as `null` (not placeholders) with deterministic legacy cleanup — adding/removing a field or changing email-missing handling requires one canonical change path
**Depends on**: Phase 2
**Requirements**: DATA-01, DATA-02
**Success Criteria** (what must be TRUE):
  1. The minha-anamnese route uses sanitizeAnamnesePayload from src/lib/anamnese.ts — there is no separate ANAMNESE_FIELDS array in the route file
  2. Both member creation paths (POST /api/membros and PUT /api/membros/[id]) persist missing email as `null` and no route generates `@placeholder.local` values
  3. Adding a new anamnese field to src/lib/anamnese.ts automatically propagates to all anamnese routes without any other code change
**Plans**: 3/3 plans complete
Plans:
- [x] 03-01-PLAN.md — Consolidate canonical anamnese sanitize/normalize logic in `src/lib/anamnese.ts` and remove route-local field duplication with self-healing read behavior.
- [x] 03-02-PLAN.md — Make `Usuario.email` nullable and remove placeholder generation from member create/update flows while guarding email-dependent operations.
- [x] 03-03-PLAN.md — Add deterministic one-time placeholder-email migration script with preview/execute modes and JSON report artifacts.

### Phase 4: Database Performance
**Goal**: Financial and scheduling queries no longer scan full tables; the birthday notification job filters at the database level rather than loading all members into memory
**Depends on**: Phase 3
**Requirements**: PERF-01, PERF-02
**Success Criteria** (what must be TRUE):
  1. The Pagamento, Membro, and Agendamento tables have explicit composite indexes visible in the Supabase dashboard (Pagamento.status+dataVencimento, Membro.status, Agendamento.data)
  2. The processarAniversarios scheduler function issues a $queryRaw with EXTRACT(MONTH) and EXTRACT(DAY) — it does not fetch all active members and filter in JavaScript
  3. All 226 existing tests continue to pass after the Prisma migration is applied
**Plans**: 3 plans
Plans:
- [ ] 04-01-PLAN.md — Add required Prisma indexes and generate scoped migration SQL for PERF-01 with off-hours deploy guidance.
- [ ] 04-02-PLAN.md — Rewrite `processarAniversarios` to use parameterized `$queryRaw` with `EXTRACT(MONTH/DAY)` and preserve notification behavior.
- [ ] 04-03-PLAN.md — Add scheduler regression tests and run full post-migration verification gates (`db:generate`, `typecheck`, `test:run`).

### Phase 5: API Pagination
**Goal**: The /api/membros, /api/horarios, and /api/planos endpoints accept page and limit parameters and return paginated responses, preventing unbounded payload growth as the studio grows
**Depends on**: Phase 4
**Requirements**: PERF-03
**Success Criteria** (what must be TRUE):
  1. GET /api/membros?page=1&limit=20 returns at most 20 records with a total count in the response
  2. GET /api/horarios and GET /api/planos accept the same pagination parameters and return the same response shape as the existing GET /api/pagamentos implementation
  3. Callers that omit pagination parameters receive a default-paginated response (not all records)
**Plans**: TBD

### Phase 6: Test Coverage
**Goal**: Middleware route protection is verified by automated tests; scheduler core logic is covered by unit tests; a catch-all redirect ensures unmatched authenticated routes fail safely
**Depends on**: Phase 5
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. A test verifies that an ADMIN token can access /dashboard and is redirected away from /inicio
  2. A test verifies that a MEMBRO token is redirected away from /alunos and /financeiro
  3. A test verifies that an unauthenticated request to any ADMIN_ROUTES member is redirected to /login
  4. Tests verify that processarAniversarios deduplicates notifications correctly when run twice in the same window
  5. Tests verify that the overdue payment update logic transitions only Pagamentos with the correct status and past-due date
**Plans**: TBD

### Phase 7: Financeiro Component Split
**Goal**: The 1,612-line financeiro page is broken into independently renderable sub-components; inline Zod schemas are moved to src/schemas/ — the page file is under 300 lines and each extracted component is independently testable
**Depends on**: Phase 6
**Requirements**: PERF-04, MAINT-02
**Success Criteria** (what must be TRUE):
  1. PlanoCard, PagamentoTable, PagamentoDialog, and FinanceiroStats exist as separate files in the financeiro directory
  2. All inline Zod schemas from the financeiro page are moved to src/schemas/ and imported by the page
  3. All financeiro functionality (plan CRUD, payment CRUD, stats display, filtering, pagination) works identically to before the split
  4. All 226 existing tests continue to pass
**Plans**: TBD

### Phase 8: Financeiro SWR Caching
**Goal**: The financeiro page uses SWR for all data fetching — planos, pagamentos, stats, and membros are fetched with deduplication and cache invalidation, eliminating redundant API calls and stale UI after mutations
**Depends on**: Phase 7
**Requirements**: PERF-05
**Success Criteria** (what must be TRUE):
  1. Switching between plan and payment tabs on the financeiro page does not trigger a new API request if data was already fetched in the current session
  2. After creating, updating, or deleting a payment or plan, the financeiro page reflects the change immediately without a full page reload
  3. The financeiro page makes no fetch() calls in useEffect — all data fetching uses useSWR hooks
**Plans**: TBD

### Phase 9: Treinos Refactor and RSC Conversion
**Goal**: The 785-line treinos generator is split into focused sub-components; applicable pages (financeiro shell, dashboard, other data-display pages) are converted to React Server Components — improving initial load time and reducing client-side JavaScript
**Depends on**: Phase 8
**Requirements**: PERF-06, PERF-07
**Success Criteria** (what must be TRUE):
  1. The treinos generator page renders correctly after extraction into separate exercise list, template selector, and member selector components
  2. The financeiro page shell is an RSC that passes pre-fetched data to client island components
  3. All converted pages render without client-side hydration errors
  4. All 226 existing tests continue to pass after each RSC conversion (tests are run after each individual conversion, not at the end of the phase)
**Plans**: TBD

### Phase 10: Email Template Deduplication
**Goal**: The 948-line email template file is reduced to a shared layout function plus 7 focused template files — updating the brand colors, footer text, or logo URL requires a single change that propagates to all 7 email types
**Depends on**: Phase 9
**Requirements**: MAINT-01
**Success Criteria** (what must be TRUE):
  1. src/lib/resend.ts no longer contains 7 copies of the HTML boilerplate (header, footer, styling, layout tables)
  2. A shared layout function or react-email base component wraps the unique content for each template
  3. All 7 email types (welcome, password reset, birthday, payment reminder, etc.) produce visually identical output to the pre-refactor versions
  4. The emailTemplates export interface is unchanged — callers require no updates
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security Hardening | 4/4 | Complete | 2026-02-16 |
| 2. Bug Fixes and Dependency Cleanup | 3/3 | Complete | 2026-02-20 |
| 3. Data Integrity | 3/3 | Complete | 2026-02-20 |
| 4. Database Performance | 0/TBD | Not started | - |
| 5. API Pagination | 0/TBD | Not started | - |
| 6. Test Coverage | 0/TBD | Not started | - |
| 7. Financeiro Component Split | 0/TBD | Not started | - |
| 8. Financeiro SWR Caching | 0/TBD | Not started | - |
| 9. Treinos Refactor and RSC Conversion | 0/TBD | Not started | - |
| 10. Email Template Deduplication | 0/TBD | Not started | - |
