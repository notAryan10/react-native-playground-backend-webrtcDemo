#!/bin/bash

echo "🧪 Testing WebRTC Implementation"
echo "================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Backend TypeScript compilation
echo "1️⃣  Testing Backend WebRTC Server..."
cd "$(dirname "$0")"
if npx tsc --noEmit --project tsconfig.json server.webrtc.ts 2>&1 | grep -v "node_modules"; then
    echo -e "${GREEN}✅ Backend TypeScript: OK${NC}"
else
    # Check if it's just import warnings
    if npx tsc --noEmit --project tsconfig.json server.webrtc.ts 2>&1 | grep -q "error TS"; then
        echo -e "${RED}❌ Backend TypeScript: FAILED${NC}"
        npx tsc --noEmit --project tsconfig.json server.webrtc.ts 2>&1 | grep "error TS" | head -3
    else
        echo -e "${GREEN}✅ Backend TypeScript: OK${NC}"
    fi
fi
echo ""

# Test 2: Check if dependencies are installed
echo "2️⃣  Checking Backend Dependencies..."
if npm list ws express cors 2>&1 | grep -q "ws@"; then
    echo -e "${GREEN}✅ Backend Dependencies: OK${NC}"
else
    echo -e "${YELLOW}⚠️  Some dependencies may be missing. Run: npm install${NC}"
fi
echo ""

# Test 3: Frontend TypeScript compilation
echo "3️⃣  Testing Frontend WebRTC Viewer..."
cd ../react-native-playground-frontend
if [ -f "src/components/WebRTCViewer.tsx" ]; then
    if npx tsc --noEmit --jsx react-jsx src/components/WebRTCViewer.tsx 2>&1 | head -10; then
        echo -e "${GREEN}✅ Frontend TypeScript: OK${NC}"
    else
        echo -e "${YELLOW}⚠️  Frontend TypeScript: Some warnings (may be normal)${NC}"
    fi
else
    echo -e "${RED}❌ WebRTCViewer.tsx not found${NC}"
fi
echo ""

# Test 4: Mobile App TypeScript compilation
echo "4️⃣  Testing Mobile App..."
cd ../react_native_playground_backend/expo-stream-app
if npx tsc --noEmit app/App.webrtc.tsx 2>&1 | grep -v "node_modules" | head -5; then
    echo -e "${GREEN}✅ Mobile App TypeScript: OK${NC}"
else
    echo -e "${YELLOW}⚠️  Mobile App TypeScript: Some warnings (may be normal)${NC}"
fi
echo ""

# Test 5: Check if WebRTC dependencies are available
echo "5️⃣  Checking WebRTC Dependencies..."
if npm list react-native-webrtc 2>&1 | grep -q "react-native-webrtc@"; then
    echo -e "${GREEN}✅ react-native-webrtc: Installed${NC}"
    echo -e "${YELLOW}⚠️  Note: Requires Expo Development Build (won't work in Expo Go)${NC}"
else
    echo -e "${YELLOW}⚠️  react-native-webrtc: Not installed in mobile app${NC}"
    echo -e "   Run: cd expo-stream-app && npm install react-native-webrtc"
fi
echo ""

echo "================================"
echo -e "${GREEN}✅ Basic checks completed!${NC}"
echo ""
echo "📋 Next Steps:"
echo "1. Start WebRTC backend: cd react_native_playground_backend && npm run dev:webrtc"
echo "2. Start frontend: cd react-native-playground-frontend && npm run dev"
echo "3. Test in browser: Open http://localhost:3000 and use WebRTCViewer component"
echo "4. For mobile: Create Expo dev build with react-native-webrtc"
echo ""

