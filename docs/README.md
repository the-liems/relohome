# Project documentation

- [Bàn giao agent và tối ưu ngữ cảnh trên khoa — 03/10](integration/agent-handoff-khoa-2026-10-03.md)
- [So sánh toàn bộ MVP gốc và bản sửa: 4 câu liên kết mới](../eval/original-mvp-followups-2026-10-03.md)
- [Domain agents theo mục tiêu: thay đổi và kiểm thử thật 03/10](integration/domain-missions-2026-10-03.md)
- [Đánh giá A/B sau thay đổi: cải thiện, chi phí và regression](../eval/domain-mission-quality-2026-10-03.md)

- [Bàn giao tích hợp MVP và sửa lỗi chat](integration/mvp-completion-2026-09-30.md)

- [MVP local: cài đặt, cấu trúc, demo và phục hồi](runbooks/local-mvp.md)
- [MVP local: bằng chứng kiểm thử và giới hạn](../eval/mvp-local-2026-09-30.md)

## Product and delivery

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
- [Moving containers and HTTP MCP](runbooks/moving-containers.md)
- [Moving Coolify handoff](../deploy/coolify/staging/moving.md)
- [Moving internal approval API](api/moving-internal-approvals.md)
- [Moving integration response and graph checklist](integration/moving-service-response.md)

The course material remains under `docs/guide/`. Project requirements and
architecture decisions must not be maintained inside the course guide.
