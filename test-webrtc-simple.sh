#!/bin/bash

echo "🧪 Quick WebRTC Test"
echo "==================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$(dirname "$0")"

# Test 1: Check if server file exists
echo "1️⃣  Checking files..."
if [ -f "server.webrtc.ts" ]; then
    echo -e "${GREEN}✅ server.webrtc.ts exists${NC}"
else
    echo -e "${RED}❌ server.webrtc.ts not found${NC}"
    exit 1
fi

# Test 2: Check dependencies
echo ""
echo "2️⃣  Checking dependencies..."
if npm list ws express cors 2>&1 | grep -q "ws@"; then
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️  Run: npm install${NC}"
fi

# Test 3: Try to start server (quick test)
echo ""
echo "3️⃣  Testing server startup..."
echo "   Starting server for 2 seconds..."
(npm run start:webrtc > /tmp/webrtc-test.log 2>&1 &)
SERVER_PID=$!
sleep 2
if ps -p $SERVER_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Server started successfully${NC}"
    kill $SERVER_PID 2>/dev/null
    echo "   Server logs:"
    tail -5 /tmp/webrtc-test.log 2>/dev/null | sed 's/^/   /'
else
    echo -e "${YELLOW}⚠️  Server may have issues. Check logs:${NC}"
    tail -10 /tmp/webrtc-test.log 2>/dev/null | sed 's/^/   /'
fi

echo ""
echo "==================="
echo -e "${GREEN}✅ Quick test completed!${NC}"
echo ""
echo "📋 To test fully:"
echo "   1. Start server: npm run dev:webrtc"
echo "   2. Open browser console and check for WebRTC support"
echo "   3. Connect mobile app (requires dev build)"

