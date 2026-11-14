.PHONY: test preview

test:
	python3 -m unittest discover -s tests -v

preview:
	python3 scripts/preview.py
