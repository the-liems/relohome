# GitHub work in progress — 2026-09-30

This is a planning snapshot of branch work and merged repository changes. Service and agent implementation entries describe work in progress; merged documentation and CI changes are labeled separately. An issue's checked boxes or test counts describe work reported on a branch; they do not establish that the feature is merged, deployed, or working end to end from the current checkout. Recheck the linked issue or PR before using this snapshot for a demo claim.

Last verified: 2026-09-30. Check the live [issues](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues), [pull requests](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pulls), and [milestones](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/milestones) for subsequent changes.

## Product direction visible in the issues

The intended relocation flow connects Location/Housing, Moving, Flight, and Payment through a LangGraph agent. The [agent demo issue](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/21) calls for a real chat flow across those services rather than a hard-coded script. It narrows the **moving-service leg** of the MVP to trips within one city and plans a mock Payment button for the demo. A customer may still be relocating from elsewhere; the issue does not define the full customer base. The city, exact request, and end-to-end acceptance result are still open. Names used inside issues and branches are not treated as an approved product name.

## Service and integration map

| Area | Reported branch work | Open integration or delivery gap |
|---|---|---|
| Location and housing | [#7](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/7) reports map/location MCP tools and routing; [#6](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/6) reports housing query contracts and tools on `QuangDung`. | Real housing listings have not been imported; source approval, ingestion, deployment, and graph integration remain open. |
| Housing recommendations | [#2](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/2) proposes a shared housing-data contract; [#3](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/3) proposes an LLM ordering tool. | Both issues are open and should not be described as available product behavior. |
| Moving | [#9](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/9) reports an AhaMove staging adapter, 13 MCP tools, containers, and read-only staging checks on `khoa`. | End-to-end order creation remains gated; [#16](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/16) tracks the approval registration bridge, and the issue calls for quote and webhook verification. |
| Flight | [#10](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/10) reports SerpApi flight search plus mock booking and a demo UI on `Doan/api-plane-ticket`. | Booking is simulated; [#17](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/17) tracks HTTP MCP authentication and read/write token separation. |
| Payment | [#11](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/11) reports a mock gateway and ZaloPay sandbox work on `Doan/api`. | Full sandbox paid/refund lifecycle, payment-to-ticket linkage, and HTTP MCP authentication remain open ([#11](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/11), [#17](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/17)). |
| Agent graph | [#12](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/12) covers intake; [#13](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/13) covers planning, DAG execution, and change impact; [#18](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/18) covers domain subagents. [PR #15](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/15) is open against `main`. | [#21](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/21) lists work for a full chat demo; [#19](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/19) tracks durable checkpoints, approvals, private data, and authentication. [#20](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/20) tracks ADR reconciliation before merge. |

The graph issues distinguish the **LangGraph conversation/workflow state machine** from the **dependency DAG of service tasks**. Independent tasks may run in parallel; downstream tasks must wait for their inputs. The proposal also separates read-only domain subagents from deterministic write actions that require approval. These are design and branch-integration boundaries, not behavior of the starter graph in the current checkout.

## Pull requests and delivery

- [PR #15](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/15), “intake and Ochestrator,” is open and contains broad branch changes. Its PR body is mostly an unfilled template, so the linked issues and branch documentation provide the clearer scope.
- [PR #14](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/14) merged on 2026-09-30 as `93a7eff`, configuring the team-44 self-hosted CI runner.
- [PR #5](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/5) proposes Coolify-first delivery and later infrastructure migration paths; it explicitly describes plans rather than provisioned infrastructure.
- [PR #4](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/4), the project-organization guide, is merged.

## What this means for the docs

The root checkout still has the starter FastAPI/two-node graph described in [ARCHITECTURE.md](../ARCHITECTURE.md). Service and agent work reported above is distributed across open issues, branches, and PRs. Update the implementation sections of the README and architecture only after integration is merged and verified in the target branch. Keep measured results in the [evaluation report](../eval/results/report.md) with commands, environment, and commit or image identifiers.
