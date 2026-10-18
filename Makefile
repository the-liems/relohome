.PHONY: run ui ui-payment mcp-build mcp-up mcp-down test lint format typecheck check clean

# Mỗi MCP server là một thư mục apps/<tên>-mcp/ có Dockerfile riêng -> image/service <tên>-mcp
MCP_SERVERS := $(patsubst %-mcp,%,$(notdir $(patsubst %/Dockerfile,%,$(foreach app,$(wildcard apps/*-mcp/pyproject.toml),$(wildcard $(dir $(app))Dockerfile)))))
MCP_IMAGE_TAG ?= latest

run:
	npm run dev:agent

# Installed ReloHome demos; keep .env.local, runtime root, cwd and default ports.
ui:
	npm run dev:flight-demo

ui-payment:
	npm run dev:payment-demo

mcp-build:
	@for s in $(MCP_SERVERS); do \
		echo "==> build $$s-mcp"; \
		docker buildx build --load -f apps/$$s-mcp/Dockerfile -t $$s-mcp:$(MCP_IMAGE_TAG) . || exit 1; \
	done

mcp-up:
	docker compose --env-file .env.local up -d --build $(addsuffix -mcp,$(MCP_SERVERS))

mcp-down:
	docker compose --env-file .env.local down

test:
	npm test

lint:
	npm run lint

format:
	npm run format

typecheck:
	npm run typecheck

check: lint format-check test

clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type d -name .pytest_cache -exec rm -rf {} +
	find . -type d -name .ruff_cache -exec rm -rf {} +

.PHONY: install
install:
	npm run setup

.PHONY: build
build:
	npm run build

.PHONY: format-check
format-check:
	npm run format:check

.PHONY: test-python
test-python:
	npm run test:python

.PHONY: test-ts
test-ts:
	npm run test:ts

.PHONY: test-browser
test-browser:
	npm run test:browser

.PHONY: test-map
test-map:
	npm run test:map

.PHONY: test-integration
test-integration:
	npm run test:integration

.PHONY: test-live
test-live:
	npm run test:live -- $(SUITE)

.PHONY: image-check
image-check:
	npm run image:check

.PHONY: deployment-check
deployment-check:
	npm run deployment:check

.PHONY: web
web:
	npm run dev:web

.PHONY: map
map:
	npm run dev:map

.PHONY: gateway
gateway:
	npm run dev:gateway

.PHONY: ui-agent-chat
ui-agent-chat:
	npm run dev:agent-chat

.PHONY: ui-location ui-location-tools
ui-location:
	npm run dev:location-demo

ui-location-tools:
	npm run dev:location-tool-lab
