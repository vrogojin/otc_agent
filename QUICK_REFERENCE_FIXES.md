# Quick Reference: Production Fixes Applied

## Status: READY FOR DEPLOYMENT

---

## Issue 1: REORG Detection False Positives

### Problem
```
[REORG DETECTED] Deal fd4e9f35d6f7e67b66d5f2c1613f5b12 in WAITING but funds lost!
```

### Root Cause
Wrong confirmation threshold used in WAITING stage deposit checking

### Fix
**File:** `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts:474`

```typescript
// BEFORE (wrong):
const minConf = plugin.getConfirmationThreshold();

// AFTER (correct):
const minConf = plugin.getCollectConfirms();
```

### Status
✅ Code fix exists in commit `c2f2701`
✅ Fix is in source code
⏳ Needs service restart to deploy

### What to Look For
After restart, these should NOT appear:
- `[REORG DETECTED]` messages
- `[REORG]` messages about resuming timers

---

## Issue 2: BigInt Type Mixing Error

### Problem
```
TypeError: Cannot mix BigInt and other types, use explicit conversions
    at Array.reduce (<anonymous>)
    at UnicityPlugin.send
```

### Root Cause
Electrum returns JSON numbers, but code expects BigInt

### Fix Applied
**File:** `/home/vrogojin/otc_agent/packages/chains/src/UnicityPlugin.ts`

**Location 1 (Lines 354-364):**
```typescript
// Add explicit BigInt conversion
const utxos: UTXO[] = utxoResponse.map((utxo: any) => ({
  tx_hash: utxo.tx_hash,
  tx_pos: utxo.tx_pos,
  value: BigInt(utxo.value),  // ← CRITICAL
  height: utxo.height,
}));
```

**Location 2 (Lines 464-474):**
```typescript
// Same fix in send() method
const utxos: UTXO[] = utxoResponse.map((utxo: any) => ({
  tx_hash: utxo.tx_hash,
  tx_pos: utxo.tx_pos,
  value: BigInt(utxo.value),  // ← CRITICAL
  height: utxo.height,
}));
```

### Status
✅ Code fix applied
✅ Compiled successfully (`npm run build`)
✅ Verified in compiled output
⏳ Needs service restart to deploy

### Affected Queue Items
- `0b23899682c6004a6cbcd5ea473ab682` (will succeed after restart)
- `13a979f4083f34d43ec769d0b76c908b` (will succeed after restart)

---

## Deployment Instructions

### Step 1: Stop Current Service
```bash
pkill -f "node.*backend"
# or
systemctl stop otc-backend
```

### Step 2: Verify Fixes Are Compiled
```bash
# Check that build is recent
ls -lah packages/backend/dist/index.js
ls -lah packages/chains/dist/UnicityPlugin.js

# Should show dates like: Oct 31 19:53:xx
```

### Step 3: Start Service
```bash
npm run prod
# or
./run-prod.sh
# or
systemctl start otc-backend
```

### Step 4: Verify Fixes Are Loaded
```bash
# Watch logs for successful transactions
tail -f logs/otc-prod-*.log

# Look for these patterns (good):
# [UNICITY] Broadcasting transaction
# Sent X transactions, total Y ALPHA

# Should NOT see these (bad):
# [REORG DETECTED]
# Cannot mix BigInt
```

---

## Monitoring Checklist

### Immediately After Restart
- [ ] No error messages in first 30 seconds
- [ ] "listening on port" message appears
- [ ] "Engine starting" message appears
- [ ] No database errors

### Within First 5 Minutes
- [ ] No REORG detection errors
- [ ] No BigInt mixing errors
- [ ] Deal processing logs appear
- [ ] Queue items being processed

### Within First 30 Minutes
- [ ] Previous stuck queue items resolve
- [ ] Items `0b23899682c6004a6cbcd5ea473ab682` and `13a979f4083f34d43ec769d0b76c908b` show success
- [ ] New queue items processing normally

---

## Files Changed Summary

### Backend (REORG Fix)
```
packages/backend/src/engine/Engine.ts
  Line 474: Changed minConf threshold selection
  Status: Already compiled, in dist/
```

### Chains (BigInt Fix)
```
packages/chains/src/UnicityPlugin.ts
  Lines 354-364: Added UTXO BigInt conversion in listConfirmedDeposits()
  Lines 464-474: Added UTXO BigInt conversion in send()
  Status: Already compiled, verified in dist/UnicityPlugin.js
```

---

## Diagnostic Commands

### Check If Service Running Old Code
```bash
ps aux | grep backend
# Look at start time - if before Oct 31 19:53, running old code
```

### Check If Fixes Are in Compiled Code
```bash
# REORG fix
grep "getCollectConfirms()" packages/backend/dist/engine/Engine.js

# BigInt fix
grep "BigInt(utxo.value)" packages/chains/dist/UnicityPlugin.js
```

### Monitor for Errors in Real-time
```bash
tail -f logs/otc-prod-*.log | grep -E "ERROR|TypeError|REORG|BigInt"

# Better: watch for success
tail -f logs/otc-prod-*.log | grep "Broadcasting\|Sent.*transactions"
```

### Check Specific Queue Items
```bash
tail -f logs/otc-prod-*.log | grep -E "0b23899682c6004a6cbcd5ea473ab682|13a979f4083f34d43ec769d0b76c908b"
```

---

## Rollback Plan (If Needed)

If new issues appear after restart:

### Quick Rollback
```bash
pkill -f "node.*backend"
git checkout HEAD~1  # Go back to previous commit
npm run build
npm run prod
```

### Safe Rollback
```bash
pkill -f "node.*backend"
git log --oneline -10  # Find safe commit
git checkout <commit-hash>
npm run build
npm run prod
```

### Check What Changed
```bash
git diff c2f2701~1 c2f2701  # REORG fix
git diff HEAD~1 HEAD        # All recent changes
```

---

## Technical Details Quick Reference

### REORG Issue
- **Stage:** WAITING
- **Threshold:** Used `confirmations` instead of `collectConfirms`
- **Fix:** Use `plugin.getCollectConfirms()` based on stage
- **Impact:** False positive triggers deal reversion

### BigInt Issue
- **Location:** After Electrum JSON.parse()
- **Problem:** Number type vs BigInt type mismatch
- **Fix:** Explicit `BigInt(utxo.value)` conversion
- **Impact:** All Unicity transactions blocked

---

## Communication Template

### Incident Report
```
STATUS: Production Errors Identified and Fixed

Issue 1: REORG Detection False Positives
- Cause: Wrong confirmation threshold in WAITING stage
- Fix: Corrected minConf selection in Engine.ts
- Status: Fixed in code, awaiting deployment

Issue 2: BigInt Type Mixing
- Cause: Missing conversion at Electrum JSON boundary
- Fix: Added explicit BigInt conversion in UnicityPlugin.ts
- Status: Fixed and compiled, awaiting deployment

Action Required: Restart backend service
Expected Outcome: No REORG or BigInt errors after restart
```

---

## Success Indicators

### REORG Fix
- Deals progress COLLECTION → WAITING → SWAP without reversion
- No `[REORG DETECTED]` or `[REORG]` messages in logs
- `minConf` logs show appropriate threshold (e.g., 6 for Unicity)

### BigInt Fix
- Unicity queue items process without exceptions
- Transaction broadcasting succeeds
- Previous stuck items (`0b23899682c6004a6cbcd5ea473ab682`, etc.) complete
- No more "Cannot mix BigInt" errors

---

## Timeline

```
Oct 31 19:52:00 - Errors appear in logs (old code running)
Oct 31 19:53:03 - Code compiled with fixes
Oct 31 19:53:xx - READY for service restart
After restart   - Fixes active, errors should resolve
```

---

## Next Phase Actions

### After Successful Deployment (fixes working)
1. Verify no new errors in logs (24-48 hours)
2. Run integration tests
3. Document in postmortem
4. Add unit tests to prevent recurrence

### Preventive Measures
1. Add runtime type validation at JSON boundaries
2. Implement schema validation (zod/joi)
3. Add TypeScript strict mode
4. Create test cases for BigInt operations

---

**Ready to Deploy** ✅
**Restart Required** ⏳
**Build Verified** ✅
**Rollback Plan** ✅
