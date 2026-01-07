# Etherscan API V2 Migration Summary

## Overview
Successfully migrated the OTC Broker Engine from deprecated Etherscan API V1 to the new V2 API. This migration resolves thousands of API errors caused by the V1 deprecation.

## Migration Date
2025-11-28

## Problem Statement
The application was encountering errors like:
```
Failed to fetch ERC20 transfers: Error: You are using a deprecated V1 endpoint, switch to Etherscan API V2
```

The old V1 API used chain-specific endpoints:
- Ethereum: `https://api.etherscan.io/api`
- Polygon: `https://api.polygonscan.com/api`
- BSC: `https://api.bscscan.com/api`
- Base: `https://api.basescan.org/api`
- Sepolia: `https://api-sepolia.etherscan.io/api`

## Solution
Migrated to Etherscan API V2 which uses:
- **Unified Endpoint**: `https://api.etherscan.io/v2/api` (works for all chains)
- **Chain Selection**: Via `chainid` parameter
- **Single API Key**: One ETHERSCAN_API_KEY works for all 60+ supported chains

## Changes Made

### 1. Core API Library
**File**: `/home/vrogojin/otc_agent/packages/chains/src/utils/EtherscanAPI.ts`

**Key Changes**:
- Updated base URL to `https://api.etherscan.io/v2/api`
- Added `chainIdNumber` property to store numeric chain IDs
- Added chain ID mapping:
  - Ethereum: 1
  - Sepolia: 11155111
  - Polygon: 137
  - Base: 8453
  - BSC: 56
- Updated all API methods to include `chainid` parameter:
  - `getTransactionsByAddress()`
  - `getERC20Transfers()`
  - `getTokenTransfers()`
  - `getInternalTransactions()`
  - `getERC20TransfersByTxHash()` (proxy module)
- Updated class documentation to reflect V2 API usage

### 2. Backend RPC Server
**File**: `/home/vrogojin/otc_agent/packages/backend/src/api/rpc-server.ts`

**Changes**:
- Updated transaction history fetching to use V2 API
- Changed from chain-specific URLs to unified endpoint with `chainid` parameter
- Added support for SEPOLIA and BSC chain IDs

### 3. Frontend HTML Pages
**Files**:
- `/home/vrogojin/otc_agent/bob-page.html`
- `/home/vrogojin/otc_agent/deal-page.html`

**Changes**:
- Updated embedded JavaScript to use V2 API
- Changed from chain-specific URLs to unified endpoint
- Added `chainid` parameter to all API calls

### 4. Environment Configuration
**File**: `/home/vrogojin/otc_agent/.env.example`

**Changes**:
- Added documentation explaining V2 API key usage
- Clarified that a single `ETHERSCAN_API_KEY` works for all chains
- Noted that chain-specific keys (`POLYGONSCAN_API_KEY`, etc.) are still supported for backward compatibility

## Chain ID Mapping

| Chain      | Internal ID | Etherscan Chain ID |
|------------|-------------|-------------------|
| Ethereum   | ETH         | 1                 |
| Sepolia    | SEPOLIA     | 11155111          |
| Polygon    | POLYGON     | 137               |
| Base       | BASE        | 8453              |
| BSC        | BSC         | 56                |

## Backward Compatibility

✅ **Fully Backward Compatible**
- Response format unchanged
- Existing error handling preserved
- Graceful fallback to RPC if API fails
- Environment variable structure unchanged
- Chain-specific API keys still supported

## Testing Performed

1. ✅ TypeScript compilation successful for all packages
2. ✅ Build process completed without errors
3. ✅ All API methods updated with `chainid` parameter
4. ✅ Error handling for deprecation messages retained

## Benefits of V2 API

1. **Single Endpoint**: No need to maintain multiple chain-specific URLs
2. **Unified API Key**: One key works across all 60+ supported chains
3. **Future-Proof**: Supports new chains automatically as Etherscan adds them
4. **Simplified Maintenance**: Less configuration required
5. **Cost Efficiency**: Single API key subscription instead of multiple

## Files Modified

1. `/home/vrogojin/otc_agent/packages/chains/src/utils/EtherscanAPI.ts` (43 lines changed)
2. `/home/vrogojin/otc_agent/packages/backend/src/api/rpc-server.ts` (24 lines changed)
3. `/home/vrogojin/otc_agent/bob-page.html` (24 lines changed)
4. `/home/vrogojin/otc_agent/deal-page.html` (24 lines changed)
5. `/home/vrogojin/otc_agent/.env.example` (5 lines added)

**Total**: 5 files modified, 120 lines changed (80 additions, 40 deletions)

## Configuration Notes

### For New Deployments
Set a single API key:
```bash
ETHERSCAN_API_KEY=YOUR_API_KEY_HERE
```

### For Existing Deployments
Both configurations work:
```bash
# Option 1: Single unified key (recommended)
ETHERSCAN_API_KEY=YOUR_API_KEY_HERE

# Option 2: Chain-specific keys (still supported)
ETHERSCAN_API_KEY=YOUR_ETH_KEY
POLYGONSCAN_API_KEY=YOUR_POLYGON_KEY
BSCSCAN_API_KEY=YOUR_BSC_KEY
```

## Migration Checklist

- ✅ Updated EtherscanAPI.ts class
- ✅ Updated backend RPC server
- ✅ Updated frontend HTML pages
- ✅ Updated .env.example documentation
- ✅ Added chain ID mapping for all supported chains
- ✅ Preserved backward compatibility
- ✅ TypeScript compilation successful
- ✅ Error handling preserved
- ✅ Documentation updated

## Potential Issues & Considerations

### API Rate Limits
- V2 API may have different rate limits than V1
- Consider implementing request throttling if rate limit errors occur

### API Key Requirements
- Some V2 endpoints may require an API key where V1 didn't
- Current implementation handles missing keys gracefully with RPC fallback

### Testing in Production
When deploying to production:
1. Monitor logs for any V2 API-related errors
2. Verify transaction history fetching works across all chains
3. Test ERC20 token transfer detection
4. Confirm internal transaction parsing still functions

### RPC Fallback
The code already includes robust RPC fallback mechanisms:
- If Etherscan API fails, the system falls back to direct RPC queries
- This ensures deposit detection continues even if API is unavailable

## Next Steps

1. **Deploy to staging** and verify functionality
2. **Monitor production logs** for any V2 API errors
3. **Update API key** if using chain-specific keys (optional migration to single key)
4. **Consider implementing request caching** to reduce API calls
5. **Update monitoring alerts** to detect V2-specific error patterns

## Reference Links

- [Etherscan API V2 Documentation](https://docs.etherscan.io/v/v2-api-documentation)
- [Etherscan Blog: API V2 Announcement](https://etherscan.io/apis)

## Conclusion

The migration to Etherscan API V2 is complete and backward compatible. All API calls now use the unified V2 endpoint with proper chain ID parameters. The system will no longer encounter V1 deprecation errors, and future chain additions will be automatic through the V2 API.
