# dsh-plug — catalog

Content lives in [wiki/](wiki/); how it is maintained is in [AGENTS.md](AGENTS.md). One line per
page: what it covers and when it was written. Code lives in [plugins/](plugins/) and is not
duplicated here.

## Plugins

- [provider-limits](wiki/plugins/provider-limits.md) — OpenCode Zen and GLM Coding Plan quotas
  plus the account balance as pills under the composer, next to cache hit and the context meter;
  the Host half serves a snapshot at `/plugin/provider-limits`, keys come from `credentials`; 2026-10-29.

- [mcp-manager](wiki/plugins/mcp-manager.md) — подключение любого MCP-сервера из GUI: список,
  добавление, правка, тест рукопожатием, вкл/выкл, удаление; состояние в оверлее
  `$DSH_HOME/mcp-manager/servers.json`; 29.10.

- [web-search-account](wiki/plugins/web-search-account.md) — провайдер веб-поиска на токене
  аккаунта DeepSeek: работает на любой модели, выбор через `web.searchProvider`; 29.10.

## DSH mechanics

- [Composer dock slot](wiki/harness/composer-dock.md) — `conversation.composer.dock`: the list of
  entries under the composer card, who renders it, and how to take a place beside the shipped
  pills; 2026-10-29.
