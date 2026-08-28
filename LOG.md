2026-08-28 — n8n media upload lane

- Added the Media Upload and Get Status operations against the merged core REST contract.
- Kept binary bytes off the Postdom API and kept the Postdom credential off the signed storage PUT.
- Added bounded status polling with exact pending, stored, and failed outcomes; upload URLs never enter node output.
- Extended Publish Video with an exactly-one URL-or-handle source while retaining the legacy URL template.
- Prepared `n8n-nodes-postdom@0.2.0` for individual audit; marketplace publication remains held.
