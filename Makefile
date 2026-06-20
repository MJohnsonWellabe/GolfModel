# GolfModel — common tasks
# Usage: make <target> [SOURCE=sample|live] [EVENT=<event_id>]

PY ?= python
SOURCE ?= sample
EVENT ?=

.PHONY: help setup sample pipeline backtest test web-install web-dev web-build clean

help:
	@echo "Targets:"
	@echo "  setup        install python deps + generate sample data"
	@echo "  sample       (re)generate bundled synthetic sample data"
	@echo "  pipeline     run model -> docs/data/*.json   (SOURCE=sample|live)"
	@echo "  backtest     walk-forward backtest -> docs/data/backtest/*.json"
	@echo "  test         run pytest"
	@echo "  web-install  npm install for the React app"
	@echo "  web-dev      Vite dev server"
	@echo "  web-build    build React app into docs/"

setup:
	$(PY) -m pip install -r requirements.txt
	$(PY) -m pip install -e .
	$(PY) -m golfmodel.data.generate_sample

sample:
	$(PY) -m golfmodel.data.generate_sample

pipeline:
	$(PY) -m golfmodel run-pipeline --source $(SOURCE) $(if $(EVENT),--event $(EVENT),)

backtest:
	$(PY) -m golfmodel run-backtest --source $(SOURCE)

test:
	$(PY) -m pytest

web-install:
	cd web && npm install

web-dev:
	cd web && npm run dev

web-build:
	cd web && npm install && npm run build

clean:
	rm -rf data/raw data/interim
	rm -rf web/dist web/node_modules
