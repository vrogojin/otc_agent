#!/bin/bash
# Run backend on port 8080 to avoid permission issues
export PORT=8080
export BASE_URL=http://213.199.61.236:8080
npm run dev --workspace=packages/backend
