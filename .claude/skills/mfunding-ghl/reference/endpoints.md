# GHL endpoint quick reference

Base URL: `https://services.leadconnectorhq.com` · Header `Version: 2021-07-28` (handled by `ghl.sh`).
Location ID: `oz7lUMPyBYhMQrN5arpq` (use as `locationId` query param on lists, in body on writes).

## Contacts
| Action | Method | Path |
|---|---|---|
| List | GET | `/contacts/?locationId={loc}&limit=20` |
| Search | POST | `/contacts/search` body `{"locationId":"{loc}","query":"...","pageLimit":20}` |
| Get one | GET | `/contacts/{contactId}` |
| Create | POST | `/contacts/` body `{"locationId":"{loc}", ...}` |
| Update | PUT | `/contacts/{contactId}` body `{ ...fields }` |
| Delete | DELETE | `/contacts/{contactId}` |
| Add tags | POST | `/contacts/{contactId}/tags` body `{"tags":["a","b"]}` |
| Remove tags | DELETE | `/contacts/{contactId}/tags` body `{"tags":["a"]}` |
| Tasks | GET/POST | `/contacts/{contactId}/tasks` |
| Add to workflow | POST | `/contacts/{contactId}/workflow/{workflowId}` |

## Opportunities & Pipelines
| Action | Method | Path |
|---|---|---|
| List pipelines | GET | `/opportunities/pipelines?locationId={loc}` |
| Search opps | GET | `/opportunities/search?location_id={loc}&limit=20` |
| Get opp | GET | `/opportunities/{opportunityId}` |
| Create opp | POST | `/opportunities/` body `{"locationId":"{loc}","pipelineId":"...","pipelineStageId":"...","name":"...","contactId":"..."}` |
| Update opp | PUT | `/opportunities/{opportunityId}` |
| Update status | PUT | `/opportunities/{opportunityId}/status` body `{"status":"won"}` |

## Conversations / messaging
| Action | Method | Path |
|---|---|---|
| Search conversations | GET | `/conversations/search?locationId={loc}` |
| Get messages | GET | `/conversations/{conversationId}/messages` |
| Send message | POST | `/conversations/messages` body `{"type":"SMS","contactId":"...","message":"..."}` (type: SMS, Email, WhatsApp, etc.) |

## Calendars / appointments
| Action | Method | Path |
|---|---|---|
| List calendars | GET | `/calendars/?locationId={loc}` |
| Free slots | GET | `/calendars/{calendarId}/free-slots?startDate={ms}&endDate={ms}` |
| Get events | GET | `/calendars/events?locationId={loc}&calendarId=...&startTime=...&endTime=...` |
| Book appointment | POST | `/calendars/events/appointments` body `{"calendarId":"...","locationId":"{loc}","contactId":"...","startTime":"ISO8601"}` |

## Account structure (fetch IDs before writes)
| Action | Method | Path |
|---|---|---|
| Location detail | GET | `/locations/{loc}` |
| Custom fields | GET | `/locations/{loc}/customFields` |
| Tags | GET | `/locations/{loc}/tags` |
| Users | GET | `/users/?locationId={loc}` |
| Workflows | GET | `/workflows/?locationId={loc}` |

Notes:
- Some search endpoints use `location_id` (snake) vs `locationId` (camel). If one returns a 422, try the other.
- Timestamps for calendars are epoch **milliseconds**; appointment times are ISO 8601 with timezone (account TZ: `America/New_York`).
- List responses include a `meta` object with pagination cursors; pass `startAfter`/`startAfterId` to page.
