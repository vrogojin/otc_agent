# Vesting Classification Business Logic - Executive Summary

## The Issue

**Scenario:** User deposits UNVESTED ALPHA to a deal requiring ALPHA_VESTED
**Current Result:** Funds disappear - deal shows 0 deposited, money stuck in escrow
**Root Cause:** Wrong-type deposits are filtered out at detection and never tracked

---

## Answer to Your Questions

### 1. Is this correct behavior? Should unvested deposits be rejected for a vested-only deal?

**YES - Rejection is correct from a business logic standpoint**

The vesting requirement is a hard constraint that likely exists for:
- Regulatory/compliance reasons (vested vs unvested may have different legal status)
- Economic reasons (different market values)
- Protocol rules (Unicity network vesting schedules)

**If a deal requires ALPHA_VESTED (blocks ≤ 280,000), it MUST NOT accept UNVESTED deposits.**

**However, the silent failure is NOT acceptable.**

---

### 2. What should happen when someone deposits the wrong vesting type?

**Current Behavior (Bad):**
```
✗ Deposit filtered out during detection
✗ Never stored in database
✗ No user notification
✗ No refund mechanism
✗ Permanent fund loss risk
✗ User confusion: "Where are my funds?"
```

**Recommended Behavior (Good):**
```
✓ Store deposit with vesting metadata
✓ Tag as "wrong type" (matchesRequiredVesting = false)
✓ Send email notification to user
✓ Show in UI: "0.1003 ALPHA deposited (wrong type - will be refunded)"
✓ Automatic refund when deal expires/reverts
✓ No fund loss risk
✓ Clear user feedback
```

---

### 3. From a UX perspective, what's the expected behavior?

**User Mental Model:**
```
"I deposited 0.1003 ALPHA"
  ↓
"System should acknowledge my deposit"
  ↓
"If there's a problem, tell me what and how to fix it"
  ↓
"Give me my money back if I can't proceed"
```

**Expected System Behavior:**
1. **Detect and acknowledge ALL deposits** (even wrong-type)
2. **Notify user immediately** if deposit doesn't meet requirements
3. **Show clear status** - what's deposited vs what's needed
4. **Provide safe recovery** - automatic refund on deal expiry
5. **Suggest next steps** - "Deposit vested ALPHA" or "Wait for refund"

---

## Technical Analysis

### Current Flow
```
User deposits UNVESTED ALPHA
  ↓
listConfirmedDeposits() fetches UTXOs
  ↓
VestingTracer classifies as 'unvested'
  ↓
parseVestingFilter('ALPHA_VESTED') = 'vested'
  ↓
unvested ≠ vested → SKIP deposit
  ↓
Return empty deposits array
  ↓
Nothing stored in database
  ↓
Deal shows 0 deposited
  ↓
Funds lost forever 💀
```

### Recommended Flow
```
User deposits UNVESTED ALPHA
  ↓
listConfirmedDeposits() fetches UTXOs
  ↓
VestingTracer classifies as 'unvested'
  ↓
parseVestingFilter('ALPHA_VESTED') = 'vested'
  ↓
unvested ≠ vested → TAG as matchesRequiredVesting = false
  ↓
Store in database with metadata
  ↓
checkLocks() separates matching vs wrong-type deposits
  ↓
Send notification: "Wrong type deposited, will refund"
  ↓
Deal shows: "0 vested / 0.1003 ALPHA (wrong type)"
  ↓
On expiry → Automatic refund
  ↓
User gets money back safely ✓
```

---

## Implementation Recommendation

### Option A: Track + Notify + Refund (RECOMMENDED)

**Changes Required:**

1. **UnicityPlugin.ts** - Store all deposits with vesting flag
   ```typescript
   // Don't filter, just tag
   deposits.push({
     ...deposit,
     vestingStatus: classification.status,
     matchesRequiredVesting: classification.status === vestingFilter || vestingFilter === null,
   });
   ```

2. **invariants.ts** - Separate matching vs wrong-type in lock checking
   ```typescript
   const tradeDeposits = eligible.filter(d =>
     d.asset === tradeAsset && d.matchesRequiredVesting !== false
   );
   const wrongTypeDeposits = eligible.filter(d =>
     d.asset === tradeAsset && d.matchesRequiredVesting === false
   );
   ```

3. **Engine.ts** - Notify user about wrong-type deposits
   ```typescript
   if (locks.wrongTypeDeposits.length > 0) {
     await notificationService.send({
       type: 'WRONG_VESTING_TYPE',
       message: `You deposited ${amount} UNVESTED ALPHA, but deal requires VESTED...`
     });
   }
   ```

4. **RecoveryManager.ts** - Refund wrong-type deposits on expiry
   ```typescript
   const allDeposits = depositRepo.getByDeal(dealId); // Including wrong-type
   for (const deposit of allDeposits) {
     if (deposit.matchesRequiredVesting === false) {
       queueRefund(deposit);
     }
   }
   ```

**Effort Estimate:** 2-3 days
- Backend changes: 1 day
- Notifications: 0.5 day
- Frontend UI: 0.5 day
- Testing: 1 day

**Benefits:**
- ✓ No fund loss risk
- ✓ Clear user feedback
- ✓ Automatic safe recovery
- ✓ Maintains vesting enforcement
- ✓ Professional UX

---

## Alternative Options (Not Recommended)

### Option B: Accept Any Vesting Type
- **Pros:** Simple, no UX issues
- **Cons:** Defeats purpose of vesting requirements, may violate compliance
- **Verdict:** ❌ Not acceptable if vesting has legal/regulatory significance

### Option C: Automatic On-Chain Conversion
- **Idea:** Accept wrong type, swap on DEX
- **Cons:** Complex, fees, slippage, not worth it
- **Verdict:** ❌ Too complex

### Option D: Frontend Validation Only
- **Idea:** Check wallet before deposit, warn user
- **Pros:** Prevents problem proactively
- **Cons:** Can't prevent external deposits, needs backend fallback
- **Verdict:** ✓ Good addition to Option A (defense in depth)

---

## Database Changes

```sql
-- Add vesting tracking to escrow_deposits
ALTER TABLE escrow_deposits ADD COLUMN matches_required_vesting BOOLEAN DEFAULT NULL;
ALTER TABLE escrow_deposits ADD COLUMN vesting_status TEXT;
ALTER TABLE escrow_deposits ADD COLUMN coinbase_block_height INTEGER;

-- Index for wrong-type queries
CREATE INDEX idx_wrong_vesting ON escrow_deposits(dealId, matches_required_vesting)
  WHERE matches_required_vesting = FALSE;
```

---

## Key Metrics to Track

Post-implementation, monitor:
- **Wrong-type deposit rate** - How often users make this mistake
- **Notification delivery rate** - Are emails reaching users
- **Refund success rate** - Are wrong-type deposits being refunded
- **Time to refund** - How long until user gets money back
- **User confusion rate** - Support tickets about vesting

---

## Documentation Needed

1. **User Guide**: "What is ALPHA vesting?"
   - Explain vested vs unvested
   - How to check your UTXO vesting status
   - What happens if you deposit wrong type

2. **Error Messages**: Clear, actionable
   - "Wrong vesting type deposited"
   - "Your ALPHA is UNVESTED (from block 299,468 > threshold 280,000)"
   - "Required: VESTED ALPHA (blocks ≤ 280,000)"
   - "Next steps: Deposit vested ALPHA or wait for automatic refund on deal expiry"

3. **Support Runbook**: For operators
   - How to identify wrong-type deposits
   - How to manually trigger refunds if needed
   - How to check vesting status of UTXOs

---

## Conclusion

**Current behavior is technically correct (rejects wrong-type deposits) but creates terrible UX with fund loss risk.**

**Recommended path forward:**
1. Implement Option A (Track + Notify + Refund)
2. Add frontend validation as defense in depth (Option D)
3. Monitor metrics and iterate on UX
4. Document thoroughly for users and support

**This provides:**
- ✓ Correct vesting enforcement (business requirement)
- ✓ Safe fund recovery (no loss risk)
- ✓ Clear user communication (good UX)
- ✓ Professional error handling (production-ready)

**Investment:** 2-3 days development + 1 day testing = **3-4 days total**

**ROI:** Prevents fund loss, reduces support burden, improves user trust

---

## Files to Review

- `/home/vrogojin/otc_agent/VESTING_BUSINESS_LOGIC_ANALYSIS.md` - Detailed technical analysis
- `/home/vrogojin/otc_agent/VESTING_FLOW_COMPARISON.md` - Visual flow diagrams (current vs recommended)
- `/home/vrogojin/otc_agent/VESTING_CLASSIFICATION_ANALYSIS.md` - Original investigation showing code is working correctly
- `/home/vrogojin/otc_agent/packages/chains/src/UnicityPlugin.ts` - Lines 428-439 (filtering logic)
- `/home/vrogojin/otc_agent/packages/core/src/invariants.ts` - Lines 145-157 (lock checking)
- `/home/vrogojin/otc_agent/ref_materials/VESTING_CLASSIFICATION_BACKEND.md` - Original requirements
