# Log Analysis Patterns for Confirmation Bug

## Regex Patterns to Find Affected Deals

### Pattern 1: Find deals that transitioned WAITING→SWAP at low confirmations

```regex
(?i)Deal\s+([a-f0-9]{32})\s+.*(?:entering WAITING|has confirmed locks.*transitioning to SWAP).*minConf[:\s]+([0-9]+)
```

### Pattern 2: Find lock check messages with minConf values

```regex
(?i)Calling checkLocks.*minConf[:\s]+(\d+)
```

### Pattern 3: Find stage transitions

```regex
(?i)updateStage|transitioning to|entering\s+(\w+)\s+stage
```

### Pattern 4: Find timer management messages

```regex
(?i)timer\s+(?:suspended|removed|cleared)
```

### Pattern 5: Find lock setting/clearing

```regex
(?i)Setting locks|Clearing.*locks|locks.*=\s+\{\}
```

## Expected Log Sequence (Correct Behavior)

```
[Engine] Processing deal d15edb162d273f4f7bdac8dfc2ffb91f in stage COLLECTION

[Engine] Lock check for Alice: minConf: 2, tradeLocked: true, commissionLocked: true

[Engine] Lock check for Bob: minConf: 2, tradeLocked: true, commissionLocked: true

[Engine] Setting locks for Alice in COLLECTION stage
[Engine] Setting locks for Bob in COLLECTION stage

[Engine] Both parties funded, transitioning to WAITING
[Engine] Deal d15edb162d273f4f7bdac8dfc2ffb91f entered WAITING stage - timer suspended

---

[Engine] Processing deal d15edb162d273f4f7bdac8dfc2ffb91f in stage WAITING

[Engine] Lock check for Alice: minConf: 6, tradeLocked: true, commissionLocked: true

[Engine] Lock check for Bob: minConf: 6, tradeLocked: true, commissionLocked: true

[Engine] Deal d15edb162d273f4f7bdac8dfc2ffb91f has confirmed locks, transitioning to SWAP stage

[Engine] Clearing timer PERMANENTLY for deal d15edb162d273f4f7bdac8dfc2ffb91f

[Engine] updateStage: d15edb162d273f4f7bdac8dfc2ffb91f WAITING→SWAP
```

## Expected Log Sequence (With Bug)

The buggy behavior would NOT show the "Lock check" messages in WAITING stage because it doesn't re-verify:

```
[Engine] Processing deal d15edb162d273f4f7bdac8dfc2ffb91f in stage COLLECTION

[Engine] Lock check for Alice: minConf: 2, tradeLocked: true, commissionLocked: true

[Engine] Lock check for Bob: minConf: 2, tradeLocked: true, commissionLocked: true

[Engine] Setting locks for Alice in COLLECTION stage
[Engine] Setting locks for Bob in COLLECTION stage

[Engine] Both parties funded, transitioning to WAITING
[Engine] Deal d15edb162d273f4f7bdac8dfc2ffb91f entered WAITING stage - timer suspended

---

[Engine] Processing deal d15edb162d273f4f7bdac8dfc2ffb91f in stage WAITING

[Engine] Deal d15edb162d273f4f7bdac8dfc2ffb91f in WAITING - checking lock status:
  sideALocked: true
  sideBLocked: true

[Engine] Deal d15edb162d273f4f7bdac8dfc2ffb91f has confirmed locks, transitioning to SWAP stage

[Engine] Clearing timer PERMANENTLY for deal d15edb162d273f4f7bdac8dfc2ffb91f

[Engine] updateStage: d15edb162d273f4f7bdac8dfc2ffb91f WAITING→SWAP

❌ NO "Lock check for Alice/Bob" with minConf: 6
❌ NO re-verification before WAITING→SWAP
```

## Queries to Run on Logs

### Find all WAITING→SWAP transitions:

```bash
grep -E "transitioning to SWAP|entering SWAP" /path/to/logs/*.log | \
  grep -oP "d[a-f0-9]{32}"
```

### For each deal ID, find the corresponding lock checks:

```bash
DEAL_ID="d15edb162d273f4f7bdac8dfc2ffb91f"

echo "=== Checking deal ${DEAL_ID} ==="

echo -e "\n1. When deal entered WAITING:"
grep -B5 "entered WAITING" /path/to/logs/*.log | grep "$DEAL_ID"

echo -e "\n2. Lock checks in WAITING stage (should have minConf: 6):"
grep "Lock check" /path/to/logs/*.log | grep "$DEAL_ID" | grep -A3 "minConf"

echo -e "\n3. When deal transitioned to SWAP:"
grep "transitioning to SWAP" /path/to/logs/*.log | grep "$DEAL_ID"

echo -e "\n4. Actual transaction submission times:"
grep -E "Broadcasting transaction|Submitted.*SWAP_PAYOUT" /path/to/logs/*.log | grep "$DEAL_ID"
```

### Count deals by minConf at transition:

```bash
grep -oP "minConf[:\s]+\K\d+" /path/to/logs/*.log | \
  sort | uniq -c | sort -rn
```

### Find deals with mismatched confirmations:

```bash
# Find deals that transitioned with minConf < 6
grep -E "transitioning to SWAP.*minConf[:\s]+[0-5]" /path/to/logs/*.log
```

## Database Query (SQLite)

Once database is available, query for affected deals:

```sql
-- Find deals that were in WAITING stage
SELECT
  d.id,
  d.stage,
  d.stageTx,
  d.stageTs,
  d.alice.chainId,
  d.bob.chainId
FROM deals d
WHERE d.stage IN ('SWAP', 'CLOSED', 'REVERTED')
  AND d.stageTx LIKE '%WAITING%'
ORDER BY d.stageTs DESC;

-- Check deposits for these deals
SELECT
  ed.dealId,
  ed.party,
  COUNT(*) as deposit_count,
  MIN(ed.confirms) as min_confirms,
  MAX(ed.confirms) as max_confirms
FROM escrow_deposits ed
WHERE ed.dealId = 'd15edb162d273f4f7bdac8dfc2ffb91f'
GROUP BY ed.dealId, ed.party;

-- Find deals with fewer than 6 confirmations at time of SWAP transition
SELECT
  ed.dealId,
  ed.party,
  ed.confirms,
  ed.blockHeight,
  d.stageTx
FROM escrow_deposits ed
JOIN deals d ON d.id = ed.dealId
WHERE d.stage = 'SWAP'
  AND ed.chainId = 'UNICITY'
  AND ed.confirms < 6
ORDER BY ed.dealId;
```

## Key Metrics to Monitor

### Current Production Status:

1. **Deals in WAITING stage**: How many are waiting for confirmations?
2. **Average confirmations at SWAP transition**: Should be >= 6 for UNICITY
3. **Minimum confirmations at SWAP transition**: Should be >= 6, not < 6

### After Fix Deployment:

1. **Deals with minConf: 6 in WAITING stage**: Should see explicit re-checks
2. **Transition times**: Should be longer (waiting for more confirmations)
3. **Failed early transitions**: Should see fewer premature WAITING→SWAP events

## Grafana Queries (if available)

```promql
# Count deals transitioning to SWAP per hour
increase(deals_stage_transition{from="WAITING", to="SWAP"}[1h])

# Average confirmations at transition
avg(deal_swap_confirmations{chain="UNICITY"})

# Distribution of confirmations at transition
histogram_quantile(0.95, deal_swap_confirmations{chain="UNICITY"})
```

## Manual Verification Steps

### Step 1: Find a deal ID from logs

```bash
grep "transitioned.*WAITING.*SWAP" /home/vrogojin/otc_agent/logs/*.log | head -1
# Output: ... Deal d15edb162d273f4f7bdac8dfc2ffb91f transitioned WAITING...
```

### Step 2: Extract timeline

```bash
DEAL_ID="d15edb162d273f4f7bdac8dfc2ffb91f"

echo "=== Timeline for $DEAL_ID ==="
grep "$DEAL_ID" /home/vrogojin/otc_agent/logs/*.log | \
  grep -E "CREATED|COLLECTION|WAITING|SWAP|Lock check|Setting locks|transitioning" | \
  head -20
```

### Step 3: Check for premature transitions

Look for:
- No "Lock check for Alice: minConf: 6" before WAITING→SWAP
- Locks already set when entering WAITING stage
- Immediate transition without re-verification

## Expected Output After Fix

```
T1: Lock check for Alice: minConf: 2, tradeLocked: true
T2: Setting locks for Alice in COLLECTION stage
T3: transitioning to WAITING (locks CLEARED)
T4: Lock check for Alice: minConf: 6, tradeLocked: false (only 3 confs)
T5: waiting for more confirmations
T6: [new cycle] Lock check for Alice: minConf: 6, tradeLocked: true (6 confs)
T7: transitioning to SWAP
```

Note: With the fix, locks are cleared at transition, so re-checking becomes necessary.

## Summary

The bug manifests as:
1. No "Lock check" messages with minConf: 6 in WAITING stage
2. Immediate transition from WAITING to SWAP after just being in WAITING
3. Confirmations at time of SWAP transaction < 6

After fix:
1. Explicit "Lock check" messages with minConf: 6 appear in WAITING stage
2. Deals wait for confirmations to accumulate
3. Confirmations at time of SWAP transaction >= 6
