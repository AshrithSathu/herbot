SHELL := /bin/bash

# Load .env (bot token, admin ID) when present.
ifneq (,$(wildcard .env))
include .env
export
endif
export DATABASE_URL ?= postgres://herbot:herbot@127.0.0.1:5433/herbot

.PHONY: help db-up db-down db-reset run test test-voice check fmt lint smoke

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

test-voice: ## Real OpenAI transcription of spoken English (needs OPENAI_API_KEY, macOS say, ffmpeg)
	cargo test -p herbot-core --lib voice::tests::real_openai -- --ignored --nocapture

check: fmt lint test ## Everything CI would run

fmt: ## Check formatting
	cargo fmt --all --check

lint: ## Clippy with warnings as errors
	cargo clippy --workspace --all-targets -- -D warnings

smoke: db-up ## Start the real binary, hit /health and /ready, stop it
	./scripts/smoke.sh
