# Match Code Format

## Current Format: TZ-XXXX

**Format:** `TZ-` followed by 4 random alphanumeric characters
**Examples:** 
- TZ-A1B2
- TZ-5KL9
- TZ-WXYZ

**Length:** 7 characters total
**Case:** Insensitive (TZ-a1b2 = TZ-A1B2)

## Generation Algorithm

```
code = 'TZ-' + random(4, [A-Z0-9])
```

## Validation Regex

```
/^TZ-[A-Z0-9]{4}$/i
```

## Why This Format?

✅ Short & easy to remember
✅ Easy to type (7 chars vs 18 chars)
✅ No confusion with special characters
✅ Still provides ~1.7M possible codes (36^4)
✅ Matches Trazerr brand (TZ prefix)

## Storage

- Stored in `match_codes.code` as VARCHAR(7) UNIQUE
- Indexed for fast lookups
- Expires after 30 days if unused
