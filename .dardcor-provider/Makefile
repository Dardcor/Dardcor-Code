SNAPSHOT_DIR ?= ../miawrouter-snapshots
LABEL ?= manual

.PHONY: snapshot restore upstream-diff check-branding bench bench-record bench-verify

snapshot:
	@mkdir -p "$(SNAPSHOT_DIR)"
	@archive="$(SNAPSHOT_DIR)/miawrouter-$(LABEL)-$$(date +%Y%m%d-%H%M%S).tar.gz"; \
	tar -czf "$$archive" \
		--exclude='miawrouter/node_modules' \
		--exclude='miawrouter/.next' \
		--exclude='miawrouter/dist' \
		--exclude='miawrouter/build' \
		--exclude='miawrouter/graphify-out' \
		-C .. miawrouter; \
	printf '%s\n' "$$archive"; \
	ls -1t "$(SNAPSHOT_DIR)"/miawrouter-*.tar.gz 2>/dev/null | tail -n +21 | xargs -r rm -f

restore:
	@test -n "$(SNAP)" || { printf '%s\n' 'Usage: make restore SNAP=<archive>'; exit 2; }
	@test -f "$(SNAP)" || { printf '%s\n' 'Snapshot not found: $(SNAP)'; exit 2; }
	@tar -tzf "$(SNAP)" >/dev/null
	@tar -xzf "$(SNAP)" -C ..

upstream-diff:
	node scripts/upstream-diff.mjs

check-branding:
	node scripts/check-branding.mjs

bench:
	node bench/run.mjs

bench-record:
	node bench/run.mjs --record-baseline

bench-verify:
	node bench/run.mjs --verify bench/out/baseline.json
