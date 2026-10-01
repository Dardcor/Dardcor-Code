SNAPSHOT_DIR ?= ../dardcor-code-snapshots
LABEL ?= manual

.PHONY: snapshot restore upstream-diff check-branding bench bench-record bench-verify

snapshot:
	@mkdir -p "$(SNAPSHOT_DIR)"
	@archive="$(SNAPSHOT_DIR)/dardcor-code-$(LABEL)-$$(date +%Y%m%d-%H%M%S).tar.gz"; \
	tar -czf "$$archive" \
		--exclude='dardcor-code/node_modules' \
		--exclude='dardcor-code/.next' \
		--exclude='dardcor-code/dist' \
		--exclude='dardcor-code/build' \
		--exclude='dardcor-code/graphify-out' \
		-C .. dardcor-code; \
	printf '%s\n' "$$archive"; \
	ls -1t "$(SNAPSHOT_DIR)"/dardcor-code-*.tar.gz 2>/dev/null | tail -n +21 | xargs -r rm -f

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
