# Shadow configuration example

`shadow.example.json` mirrors `DEFAULT_SHADOW_POLICY` for review and discussion.
The service does not load this file automatically. That is intentional: v0 has no
runtime configuration or live adapter, and the TypeScript policy is validated
before the demo runs.

The asset address and every limit are placeholders, not approved deployment
values. A production loader must validate a versioned schema, verify environment
and chain-specific asset identities, record the complete effective configuration
with each decision, and reject unknown keys. Copying this example into a live
environment is prohibited by the rollout gates.
