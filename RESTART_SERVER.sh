#!/bin/bash

echo "🔄 Restarting WebSocket Server..."
echo ""

cd "$(dirname "$0")"

# Kill old processes
echo "1. Stopping old servers..."
./kill-ports.sh

sleep 2

# Start the server
echo ""
echo "2. Starting WebSocket server..."
echo "   Run this in a separate terminal:"
echo "   cd $(pwd)"
echo "   npm run dev"
echo ""
echo "   Or run it in background:"
echo "   npm run dev > server.log 2>&1 &"
echo ""

