#!/bin/bash

# Kill processes on ports 3000 and 3002

echo "🔍 Checking for processes on ports 3000 and 3002..."

PIDS_3000=$(lsof -ti :3000)
PIDS_3002=$(lsof -ti :3002)

if [ -z "$PIDS_3000" ] && [ -z "$PIDS_3002" ]; then
    echo "✅ Ports 3000 and 3002 are free"
    exit 0
fi

if [ ! -z "$PIDS_3000" ]; then
    echo "⚠️  Found process(es) on port 3000: $PIDS_3000"
    kill $PIDS_3000 2>/dev/null
    echo "   ✅ Killed process(es) on port 3000"
fi

if [ ! -z "$PIDS_3002" ]; then
    echo "⚠️  Found process(es) on port 3002: $PIDS_3002"
    kill $PIDS_3002 2>/dev/null
    echo "   ✅ Killed process(es) on port 3002"
fi

sleep 1
echo ""
echo "✅ Ports should now be free. You can start the server."

