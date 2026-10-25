# The conversion id is `hubspot-deal-<deal id>`

Every destination gets the same fixed id for a won deal: `hubspot-deal-<HubSpot deal id>`, sent as Meta's `event_id` and as Google's `transactionId`, and used as the `event_id` key of the sync log. It is built from the deal id alone, so a redelivered webhook or a retry produces the same id without any lookup. Changing the format later breaks dedup: rows already in the sync log no longer match, so every past deal would be claimed and sent again, and Google, which dedupes on `transactionId`, would count each one twice.
