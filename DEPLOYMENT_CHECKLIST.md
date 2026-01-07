# Deployment Checklist - False REORG Detection Fix

## Pre-Deployment Verification

### Code Review
- [x] Root cause identified and documented
- [x] Fix applied to source code (Engine.ts lines 275-322)
- [x] TypeScript compilation successful (no errors)
- [x] Old problematic code removed from compiled output
- [x] New logic verified in compiled JavaScript
- [x] Comments explain the fix clearly

### Build Verification
```bash
npm run build
# Result: All packages compiled successfully
```

### Files Modified
- [x] `/home/vrogojin/otc_agent/packages/backend/src/engine/Engine.ts` - Source code fix
- [x] `/home/vrogojin/otc_agent/packages/backend/dist/engine/Engine.js` - Auto-compiled, verified

### Documentation Created
- [x] `EXECUTIVE_SUMMARY_REORG_FIX.md` - High-level overview
- [x] `FALSE_REORG_ROOT_CAUSE_ANALYSIS.md` - Detailed technical analysis
- [x] `REORG_FIX_FINAL_SUMMARY.md` - Complete summary with context
- [x] `CODE_CHANGE_DETAILS.md` - Line-by-line code changes
- [x] `TECHNICAL_DEEP_DIVE.md` - In-depth walkthrough of the issue
- [x] `DEPLOYMENT_CHECKLIST.md` - This file

---

## Pre-Deployment Testing (Recommended)

### Local Testing
- [ ] Run unit tests: `npm test --workspace=packages/backend`
- [ ] Check for TypeScript errors: `npm run typecheck`
- [ ] Run linter: `npm run lint`

### Staging Environment (if available)
- [ ] Deploy compiled code to staging
- [ ] Create test deal with fresh deposits
- [ ] Monitor logs for new "waiting for more confirmations" message
- [ ] Verify deal progresses normally once locks are ready
- [ ] Confirm no false "REORG DETECTED" messages appear

---

## Deployment Procedure

### Step 1: Stop Current Backend
```bash
# Stop the production server
# Method depends on your deployment setup

# Check if process is running:
ps aux | grep "node dist/index.js"

# Kill process (example):
kill <PID>

# Or use your systemd/systemctl:
systemctl stop otc-broker
```

### Step 2: Verify Build Artifacts
```bash
# Check that compiled files exist
ls -lh packages/backend/dist/engine/Engine.js

# Verify file size is reasonable (should be ~450KB+)
wc -l packages/backend/dist/engine/Engine.js
```

### Step 3: Deploy New Code
```bash
# Method depends on your deployment:
# Option A: Copy to production directory
cp -r packages/backend/dist/* /path/to/production/packages/backend/dist/

# Option B: Git-based deployment (if applicable)
git pull origin main
npm run build

# Option C: Container-based deployment
docker build -t otc-broker:latest .
docker run -d --name otc-broker -p 80:80 otc-broker:latest
```

### Step 4: Start Backend
```bash
# Start production server
npm run prod

# Or use systemd:
systemctl start otc-broker

# Verify it started:
sleep 2
curl http://localhost/rpc -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"otc.listDeals","params":{}}'
```

### Step 5: Monitor Initial Startup
```bash
# Watch logs for errors
tail -f logs/otc-prod-*.log

# Look for successful startup message:
# "[Engine] Initializing Tank Manager..."
# "HTTP server listening on port..."
```

---

## Post-Deployment Verification

### Immediate Checks (First 5 minutes)
- [ ] Backend started without errors
- [ ] HTTP server responding to requests
- [ ] JSON-RPC endpoint working
- [ ] No errors in logs related to deal processing

### Functional Checks (First 30 minutes)
- [ ] Database initialization successful
- [ ] Existing deals still in correct stages
- [ ] New deal creation works
- [ ] No unusual error patterns in logs

### Monitoring for the Fix (First 24 hours)
- [ ] Search logs for old "[REORG DETECTED]" message
  ```bash
  grep "[REORG DETECTED]" logs/*.log | head -10
  ```
  **Expected result:** No matches (if issue is truly fixed)

- [ ] Search logs for new confirmation message
  ```bash
  grep "waiting for more confirmations" logs/*.log | head -10
  ```
  **Expected result:** Messages appear instead of REORG errors

- [ ] Monitor deals in WAITING stage
  ```bash
  grep "in WAITING - checking lock status" logs/*.log | tail -20
  ```
  **Expected result:** Shows lock status (locked/pending) not balance checks

### Rollback Plan (if issues arise)

If problems occur after deployment:

1. **Identify the issue**
   ```bash
   tail -f logs/otc-prod-*.log
   grep -i error logs/otc-prod-*.log | tail -30
   ```

2. **Stop the service**
   ```bash
   systemctl stop otc-broker
   # or kill the process
   ```

3. **Revert to previous version**
   ```bash
   # Option A: Restore from backup
   cp -r /backup/packages/backend/dist/* packages/backend/dist/

   # Option B: Git revert
   git revert HEAD
   npm run build
   ```

4. **Restart and verify**
   ```bash
   npm run prod
   # Monitor logs for successful startup
   ```

5. **Report issue**
   - Document the error messages
   - Include relevant logs
   - Describe what was being tested when it failed

---

## Configuration Verification

### Confirm These Settings Are Still Correct
```
UNICITY_CONFIRMATIONS=2
UNICITY_COLLECT_CONFIRMS=2
ETH_CONFIRMATIONS=3
ETH_COLLECT_CONFIRMS=3
POLYGON_CONFIRMATIONS=2
POLYGON_COLLECT_CONFIRMS=2
```

### No Configuration Changes Needed
- This fix is purely logic-based
- No database migrations required
- No new environment variables needed
- All existing settings remain valid

---

## Testing Scenarios

### Scenario 1: Normal Deal Flow
1. Create deal with Alice (UNICITY) and Bob (POLYGON)
2. Fill party details
3. Send deposits to escrow addresses
4. Monitor stage transitions

**Expected result:**
- CREATED → COLLECTION → WAITING → SWAP → CLOSED
- No false REORG messages
- See "waiting for more confirmations" message in WAITING stage

### Scenario 2: Deposits with Mixed Confirmations
1. Create deal with Alice (UNICITY)
2. Send multiple small deposits in quick succession
3. Watch as earlier deposits get included when they reach threshold

**Expected result:**
- Deal stays in WAITING
- Progressively more UTXOs become locked
- Eventually all required funds locked
- Progress to SWAP

### Scenario 3: Single-Side Deposit
1. Create deal
2. Only one side deposits funds
3. Monitor timer in COLLECTION stage

**Expected result:**
- No false REORG errors
- Deal stays in COLLECTION, waiting for other side
- Timer counts down normally

---

## Success Criteria

### Deal Processing
- [ ] Deals move through stages normally
- [ ] WAITING stage no longer produces false REORG messages
- [ ] Confirmation accumulation happens naturally
- [ ] Locks set correctly when confirmations sufficient

### Logging
- [ ] "[REORG DETECTED]" errors gone (old error)
- [ ] "waiting for more confirmations" messages appear (new message)
- [ ] Lock status clearly logged in WAITING stage
- [ ] No TypeScript/JavaScript errors in logs

### Performance
- [ ] Deal processing still runs every 30 seconds
- [ ] No performance degradation
- [ ] Memory usage stable
- [ ] Database queries complete normally

---

## Monitoring Commands (Post-Deployment)

### Check Current Deals
```bash
sqlite3 data/otc-production.db "SELECT id, stage, createdAt FROM deals ORDER BY createdAt DESC LIMIT 10;"
```

### Count WAITING Stage Deals
```bash
sqlite3 data/otc-production.db "SELECT COUNT(*) FROM deals WHERE stage = 'WAITING';"
```

### Search for Specific Deal
```bash
sqlite3 data/otc-production.db "SELECT id, stage, createdAt, expiresAt FROM deals WHERE id LIKE '%c201a66d%';"
```

### Check Recent Errors
```bash
grep -i "error\|reorg" logs/otc-prod-*.log | tail -20
```

### Monitor Real-time Logs
```bash
tail -f logs/otc-prod-*.log | grep -E "\[Engine\]|\[REORG\]|waiting for|Error"
```

---

## Support / Troubleshooting

### Issue: Build Fails
- Ensure `npm install` was run recently
- Check Node.js version: `node --version` (need 18+)
- Clear cache: `npm run clean && npm install && npm run build`

### Issue: Backend Won't Start
- Check .env file has all required variables
- Verify database path is writable
- Check if port 80/8080 is already in use

### Issue: Deals Still Show REORG Errors
- Confirm new compiled code is actually deployed
- Check Engine.js file contains "waiting for more confirmations"
- Verify backend was fully restarted (not just reload)

### Issue: Deals Not Progressing
- Check lock status in logs
- Verify blockchain RPC endpoints are accessible
- Check deposit amounts are sufficient

---

## Documentation References

For detailed information, see:

1. **EXECUTIVE_SUMMARY_REORG_FIX.md**
   - High-level overview for decision makers

2. **FALSE_REORG_ROOT_CAUSE_ANALYSIS.md**
   - Detailed technical analysis with evidence

3. **CODE_CHANGE_DETAILS.md**
   - Line-by-line code changes

4. **TECHNICAL_DEEP_DIVE.md**
   - In-depth walkthrough of the issue and fix

5. **REORG_FIX_FINAL_SUMMARY.md**
   - Complete summary with configuration context

---

## Deployment Approval

- [ ] Code review completed
- [ ] Testing passed
- [ ] Documentation reviewed
- [ ] Rollback plan understood
- [ ] Monitoring configured
- [ ] Approval from release manager (if applicable)

---

## Deployment Completion Sign-Off

**Deployment Date:** _______________
**Deployed By:** _______________
**Verification Completed:** _______________
**Issues Encountered:** None [ ] / Details: _______________

**Post-Deployment Verification:**
- [ ] All success criteria met
- [ ] No regressions detected
- [ ] Users report normal operation
- [ ] False REORG errors eliminated

---

**End of Deployment Checklist**
