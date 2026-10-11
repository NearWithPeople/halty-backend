# Docker workflow for halty-backend. Run `make` (or `make help`) for the list.

COMPOSE  := docker compose -f compose.dev.yaml
SERVICE  := strapi

.DEFAULT_GOAL := help

.PHONY: help env docker-build docker-up docker-down docker-restart docker-logs \
        docker-ps docker-shell docker-tsc docker-reset-db docker-clean

help: ## Show all targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

docker-build: env ## Build the dev image
	$(COMPOSE) build

docker-up: env ## Start Strapi on :1337
	$(COMPOSE) up --build

docker-logs: ## Tail the Strapi logs
	$(COMPOSE) logs -f --tail=200

docker-ps: ## Show container status
	$(COMPOSE) ps

docker-shell: ## Open a shell in the running container
	$(COMPOSE) exec $(SERVICE) sh

docker-reset-db: ## Delete ./.tmp/data.db and restart — bootstrap reseeds on next boot
	$(COMPOSE) down
	rm -f .tmp/data.db
	$(COMPOSE) up -d

docker-clean: ## Remove the container and the locally built image
	$(COMPOSE) down --rmi local --remove-orphans
