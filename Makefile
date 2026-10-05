.PHONY: run ui ui-payment mcp-build mcp-up mcp-down test lint format typecheck check clean

# Mỗi MCP server là một thư mục src/mcp_servers/<tên>/ có Dockerfile riêng -> image/service <tên>-mcp
MCP_SERVERS := $(notdir $(patsubst %/Dockerfile,%,$(wildcard src/mcp_servers/*/Dockerfile)))
MCP_IMAGE_TAG ?= latest

run:
	uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

ui:
	streamlit run src/ui/flight_demo.py

ui-payment:
	streamlit run src/ui/payment_demo.py --server.port 8502

mcp-build:
	@for s in $(MCP_SERVERS); do \
		echo "==> build $$s-mcp"; \
		docker build -f src/mcp_servers/$$s/Dockerfile -t $$s-mcp:$(MCP_IMAGE_TAG) . || exit 1; \
	done

mcp-up:
	docker compose up -d --build $(addsuffix -mcp,$(MCP_SERVERS))

mcp-down:
	docker compose down

test:
	pytest tests/ -v

lint:
	ruff check src/ tests/

format:
	ruff format src/ tests/

typecheck:
	mypy src/

check: lint format test

clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type d -name .pytest_cache -exec rm -rf {} +
	find . -type d -name .ruff_cache -exec rm -rf {} +
