ELECTRON := env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron
RUN_GUI := $(if $(DISPLAY)$(WAYLAND_DISPLAY),,xvfb-run -a)
DESKTOP_FILE := $(HOME)/.local/share/applications/story-editor.desktop
SANDBOX := node_modules/electron/dist/chrome-sandbox
DEPS := node_modules/electron/path.txt
SANDBOX_BLOCKED := [ "$$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] && [ "$$(stat -c '%u %a' $(SANDBOX))" != "0 4755" ]

.PHONY: help setup sandbox start check test smoke desktop clean

help:
	@echo "make setup    one time: install dependencies, fix the sandbox if needed"
	@echo "make start    open the editor (every time)"
	@echo "make desktop  add Story Editor to your app launcher"
	@echo "make test     run converter and video export tests"
	@echo "make smoke    launch, screenshot to out/smoke.png, quit"
	@echo "make clean    remove node_modules and out/ (then run make setup again)"

setup: $(DEPS)
	@if $(SANDBOX_BLOCKED); then \
		echo "Ubuntu 24.04+ blocks Chromium's default sandbox. Fixing the sandbox helper (asks for your sudo password)."; \
		sudo chown root:root $(SANDBOX) && sudo chmod 4755 $(SANDBOX); \
	fi
	@command -v ffmpeg >/dev/null || echo "Note: ffmpeg not found, video export will not work (sudo apt install ffmpeg)"
	@echo "Setup done. Start the app any time with: make start"

sandbox: setup

start: check
	$(ELECTRON) .

check:
	@[ -f $(DEPS) ] || { echo "Not set up yet. Run 'make setup' once, then 'make start'."; exit 1; }
	@if $(SANDBOX_BLOCKED); then echo "The sandbox needs a one-time fix. Run 'make setup' once, then 'make start'."; exit 1; fi

$(DEPS): package.json
	npm install --no-audit --no-fund --omit=optional
	node node_modules/electron/install.js
	@touch $@

test:
	node --test test/

smoke: check
	SMOKE=1 $(RUN_GUI) $(ELECTRON) .

desktop: check
	@mkdir -p $(dir $(DESKTOP_FILE))
	@printf '[Desktop Entry]\nType=Application\nName=Story Editor\nComment=Photo and video story editor\nExec=make -C "$(CURDIR)" start\nIcon=$(CURDIR)/src/icon.svg\nTerminal=false\nCategories=Graphics;AudioVideo;\n' > $(DESKTOP_FILE)
	@echo "Added $(DESKTOP_FILE). Find Story Editor in your app launcher."

clean:
	rm -rf node_modules out
