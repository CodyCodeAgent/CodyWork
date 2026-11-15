# Unified conversation attachments

CodyWebCore owns byte storage (`/attachments`), provider transport, the native-text attachment manifest (`/composer`) and the opt-in Vue attachment picker/cards. CodyWork owns authentication, workspace/conversation ownership, metadata, download URLs and quotas. BotHub owns its existing routing and conversation identity. Files are never executed or extracted merely because they were uploaded.

## Current behavior

- Any filename extension / MIME type may be uploaded. Empty files are supported.
- Maximum 8 files per message, 20 MiB per file. CodyWork additionally limits stored attachments to 512 MiB per conversation.
- PNG/JPEG/WebP/GIF use the existing native image input. Other files use a structured native user-text manifest containing the actual server path and reading guidance.
- This is transport, not automatic parsing. PDF/Office/archives require appropriate tools in the executing Runtime. Unsupported formats remain downloadable; the agent must explain when it cannot parse them. No promise of OCR or automatic PDF extraction is made.
- Browser download routes resolve opaque IDs only within the requested workspace/conversation. Non-image files are forced downloads with nosniff, including when requested through the legacy image route.
- Native history is the durable source of truth for which files belong to a message. Only scoped file metadata is persisted in CodyWork (historical table name: `conversation_images`). History/live mapping removes local paths and restores authenticated download URLs. No second transcript is introduced.
- Same-conversation retries validate attachment IDs again. Explicit recovery into a new conversation copies generic files into the new scope; missing files block recovery instead of silently dropping them.
- Feishu current and quoted attachments use the shared stream storage and manifest; CodyWork imports them into conversation-owned storage. BotHub uses the same transport/manifest.

## Packaging

Core v0.44.0 contains the shared attachment implementation. Both product consumers pin that immutable release. CodyWork retains only its pre-existing Fast-mode package patch; attachments do not require a product-local Core patch. BotHub adopts the release directly.

## Verification scope

See the current E2E run report. Browser testing uses synthetic files and a disposable native-protocol fixture. It verifies delivery/persistence/UI, not real-model PDF understanding. Real Feishu messages require explicit authorization and a dedicated test app.
