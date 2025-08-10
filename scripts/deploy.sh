#!/bin/bash
# scripts/deploy.sh - 배포 스크립트

echo "🚀 Deploying ZeroPacking Server..."

# 색상 코드
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Git pull
echo -e "${YELLOW}Pulling latest changes...${NC}"
git pull origin main

# 의존성 업데이트
echo -e "${YELLOW}Updating dependencies...${NC}"
npm install

# PM2 재시작
echo -e "${YELLOW}Restarting PM2...${NC}"
pm2 reload ecosystem.config.js --update-env

# Nginx 재시작
echo -e "${YELLOW}Restarting Nginx...${NC}"
sudo systemctl reload nginx

echo -e "${GREEN}✅ Deployment completed!${NC}"
pm2 status
