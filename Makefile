.PHONY: run check test setup

run:    ## jalankan server tanpa sudo
	./scripts/run.sh

check:  ## diagnosis metrik tanpa server/port
	./scripts/check.sh

test:   ## test frontend + backend
	./scripts/test.sh

setup:  ## buat venv + install dependency (butuh jaringan)
	./scripts/setup.sh
