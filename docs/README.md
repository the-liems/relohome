# THE LIEMS (P-044) documentation

## Current project documents

| Document | Purpose | Status |
|---|---|---|
| [Moving service specification](specs/SPEC-004-ahamove-moving-service.md) | AhaMove integration and customer-facing moving/packing requirements and scenarios | Draft; requirements review and provider verification tracked in linked issues |
| [SPEC-015: Maps and location experience](specs/SPEC-015-maps-and-location-experience.md) | Customer flow, evidence rules, service interfaces, and acceptance criteria | Draft |
| [Travel and flight booking specification](specs/SPEC-017-travel-and-flight-booking.md) | Journey search, comparison, approval, booking outcomes, and recovery requirements | Draft; reviewed against the integrated MVP, booking enablement remains a decision |
| [Product brief](product.md) | Relocation problem, target user, draft workflow, and open decisions | Draft; exact demo request unconfirmed |
| [Housing search spec](specs/SPEC-016-housing-search.md) | Housing scope, current implementation evidence, custom requirements, and explicit home choice | Draft; desktop list/map and automatic viewport search confirmed |
| [MCP tool catalogue](specs/SPEC-008-service-tools.md) | Proposed domain tools, AI system coordination, and vendor lifecycles | Draft contracts; travel booking in MVP, service grouping and schemas under review |
| [Submission announcements](references/gate-announcements.md) | Current Build notice and historical Gate 1/G2 requirements | Build notice supplied in the team chat on 18 October; original message URL not supplied |
| [Roadmap](roadmap.md) | Current Build deadline and historical Gate 1/G2 milestones | Build submission due 23:00 on 18 October 2026 (UTC+7) |
| [Architecture](../ARCHITECTURE.md) | Implemented system and proposed expansion | Local MVP integration overview |
| [Coolify deployment](../deploy/README.md) | Git-pinned Compose, SHA-tagged images, S3 blobs, setup and rollback | Implemented automation; live rollout verification remains separate |
| [Infrastructure](architecture/infrastructure.md) | Current deployment boundaries, runners, recovery and scaling | Current code and operational follow-up |
| [Coolify scaling and migration options](architecture/migration-options.md) | Host resizing/relocation, multi-server qualification, portability, and cutover/recovery gates | Future alternatives; no migration target selected |
| [Architecture diagrams](architecture_diagram.md) | Pre-integration baseline and proposed flows | Snapshot dated 2026-09-30 |
| [Project organization](project-organization.md) | Proposed documentation and work conventions | Proposed convention |
| [GitHub work in progress](work-in-progress.md) | Issue and PR map for service branches and integration gaps | Snapshot dated 2026-09-30; open and merged work labeled |
| [Testing summary](../eval/results/report.md) | Current GitHub CI, dated test reports and recorded outputs | Evidence through `29d9df7` at 19:59 UTC+7 on 18 October; deployment/public acceptance remains separate |
| [Journal](../JOURNAL.md) and [weekly worklog](../WORKLOG.md) | Technical learning and evidenced work | Reconstructed from repository history through 18 October; personal roles/hours unconfirmed |
| [Build submission checklist](../presentation/README.md) | Submission requirements and demo materials | Video, deck and thumbnail URLs are linked from the README |

The product and architecture drafts describe intended behavior separately from implemented features. The [AI20K technical guide](guide/chapter-01.md) is course material rather than project-specific progress.

The [spec index](specs/README.md) lists capability specifications. The dated baseline reports above should be read alongside the integration evidence below.

## Local MVP and integration evidence

- [Bàn giao agent và tối ưu ngữ cảnh trên khoa — 03/10](integration/agent-handoff-khoa-2026-10-03.md)
- [So sánh toàn bộ MVP gốc và bản sửa: 4 câu liên kết mới](../eval/original-mvp-followups-2026-10-03.md)
- [Domain agents theo mục tiêu: thay đổi và kiểm thử thật 03/10](integration/domain-missions-2026-10-03.md)
- [Đánh giá A/B sau thay đổi: cải thiện, chi phí và regression](../eval/domain-mission-quality-2026-10-03.md)

- [Bàn giao tích hợp MVP và sửa lỗi chat](integration/mvp-completion-2026-09-30.md)

- [MVP local: cài đặt, cấu trúc, demo và phục hồi](runbooks/local-mvp.md)
- [MVP local: bằng chứng kiểm thử và giới hạn](../eval/mvp-local-2026-09-30.md)

## Implementation references

- [Project organization](project-organization.md)
- Capability specifications: [`specs/`](specs/README.md)
- Architecture decisions: [`adr/`](adr/README.md)
- Architecture details: [`architecture/`](architecture/)
- [Agent graph design and implementation status](architecture/agent-graph.md)
- [Intake dùng LLM: thiết kế để implement](architecture/intake-llm.md)
- Subagent contract JSON Schema: [`api/agent-contract/`](api/agent-contract/)
- [Intake and Routing Orchestrator proposal](architecture/intake-and-routing-orchestrator.md)
- [Standalone Intake and Routing implementation](architecture/standalone-agent-services.md)
- [Run Intake and Routing separately](runbooks/agent-services.md)
- [Internal agent API contracts](api/agent-services.md)
- Integration contracts: [`api/`](api/)
- Operational runbooks: [`runbooks/`](runbooks/)
- [Shared observability, distributed tracing and Grafana alerts](runbooks/observability.md)
- [Moving containers and HTTP MCP](runbooks/moving-containers.md)
- [Moving Coolify handoff](runbooks/moving-coolify.md)
- [Standalone Intake and Routing staging handoff](runbooks/agent-services-staging.md)
- [Moving internal approval API](api/moving-internal-approvals.md)
- [Moving integration response and graph checklist](integration/moving-service-response.md)

The course material remains under `docs/guide/`. Project requirements and
architecture decisions must not be maintained inside the course guide.
