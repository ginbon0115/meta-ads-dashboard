#!/bin/bash
cd "$(dirname "$0")"
echo "📦 Deploying from $(pwd)..."
wrangler pages deploy public --project-name meta-ads-dashboard
echo "✅ Deploy 完成"
