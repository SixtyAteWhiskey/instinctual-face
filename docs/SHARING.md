# Portable template sharing

Instinctual Face share codes carry an entire declarative watch layout. They work between independent instances and offline installations; importing a code makes no requests to the sender's server. A link may put the same code in the current instance's URL fragment as `#share=...`. The fragment is read locally rather than used as a template download URL.

The browser previews the validated design before the user imports it as a new project. Names, display colors, positions, supported data elements, and editor settings are shared. The source project's ID and modification date are omitted. Decoding assigns a new project identity; element IDs are retained within that project.

## Code format

`IF1.<base64url payload>.<SHA-256 checksum>`

The payload is UTF-8 JSON containing exactly `version`, `name`, `device`, `background`, `elements`, and `settings`. Objects use keys sorted in ascending JavaScript string order, arrays preserve their order, primitive values use `JSON.stringify`, and there is no whitespace. The base64url representation has no padding. The checksum is 64 lowercase hexadecimal characters calculated over the payload bytes, without either envelope separator or prefix. This definition makes identical template data produce identical codes despite object key order.

Codes are limited to 64 KiB of text, decoded JSON to 32 KiB, and layouts to 100 elements. Codes are uncompressed to keep decoding bounded and portable on ordinary HTTP LAN servers. Large layouts may need fewer elements or shorter custom text.

## Validation and trust

The SHA-256 value detects changed or damaged data relative to the supplied checksum. It is not a digital signature, sender authentication, proof of authorship, or proof that a template is safe. Anyone can change a template and recalculate its checksum.

The import boundary supplies the protection: strict whitelists reject unknown project, element, and settings fields; prototype pollution keys are forbidden; required values and geometry are checked by the shared editor model; and only supported element types are accepted. Duplicate element IDs, malformed UTF-8/base64url, noncanonical or ambiguous JSON, and oversized payloads are rejected. Device and color rules come from the current model, including any supported AMOLED devices.

Share codes contain data only. The decoder never evaluates code, fetches external templates, imports scripts, accepts raw SVG, extracts archives, or follows file paths. Script-looking custom text remains literal text. The editor must continue to escape text when rendering HTML/SVG, and the Garmin exporter must continue to escape it when producing Monkey C strings. A future field or device must be explicitly supported by the schema before older instances will accept it.

Share codes are readable data, without encryption. Include only design content intended for recipients. A portable share code does not require a shared database, account, signing key, or access to another instance.

## Module API

`web/sharing.js` has no external dependencies and uses a pure JavaScript SHA-256 implementation, so Web Crypto is unnecessary on HTTP LAN origins.

- `await encodeShareCode(project)` validates a project and returns its share code.
- `await decodeShareCode(code)` validates the envelope, checksum, and schema, then returns a new model project. It does not save or execute it.
- `await inspectShareCode(code)` returns `{ project, name, device, elementCount, hash, codeLength }` for the import preview.
- `SHARE_CODE_LIMITS` exposes `{ codeLength, payloadBytes, elements }`.
- `validateDesignData(project)` applies the strict design schema without portable-code byte limits; the build API uses it before generating trusted source.

The instance gallery uses GET/POST `/api/templates` and stores validated code/metadata in `data/templates.json`. Templates deduplicate by their content hash, persist with serialized atomic writes, and are capped at 500 per instance. Browser cache holds up to 100. There is no external community service or recipient account requirement.

Tests compare generated checksums against Node's SHA-256 across many payload padding boundaries and cover round trips, Unicode, tampering, strict schema failures, prototype pollution, and size limits.
