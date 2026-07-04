.PHONY: dev db seed openapi install build stop verify-xero

install:
	pnpm install

db:
	docker compose up -d db

stop:
	docker compose down

# One command to bring the whole thing up (db + api + web)
dev: db
	pnpm dev

seed:
	pnpm seed

openapi:
	pnpm openapi

build:
	pnpm build

# Live Xero Custom Connection check (Gate G0)
verify-xero:
	cd api && npx tsx src/modules/xero/verify.ts
