SHELL := /bin/bash

# Load .env (bot token, admin ID) when present.
ifneq (,$(wildcard .env))
include .env
export
endif
export DATABASE_URL ?= postgres://herbot:herbot@127.0.0.1:5433/herbot

.PHONY: help db-up db-down db-reset run test check fmt lint smoke

help: ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

db-up: ## Start Postgres and wait until it is healthy
	docker compose up -d --wait postgres

db-down: ## Stop Postgres (keeps data)
	docker compose down

db-reset: ## Stop Postgres and delete its data
	docker compose down -v

run: db-up ## Run herbot-core locally (pretty logs)
	HERBOT_LOG_FORMAT=pretty cargo run -p herbot-core

test: db-up ## Run every test (unit + integration against Postgres)
	cargo test --workspace

check: fmt lint test ## Everything CI would run

fmt: ## Check formatting
	cargo fmt --all --check

lint: ## Clippy with warnings as errors
	cargo clippy --workspace --all-targets -- -D warnings

smoke: db-up ## Start the real binary, hit /health and /ready, stop it
	./scripts/smoke.sh
